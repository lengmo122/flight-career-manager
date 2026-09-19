#pragma once
#include <windows.h>
#include <cstdint>
#include <string>

constexpr uint32_t CaptureMagic = 0x4d464331;
constexpr uint32_t MaxSide = 4096;
constexpr uint32_t MaxPixels = MaxSide * MaxSide * 4;
struct CaptureShared {
    uint32_t magic;
    volatile LONG enabled;
    volatile LONG heartbeat;
    volatile LONG state;
    volatile LONG sequence;
    uint32_t width, height, size, bgra;
    volatile LONG barrierCalls;
    volatile LONG enhancedBarrierCalls;
    volatile LONG suitableSurfaces;
    volatile LONG executeCalls;
    volatile LONG validCandidates;
    volatile LONG submittedCopies;
    volatile LONG lastWidth, lastHeight;
    uint8_t pixels[MaxPixels];
};
inline std::wstring MappingName(DWORD pid) {
    return L"Local\\MofeiPanelCapture-v1-" + std::to_wstring(pid);
}
inline bool CaptureActive(CaptureShared* s) {
    return s && s->magic == CaptureMagic && s->enabled &&
        static_cast<DWORD>(GetTickCount() - static_cast<DWORD>(s->heartbeat)) < 5000;
}
