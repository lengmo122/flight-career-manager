#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <string>

struct SimConnectInitPosition {
  double latitude;
  double longitude;
  double altitude;
  double pitch;
  double bank;
  double heading;
  DWORD onGround;
  DWORD airspeed;
};

struct SimConnectRecv {
  DWORD size;
  DWORD version;
  DWORD id;
};

struct SimConnectRecvAssignedObjectId : SimConnectRecv {
  DWORD requestId;
  DWORD objectId;
};

struct SimConnectRecvException : SimConnectRecv {
  DWORD exception;
  DWORD sendId;
  DWORD index;
};

using SimConnectOpen = HRESULT(WINAPI *)(HANDLE *, const char *, HWND, DWORD, HANDLE, DWORD);
using SimConnectClose = HRESULT(WINAPI *)(HANDLE);
using SimConnectCreateObject = HRESULT(WINAPI *)(HANDLE, const char *, SimConnectInitPosition, DWORD);
using SimConnectCallDispatch = HRESULT(WINAPI *)(HANDLE, void(CALLBACK *)(SimConnectRecv *, DWORD, void *), void *);

constexpr DWORD kRecvException = 1;
constexpr DWORD kRecvQuit = 3;
constexpr DWORD kRecvAssignedObjectId = 12;
constexpr DWORD kSceneCreateRequest = 1;
constexpr DWORD kSmokeCreateRequest = 2;

struct BridgeState {
  std::filesystem::path statusPath;
  std::filesystem::path stopPath;
  std::string title;
  std::string smokeTitle;
  DWORD objectId = 0;
  DWORD smokeObjectId = 0;
  bool sceneCreated = false;
  bool smokeCreated = false;
  bool smokeRequested = false;
  bool failed = false;
  bool simulatorQuit = false;
  DWORD exception = 0;
};

bool stopRequested(const BridgeState &state) {
  std::error_code error;
  return !state.stopPath.empty() && std::filesystem::exists(state.stopPath, error);
}

bool allObjectsCreated(const BridgeState &state) {
  return state.sceneCreated && (!state.smokeRequested || state.smokeCreated);
}

std::string utf8(const std::wstring &value) {
  if (value.empty()) return {};
  const int length = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(static_cast<size_t>(length), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), length, nullptr, nullptr);
  return result;
}

std::string escapeJson(const std::string &value) {
  std::string result;
  result.reserve(value.size());
  for (const char ch : value) {
    if (ch == '\\' || ch == '"') result.push_back('\\');
    result.push_back(ch);
  }
  return result;
}

void writeStatus(const BridgeState &state, const char *phase, const std::string &message) {
  std::ofstream output(state.statusPath, std::ios::trunc);
  output << "{\"state\":\"" << phase << "\",\"objectTitle\":\"" << escapeJson(state.title)
         << "\",\"objectId\":" << state.objectId << ",\"smokeTitle\":\"" << escapeJson(state.smokeTitle)
         << "\",\"smokeObjectId\":" << state.smokeObjectId
         << ",\"smokeRequested\":" << (state.smokeRequested ? "true" : "false")
         << ",\"smokeCreated\":" << (state.smokeCreated ? "true" : "false")
         << ",\"exception\":" << state.exception
         << ",\"message\":\"" << escapeJson(message) << "\"}";
}

void CALLBACK dispatch(SimConnectRecv *data, DWORD, void *context) {
  auto &state = *static_cast<BridgeState *>(context);
  if (data->id == kRecvAssignedObjectId) {
    const auto *assigned = reinterpret_cast<SimConnectRecvAssignedObjectId *>(data);
    if (assigned->requestId == kSceneCreateRequest) {
      state.objectId = assigned->objectId;
      state.sceneCreated = true;
    } else if (assigned->requestId == kSmokeCreateRequest) {
      state.smokeObjectId = assigned->objectId;
      state.smokeCreated = true;
    }
    if (state.failed) {
      return;
    } else if (allObjectsCreated(state)) {
      writeStatus(state, "created", state.smokeRequested ? "Scene object and smoke marker created in MSFS" : "Scene object created in MSFS");
    } else {
      writeStatus(state, "creating", "Waiting for MSFS to confirm all scene objects");
    }
  } else if (data->id == kRecvException) {
    const auto *exception = reinterpret_cast<SimConnectRecvException *>(data);
    state.exception = exception->exception;
    state.failed = true;
    writeStatus(state, "error", "MSFS rejected the scene object request");
  } else if (data->id == kRecvQuit) {
    state.simulatorQuit = true;
    writeStatus(state, "disconnected", "MSFS closed");
  }
}

int wmain(int argc, wchar_t **argv) {
  if (argc != 9) return 2;

  BridgeState state;
  state.title = utf8(argv[1]);
  state.smokeTitle = utf8(argv[6]);
  state.smokeRequested = !state.smokeTitle.empty();
  state.statusPath = argv[7];
  state.stopPath = argv[8];
  writeStatus(state, "connecting", "Connecting to MSFS SimConnect");

  const auto modulePath = std::filesystem::path(argv[0]).parent_path() / L"SimConnect.dll";
  HMODULE library = LoadLibraryW(modulePath.c_str());
  if (!library) {
    writeStatus(state, "error", "SimConnect.dll could not be loaded");
    return 3;
  }

  const auto open = reinterpret_cast<SimConnectOpen>(GetProcAddress(library, "SimConnect_Open"));
  const auto close = reinterpret_cast<SimConnectClose>(GetProcAddress(library, "SimConnect_Close"));
  const auto createObject = reinterpret_cast<SimConnectCreateObject>(GetProcAddress(library, "SimConnect_AICreateSimulatedObject"));
  const auto callDispatch = reinterpret_cast<SimConnectCallDispatch>(GetProcAddress(library, "SimConnect_CallDispatch"));
  if (!open || !close || !createObject || !callDispatch) {
    writeStatus(state, "error", "Required SimConnect functions are unavailable");
    FreeLibrary(library);
    return 4;
  }

  HANDLE eventHandle = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  HANDLE simConnect = nullptr;
  const HRESULT openResult = open(&simConnect, "Flight Career Manager Scene Bridge", nullptr, 0, eventHandle, 0);
  if (FAILED(openResult)) {
    writeStatus(state, "error", "MSFS SimConnect is unavailable");
    CloseHandle(eventHandle);
    FreeLibrary(library);
    return 5;
  }

  SimConnectInitPosition position{
      std::stod(argv[2]), std::stod(argv[3]), std::stod(argv[4]), 0.0, 0.0, std::stod(argv[5]), 1, 0};
  const HRESULT createResult = createObject(simConnect, state.title.c_str(), position, kSceneCreateRequest);
  if (FAILED(createResult)) {
    writeStatus(state, "error", "Scene object request failed");
    close(simConnect);
    CloseHandle(eventHandle);
    FreeLibrary(library);
    return 6;
  }

  if (state.smokeRequested) {
    const HRESULT smokeResult = createObject(simConnect, state.smokeTitle.c_str(), position, kSmokeCreateRequest);
    if (FAILED(smokeResult)) {
      writeStatus(state, "error", "Mission smoke request failed");
      close(simConnect);
      CloseHandle(eventHandle);
      FreeLibrary(library);
      return 6;
    }
  }

  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(15);
  while (!allObjectsCreated(state) && !state.failed && !state.simulatorQuit && std::chrono::steady_clock::now() < deadline) {
    if (stopRequested(state)) {
      state.simulatorQuit = true;
      writeStatus(state, "disconnected", "Scene bridge stopped by Flight Career Manager");
      break;
    }
    WaitForSingleObject(eventHandle, 250);
    if (FAILED(callDispatch(simConnect, dispatch, &state))) {
      state.simulatorQuit = true;
      writeStatus(state, "disconnected", "MSFS SimConnect connection was lost");
    }
  }
  if (!allObjectsCreated(state) && !state.failed && !state.simulatorQuit) {
    writeStatus(state, "error", state.smokeRequested ? "MSFS did not confirm the scene object and smoke marker" : "MSFS did not confirm the scene object");
  }

  while (allObjectsCreated(state) && !state.simulatorQuit) {
    if (stopRequested(state)) {
      writeStatus(state, "disconnected", "Scene bridge stopped by Flight Career Manager");
      break;
    }
    WaitForSingleObject(eventHandle, 1000);
    if (FAILED(callDispatch(simConnect, dispatch, &state))) {
      writeStatus(state, "disconnected", "MSFS SimConnect connection was lost");
      break;
    }
  }

  close(simConnect);
  CloseHandle(eventHandle);
  FreeLibrary(library);
  if (!state.stopPath.empty()) {
    std::error_code error;
    std::filesystem::remove(state.stopPath, error);
  }
  return allObjectsCreated(state) ? 0 : 7;
}
