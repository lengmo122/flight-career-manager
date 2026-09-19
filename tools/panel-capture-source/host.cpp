#include "shared.h"
#include <tlhelp32.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <iostream>
#include <sstream>
#include <thread>
#include <mutex>
#include <atomic>
#include <vector>
#include <algorithm>
#include <fstream>
#include <array>
#include <fcntl.h>
#include <io.h>
using Microsoft::WRL::ComPtr;
struct Marker { uint32_t id, first, second, width, height; };
static std::vector<Marker> Markers;
static std::mutex MarkerMutex;
static std::atomic<bool> Running{true};

static bool SameFileContent(const wchar_t* first, const wchar_t* second) {
    std::ifstream a(first, std::ios::binary), b(second, std::ios::binary);
    if (!a || !b) return false;
    a.seekg(0, std::ios::end); b.seekg(0, std::ios::end);
    const auto sizeA = a.tellg(), sizeB = b.tellg();
    if (sizeA < 0 || sizeA != sizeB) return false;
    a.seekg(0); b.seekg(0);
    std::array<char, 64 * 1024> left{}, right{};
    while (a && b) {
        a.read(left.data(), left.size()); b.read(right.data(), right.size());
        const auto countA = a.gcount(), countB = b.gcount();
        if (countA != countB || !std::equal(left.begin(), left.begin() + countA, right.begin())) return false;
        if (countA == 0) break;
    }
    return true;
}

static bool AllowedName(const wchar_t* name) {
    return !_wcsicmp(name, L"FlightSimulator.exe") || !_wcsicmp(name, L"FlightSimulator2024.exe") ||
        !_wcsicmp(name, L"MofeiCaptureTest.exe");
}

static bool ListProcesses(DWORD target = 0) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    PROCESSENTRY32W entry{sizeof(entry)};
    bool found = false;
    if (!target) std::cout << "[";
    if (Process32FirstW(snapshot, &entry)) do {
        if (!AllowedName(entry.szExeFile)) continue;
        if (target) { if (entry.th32ProcessID == target) found = true; }
        else {
            if (found) std::cout << ",";
            std::cout << "{\"pid\":" << entry.th32ProcessID << ",\"name\":\"";
            std::wcout << entry.szExeFile;
            std::cout << "\"}";
            found = true;
        }
    } while (Process32NextW(snapshot, &entry));
    CloseHandle(snapshot);
    if (!target) std::cout << "]\n";
    return found;
}

static bool Inject(HANDLE process, DWORD pid, const std::wstring& dll) {
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    MODULEENTRY32W module{sizeof(module)};
    bool existing = false;
    bool differentVersion = false;
    if (Module32FirstW(snap, &module)) do {
        if (!_wcsicmp(module.szExePath, dll.c_str())) existing = true;
        else if (!_wcsicmp(module.szModule, L"MofeiCapture.dll")) {
            if (SameFileContent(module.szExePath, dll.c_str())) existing = true;
            else differentVersion = true;
        }
    } while (Module32NextW(snap, &module));
    if (snap != INVALID_HANDLE_VALUE) CloseHandle(snap);
    if (existing) return true;
    if (differentVersion) { std::cerr << "restart-game-required\n"; return false; }
    const auto length = (dll.size() + 1) * sizeof(wchar_t);
    void* remote = VirtualAllocEx(process, nullptr, length, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remote) return false;
    if (!WriteProcessMemory(process, remote, dll.c_str(), length, nullptr)) {
        VirtualFreeEx(process, remote, 0, MEM_RELEASE); return false;
    }
    auto loader = reinterpret_cast<LPTHREAD_START_ROUTINE>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "LoadLibraryW"));
    HANDLE thread = CreateRemoteThread(process, nullptr, 0, loader, remote, 0, nullptr);
    if (!thread) { VirtualFreeEx(process, remote, 0, MEM_RELEASE); return false; }
    const auto wait = WaitForSingleObject(thread, 10000);
    DWORD result = 0;
    if (wait == WAIT_OBJECT_0) {
        GetExitCodeThread(thread, &result);
        VirtualFreeEx(process, remote, 0, MEM_RELEASE);
    }
    CloseHandle(thread);
    return wait == WAIT_OBJECT_0 && result != 0;
}

static std::vector<uint8_t> Jpeg(IWICImagingFactory* factory, const std::vector<uint8_t>& pixels, UINT width, UINT height) {
    ComPtr<IStream> stream;
    ComPtr<IWICBitmapEncoder> encoder;
    ComPtr<IWICBitmapFrameEncode> frame;
    ComPtr<IPropertyBag2> options;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, &stream)) ||
        FAILED(factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, &encoder)) ||
        FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache)) ||
        FAILED(encoder->CreateNewFrame(&frame, &options))) return {};
    PROPBAG2 property{}; property.pstrName = const_cast<wchar_t*>(L"ImageQuality");
    VARIANT quality{}; quality.vt = VT_R4; quality.fltVal = 0.85f;
    options->Write(1, &property, &quality);
    WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
    if (FAILED(frame->Initialize(options.Get())) || FAILED(frame->SetSize(width, height)) ||
        FAILED(frame->SetPixelFormat(&format)) || format != GUID_WICPixelFormat24bppBGR ||
        FAILED(frame->WritePixels(height, width * 3, static_cast<UINT>(pixels.size()), const_cast<BYTE*>(pixels.data()))) ||
        FAILED(frame->Commit()) || FAILED(encoder->Commit())) return {};
    STATSTG stat{};
    stream->Stat(&stat, STATFLAG_NONAME);
    std::vector<uint8_t> result(static_cast<size_t>(stat.cbSize.QuadPart));
    LARGE_INTEGER zero{};
    stream->Seek(zero, STREAM_SEEK_SET, nullptr);
    ULONG read = 0;
    stream->Read(result.data(), static_cast<ULONG>(result.size()), &read);
    result.resize(read);
    return result;
}

int wmain(int argc, wchar_t** argv) {
    if (argc == 2 && !wcscmp(argv[1], L"--list")) { ListProcesses(); return 0; }
    if (argc != 3) return 2;
    DWORD pid = wcstoul(argv[1], nullptr, 10);
    if (!ListProcesses(pid)) { std::cerr << "target-not-supported\n"; return 3; }
    HANDLE owner = CreateMutexW(nullptr, TRUE, (MappingName(pid) + L"-owner").c_str());
    if (!owner || GetLastError() == ERROR_ALREADY_EXISTS) { std::cerr << "capture-already-running\n"; return 4; }
    HANDLE process = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION |
        PROCESS_VM_WRITE | PROCESS_VM_READ | SYNCHRONIZE, FALSE, pid);
    if (!process) { std::cerr << "process-access-denied\n"; return 5; }
    HANDLE mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, sizeof(CaptureShared), MappingName(pid).c_str());
    auto* shared = static_cast<CaptureShared*>(MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(CaptureShared)));
    if (!shared) return 6;
    ZeroMemory(shared, sizeof(CaptureShared));
    shared->magic = CaptureMagic;
    shared->heartbeat = GetTickCount();
    shared->enabled = 1;
    wchar_t dll[MAX_PATH];
    if (!GetFullPathNameW(argv[2], MAX_PATH, dll, nullptr) || !Inject(process, pid, dll)) {
        shared->enabled = 0; std::cerr << "capture-load-failed\n"; return 7;
    }
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    ComPtr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)))) return 8;
    _setmode(_fileno(stdout), _O_BINARY);
    std::thread input([] {
        std::string line;
        while (std::getline(std::cin, line)) {
            if (line == "STOP") break;
            std::istringstream parser(line);
            std::string action; parser >> action;
            std::lock_guard lock(MarkerMutex);
            if (action == "CLEAR") Markers.clear();
            else if (action == "MARK") {
                Marker m{};
                if (parser >> m.id >> m.first >> m.second >> m.width >> m.height)
                    if (Markers.size() < 200 && m.width && m.height && m.width <= MaxSide && m.height <= MaxSide) Markers.push_back(m);
            }
        }
        Running = false;
    });
    // Pipe EOF is the owner-death signal. Keep the input thread detached so simulator exit cannot hang it.
    input.detach();
    LONG last = shared->sequence, lastState = -99;
    ULONGLONG nextDiagnostic = GetTickCount64() + 2000;
    std::vector<uint8_t> pixels(MaxPixels);
    while (Running && WaitForSingleObject(process, 0) == WAIT_TIMEOUT) {
        shared->heartbeat = GetTickCount();
        if (shared->state != lastState) {
            lastState = shared->state;
            std::cerr << "capture-state:" << lastState << "\n";
        }
        if (GetTickCount64() >= nextDiagnostic) {
            nextDiagnostic = GetTickCount64() + 2000;
            std::cerr << "capture-diag:b=" << shared->barrierCalls
                << " e=" << shared->enhancedBarrierCalls
                << " s=" << shared->suitableSurfaces
                << " x=" << shared->executeCalls
                << " c=" << shared->validCandidates
                << " p=" << shared->submittedCopies
                << " w=" << shared->lastWidth << " h=" << shared->lastHeight << "\n";
        }
        if (shared->state < 0) break;
        const LONG seq = shared->sequence;
        if ((seq & 1) || seq == last || seq == 0) { Sleep(5); continue; }
        const UINT w = shared->width, h = shared->height, size = shared->size, bgra = shared->bgra;
        if (w == 0 || h == 0 || w > MaxSide || h > MaxSide || size != w * h * 4) { Sleep(5); continue; }
        memcpy(pixels.data(), shared->pixels, size);
        MemoryBarrier();
        if (shared->sequence != seq) continue;
        last = seq;
        std::vector<Marker> markers;
        { std::lock_guard lock(MarkerMutex); markers = Markers; }
        const auto color = [&](size_t i) -> uint32_t {
            const auto* p = pixels.data() + i * 4;
            return (static_cast<uint32_t>(p[bgra ? 2 : 0]) << 16) | (static_cast<uint32_t>(p[1]) << 8) | p[bgra ? 0 : 2];
        };
        for (const auto& marker : markers) {
            bool matched = false;
            for (UINT y = 0; y < h && !matched; ++y) for (UINT x = 0; x + 1 < w; ++x) {
                if (color(y * w + x) != marker.first || color(y * w + x + 1) != marker.second) continue;
                const UINT cw = (std::min)(marker.width, w - x), ch = (std::min)(marker.height, h - y);
                std::vector<uint8_t> bgr(cw * ch * 3);
                for (UINT cy = 0; cy < ch; ++cy) for (UINT cx = 0; cx < cw; ++cx) {
                    const auto* p = pixels.data() + ((y + cy) * w + x + cx) * 4;
                    auto* out = bgr.data() + (cy * cw + cx) * 3;
                    out[0] = p[bgra ? 0 : 2]; out[1] = p[1]; out[2] = p[bgra ? 2 : 0];
                }
                // Conceal the two discovery pixels in the transmitted image.
                if (ch > 1) memcpy(bgr.data(), bgr.data() + cw * 3, (std::min)(cw, 2u) * 3);
                auto jpeg = Jpeg(factory.Get(), bgr, cw, ch);
                if (!jpeg.empty()) {
                    uint32_t header[]{0x314a464d, marker.id, cw, ch, static_cast<uint32_t>(jpeg.size())};
                    std::cout.write(reinterpret_cast<char*>(header), sizeof(header));
                    std::cout.write(reinterpret_cast<char*>(jpeg.data()), jpeg.size());
                    std::cout.flush();
                    if (!std::cout) Running = false;
                }
                matched = true; break;
            }
        }
    }
    shared->enabled = 0;
    UnmapViewOfFile(shared);
    CloseHandle(mapping); CloseHandle(process); ReleaseMutex(owner); CloseHandle(owner);
    // Static objects used by the blocked input thread must not be destructed underneath it.
    ExitProcess(0);
}
