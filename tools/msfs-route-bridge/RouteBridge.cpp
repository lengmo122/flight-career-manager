#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>

struct SimConnectRecv {
  DWORD size;
  DWORD version;
  DWORD id;
};

using SimConnectOpen = HRESULT(WINAPI *)(HANDLE *, const char *, HWND, DWORD, HANDLE, DWORD);
using SimConnectClose = HRESULT(WINAPI *)(HANDLE);
using SimConnectFlightPlanLoad = HRESULT(WINAPI *)(HANDLE, const char *);
using SimConnectCallDispatch = HRESULT(WINAPI *)(HANDLE, void(CALLBACK *)(SimConnectRecv *, DWORD, void *), void *);

constexpr DWORD kRecvQuit = 3;

struct BridgeState {
  std::filesystem::path statusPath;
  std::string planPath;
  bool loaded = false;
  bool simulatorQuit = false;
  DWORD exception = 0;
};

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
  output << "{\"state\":\"" << phase << "\",\"planPath\":\"" << escapeJson(state.planPath)
         << "\",\"exception\":" << state.exception << ",\"message\":\""
         << escapeJson(message) << "\"}";
}

void CALLBACK dispatch(SimConnectRecv *data, DWORD, void *context) {
  auto &state = *static_cast<BridgeState *>(context);
  if (data->id == kRecvQuit) {
    state.simulatorQuit = true;
    writeStatus(state, "disconnected", "MSFS closed");
  }
}

int wmain(int argc, wchar_t **argv) {
  if (argc != 3) return 2;

  BridgeState state;
  state.planPath = std::filesystem::path(argv[1]).string();
  state.statusPath = argv[2];
  writeStatus(state, "connecting", "Connecting to MSFS navigation");

  const auto modulePath = std::filesystem::path(argv[0]).parent_path() / L"SimConnect.dll";
  HMODULE library = LoadLibraryW(modulePath.c_str());
  if (!library) {
    writeStatus(state, "error", "SimConnect.dll could not be loaded");
    return 3;
  }

  const auto open = reinterpret_cast<SimConnectOpen>(GetProcAddress(library, "SimConnect_Open"));
  const auto close = reinterpret_cast<SimConnectClose>(GetProcAddress(library, "SimConnect_Close"));
  const auto loadPlan = reinterpret_cast<SimConnectFlightPlanLoad>(GetProcAddress(library, "SimConnect_FlightPlanLoad"));
  const auto callDispatch = reinterpret_cast<SimConnectCallDispatch>(GetProcAddress(library, "SimConnect_CallDispatch"));
  if (!open || !close || !loadPlan || !callDispatch) {
    writeStatus(state, "error", "Flight plan loading is not supported");
    FreeLibrary(library);
    return 4;
  }

  HANDLE eventHandle = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  HANDLE simConnect = nullptr;
  const HRESULT openResult = open(&simConnect, "Flight Career Manager Route Bridge", nullptr, 0, eventHandle, 0);
  if (FAILED(openResult)) {
    writeStatus(state, "error", "MSFS SimConnect is unavailable");
    CloseHandle(eventHandle);
    FreeLibrary(library);
    return 5;
  }

  const HRESULT loadResult = loadPlan(simConnect, state.planPath.c_str());
  if (FAILED(loadResult)) {
    state.exception = static_cast<DWORD>(loadResult);
    writeStatus(state, "error", "MSFS rejected the flight plan");
    close(simConnect);
    CloseHandle(eventHandle);
    FreeLibrary(library);
    return 6;
  }

  state.loaded = true;
  writeStatus(state, "loaded", "Flight plan loaded into MSFS navigation");
  while (!state.simulatorQuit) {
    WaitForSingleObject(eventHandle, 1000);
    if (FAILED(callDispatch(simConnect, dispatch, &state))) {
      writeStatus(state, "disconnected", "MSFS SimConnect connection was lost");
      break;
    }
  }

  close(simConnect);
  CloseHandle(eventHandle);
  FreeLibrary(library);
  return 0;
}
