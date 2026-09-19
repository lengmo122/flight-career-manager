#include "shared.h"
#include <d3d12.h>
#include <dxgi1_4.h>
#include <wrl/client.h>
#include <mutex>
#include <unordered_map>
#include <vector>
#include <atomic>
#include "MinHook.h"
using Microsoft::WRL::ComPtr;

using BarrierFn = void (STDMETHODCALLTYPE*)(ID3D12GraphicsCommandList*, UINT, const D3D12_RESOURCE_BARRIER*);
using ResetFn = HRESULT (STDMETHODCALLTYPE*)(ID3D12GraphicsCommandList*, ID3D12CommandAllocator*, ID3D12PipelineState*);
using ExecuteFn = void (STDMETHODCALLTYPE*)(ID3D12CommandQueue*, UINT, ID3D12CommandList* const*);
static BarrierFn OriginalBarrier;
static ResetFn OriginalReset;
static ExecuteFn OriginalExecute;
using EnhancedFn = void (STDMETHODCALLTYPE*)(ID3D12GraphicsCommandList7*, UINT32, const D3D12_BARRIER_GROUP*);
static EnhancedFn OriginalEnhanced;
extern "C" unsigned int EnhancedBarrierIndex(void);
static CaptureShared* Shared;
static HANDLE Mapping;
static std::mutex ListsMutex, QueueMutex;
static thread_local bool Internal = false;
struct Surface {
    ComPtr<ID3D12Resource> resource;
    D3D12_RESOURCE_STATES state;
    bool enhanced = false;
    D3D12_BARRIER_LAYOUT layout = D3D12_BARRIER_LAYOUT_COMMON;
    D3D12_BARRIER_ACCESS access = D3D12_BARRIER_ACCESS_COMMON;
};
struct Recorded {
    ULONGLONG touched;
    bool invalid = false;
    std::unordered_map<ID3D12Resource*, Surface> surfaces;
};
static std::unordered_map<ID3D12GraphicsCommandList*, Recorded> Lists;
static ComPtr<ID3D12Device> Device;
static ComPtr<ID3D12CommandQueue> Queue;
static ComPtr<ID3D12CommandAllocator> Allocator;
static ComPtr<ID3D12GraphicsCommandList> CopyList;
static ComPtr<ID3D12GraphicsCommandList7> CopyList7;
static ComPtr<ID3D12Fence> Fence;
static ComPtr<ID3D12Resource> Readback, PendingResource;
static D3D12_PLACED_SUBRESOURCE_FOOTPRINT Footprint;
static UINT64 FenceValue = 0;
static bool Pending = false;
static ULONGLONG LastCapture = 0;
static size_t Rotation = 0;
static constexpr size_t MaxTrackedLists = 1024;

static bool Suitable(ID3D12Resource* r) {
    const auto d = r->GetDesc();
    return d.Dimension == D3D12_RESOURCE_DIMENSION_TEXTURE2D &&
        d.Width >= 64 && d.Width <= MaxSide && d.Height >= 64 && d.Height <= MaxSide &&
        d.DepthOrArraySize == 1 && d.MipLevels == 1 && d.SampleDesc.Count == 1 &&
        (d.Flags & D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET) &&
        (d.Format == DXGI_FORMAT_R8G8B8A8_UNORM || d.Format == DXGI_FORMAT_B8G8R8A8_UNORM ||
         d.Format == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB || d.Format == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB);
}

static D3D12_RESOURCE_STATES LegacyState(D3D12_BARRIER_LAYOUT layout, D3D12_BARRIER_ACCESS access) {
    switch (layout) {
    case D3D12_BARRIER_LAYOUT_RENDER_TARGET: return D3D12_RESOURCE_STATE_RENDER_TARGET;
    case D3D12_BARRIER_LAYOUT_UNORDERED_ACCESS:
    case D3D12_BARRIER_LAYOUT_DIRECT_QUEUE_UNORDERED_ACCESS:
    case D3D12_BARRIER_LAYOUT_COMPUTE_QUEUE_UNORDERED_ACCESS: return D3D12_RESOURCE_STATE_UNORDERED_ACCESS;
    case D3D12_BARRIER_LAYOUT_COPY_SOURCE:
    case D3D12_BARRIER_LAYOUT_DIRECT_QUEUE_COPY_SOURCE:
    case D3D12_BARRIER_LAYOUT_COMPUTE_QUEUE_COPY_SOURCE: return D3D12_RESOURCE_STATE_COPY_SOURCE;
    case D3D12_BARRIER_LAYOUT_COPY_DEST:
    case D3D12_BARRIER_LAYOUT_DIRECT_QUEUE_COPY_DEST:
    case D3D12_BARRIER_LAYOUT_COMPUTE_QUEUE_COPY_DEST: return D3D12_RESOURCE_STATE_COPY_DEST;
    case D3D12_BARRIER_LAYOUT_DEPTH_STENCIL_WRITE: return D3D12_RESOURCE_STATE_DEPTH_WRITE;
    case D3D12_BARRIER_LAYOUT_DEPTH_STENCIL_READ: return D3D12_RESOURCE_STATE_DEPTH_READ;
    default:
        if (access & D3D12_BARRIER_ACCESS_RENDER_TARGET) return D3D12_RESOURCE_STATE_RENDER_TARGET;
        if (access & D3D12_BARRIER_ACCESS_UNORDERED_ACCESS) return D3D12_RESOURCE_STATE_UNORDERED_ACCESS;
        if (access & D3D12_BARRIER_ACCESS_COPY_SOURCE) return D3D12_RESOURCE_STATE_COPY_SOURCE;
        if (access & D3D12_BARRIER_ACCESS_COPY_DEST) return D3D12_RESOURCE_STATE_COPY_DEST;
        if (access & D3D12_BARRIER_ACCESS_SHADER_RESOURCE)
            return D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE | D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE;
        return D3D12_RESOURCE_STATE_COMMON;
    }
}

static void STDMETHODCALLTYPE HookBarrier(ID3D12GraphicsCommandList* list, UINT count, const D3D12_RESOURCE_BARRIER* barriers) {
    if (!Internal && CaptureActive(Shared)) {
        InterlockedIncrement(&Shared->barrierCalls);
        std::lock_guard lock(ListsMutex);
        if (Lists.size() < MaxTrackedLists || Lists.contains(list)) {
            auto& record = Lists[list];
            record.touched = GetTickCount64();
            for (UINT i = 0; i < count; ++i) {
                const auto& b = barriers[i];
                if (b.Type == D3D12_RESOURCE_BARRIER_TYPE_ALIASING) { record.invalid = true; continue; }
                if (b.Type != D3D12_RESOURCE_BARRIER_TYPE_TRANSITION || !b.Transition.pResource) continue;
                auto* r = b.Transition.pResource;
                // Split/subresource barriers are deliberately not captured: their state is incomplete.
                if (b.Flags != D3D12_RESOURCE_BARRIER_FLAG_NONE ||
                    b.Transition.Subresource != D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES) {
                    record.invalid = true;
                    continue;
                }
                if ((record.surfaces.contains(r) || record.surfaces.size() < 16) && Suitable(r)) {
                    record.surfaces[r] = {r, b.Transition.StateAfter, false, D3D12_BARRIER_LAYOUT_COMMON, D3D12_BARRIER_ACCESS_COMMON};
                    InterlockedIncrement(&Shared->suitableSurfaces);
                }
            }
        }
    }
    OriginalBarrier(list, count, barriers);
}

static void STDMETHODCALLTYPE HookEnhanced(ID3D12GraphicsCommandList7* list, UINT32 count, const D3D12_BARRIER_GROUP* groups) {
    if (!Internal && CaptureActive(Shared)) {
        InterlockedIncrement(&Shared->enhancedBarrierCalls);
        std::lock_guard lock(ListsMutex);
        if (Lists.size() < MaxTrackedLists || Lists.contains(reinterpret_cast<ID3D12GraphicsCommandList*>(list))) {
            auto& record = Lists[reinterpret_cast<ID3D12GraphicsCommandList*>(list)];
            record.touched = GetTickCount64();
            for (UINT i = 0; i < count; ++i) {
                const auto& group = groups[i];
                if (group.Type != D3D12_BARRIER_TYPE_TEXTURE || !group.pTextureBarriers) continue;
                for (UINT j = 0; j < group.NumBarriers; ++j) {
                    const auto& barrier = group.pTextureBarriers[j];
                    auto* resource = barrier.pResource;
                    if (!resource || barrier.Flags != D3D12_TEXTURE_BARRIER_FLAG_NONE || !Suitable(resource)) continue;
                    const auto& range = barrier.Subresources;
                    if (range.IndexOrFirstMipLevel != 0 || range.NumMipLevels != 1 ||
                        range.FirstArraySlice != 0 || range.NumArraySlices != 1 ||
                        range.FirstPlane != 0 || range.NumPlanes != 1) continue;
                    record.surfaces[resource] = {
                        resource,
                        LegacyState(barrier.LayoutAfter, barrier.AccessAfter),
                        true,
                        barrier.LayoutAfter,
                        barrier.AccessAfter
                    };
                    InterlockedIncrement(&Shared->suitableSurfaces);
                }
            }
        }
    }
    OriginalEnhanced(list, count, groups);
}

static HRESULT STDMETHODCALLTYPE HookReset(ID3D12GraphicsCommandList* list, ID3D12CommandAllocator* allocator, ID3D12PipelineState* pipeline) {
    if (!Internal) {
        std::lock_guard lock(ListsMutex);
        Lists.erase(list);
    }
    return OriginalReset(list, allocator, pipeline);
}

static bool InitCopy(ID3D12CommandQueue* queue) {
    if (Queue) return Queue.Get() == queue;
    if (FAILED(queue->GetDevice(IID_PPV_ARGS(&Device)))) return false;
    if (FAILED(Device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&Allocator)))) return false;
    Internal = true;
    const auto hr = Device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, Allocator.Get(), nullptr, IID_PPV_ARGS(&CopyList));
    if (SUCCEEDED(hr)) CopyList->Close();
    Internal = false;
    if (FAILED(hr) || FAILED(Device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&Fence)))) return false;
    CopyList.As(&CopyList7);
    Queue = queue;
    return true;
}

static void CollectFrame() {
    if (!Pending) return;
    const auto completed = Fence->GetCompletedValue();
    if (completed == UINT64_MAX) { Shared->state = -4; Shared->enabled = 0; return; }
    if (completed < FenceValue) return;
    Pending = false;
    const auto d = PendingResource->GetDesc();
    const UINT rowBytes = static_cast<UINT>(d.Width) * 4;
    void* bytes = nullptr;
    D3D12_RANGE readRange{0, static_cast<SIZE_T>(Footprint.Footprint.RowPitch) * d.Height};
    if (CaptureActive(Shared) && SUCCEEDED(Readback->Map(0, &readRange, &bytes))) {
        InterlockedIncrement(&Shared->sequence);
        Shared->width = static_cast<UINT>(d.Width);
        Shared->height = d.Height;
        Shared->size = rowBytes * d.Height;
        Shared->bgra = d.Format == DXGI_FORMAT_B8G8R8A8_UNORM || d.Format == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB;
        for (UINT y = 0; y < d.Height; ++y)
            memcpy(Shared->pixels + y * rowBytes, static_cast<uint8_t*>(bytes) + Footprint.Offset + y * Footprint.Footprint.RowPitch, rowBytes);
        InterlockedIncrement(&Shared->sequence);
        Shared->state = 2;
        D3D12_RANGE written{0, 0};
        Readback->Unmap(0, &written);
    }
    PendingResource.Reset();
    Readback.Reset();
}

static void SubmitCopy(ID3D12CommandQueue* queue, const Surface& surface) {
    if (!InitCopy(queue)) return;
    const auto d = surface.resource->GetDesc();
    Shared->lastWidth = static_cast<LONG>(d.Width);
    Shared->lastHeight = static_cast<LONG>(d.Height);
    UINT64 size = 0;
    Device->GetCopyableFootprints(&d, 0, 1, 0, &Footprint, nullptr, nullptr, &size);
    D3D12_HEAP_PROPERTIES heap{};
    heap.Type = D3D12_HEAP_TYPE_READBACK;
    D3D12_RESOURCE_DESC buffer{};
    buffer.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
    buffer.Width = size; buffer.Height = 1; buffer.DepthOrArraySize = 1; buffer.MipLevels = 1;
    buffer.SampleDesc.Count = 1; buffer.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
    if (FAILED(Device->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &buffer, D3D12_RESOURCE_STATE_COPY_DEST, nullptr, IID_PPV_ARGS(&Readback)))) return;
    if (FAILED(Allocator->Reset())) return;
    Internal = true;
    auto hr = CopyList->Reset(Allocator.Get(), nullptr);
    Internal = false;
    if (FAILED(hr)) return;
    D3D12_RESOURCE_BARRIER barrier{};
    barrier.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
    barrier.Transition = {surface.resource.Get(), D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES, surface.state, D3D12_RESOURCE_STATE_COPY_SOURCE};
    if (surface.enhanced && CopyList7) {
        D3D12_TEXTURE_BARRIER enhanced{};
        enhanced.SyncBefore = D3D12_BARRIER_SYNC_ALL;
        enhanced.SyncAfter = D3D12_BARRIER_SYNC_COPY;
        enhanced.AccessBefore = surface.access;
        enhanced.AccessAfter = D3D12_BARRIER_ACCESS_COPY_SOURCE;
        enhanced.LayoutBefore = surface.layout;
        enhanced.LayoutAfter = D3D12_BARRIER_LAYOUT_DIRECT_QUEUE_COPY_SOURCE;
        enhanced.pResource = surface.resource.Get();
        enhanced.Subresources = {0, 1, 0, 1, 0, 1};
        D3D12_BARRIER_GROUP group{}; group.Type = D3D12_BARRIER_TYPE_TEXTURE; group.NumBarriers = 1; group.pTextureBarriers = &enhanced;
        CopyList7->Barrier(1, &group);
    } else if (surface.state != D3D12_RESOURCE_STATE_COPY_SOURCE) {
        OriginalBarrier(CopyList.Get(), 1, &barrier);
    }
    D3D12_TEXTURE_COPY_LOCATION src{};
    src.pResource = surface.resource.Get(); src.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;
    D3D12_TEXTURE_COPY_LOCATION dst{};
    dst.pResource = Readback.Get(); dst.Type = D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT; dst.PlacedFootprint = Footprint;
    CopyList->CopyTextureRegion(&dst, 0, 0, 0, &src, nullptr);
    if (surface.enhanced && CopyList7) {
        D3D12_TEXTURE_BARRIER enhanced{};
        enhanced.SyncBefore = D3D12_BARRIER_SYNC_COPY;
        enhanced.SyncAfter = D3D12_BARRIER_SYNC_ALL;
        enhanced.AccessBefore = D3D12_BARRIER_ACCESS_COPY_SOURCE;
        enhanced.AccessAfter = surface.access;
        enhanced.LayoutBefore = D3D12_BARRIER_LAYOUT_DIRECT_QUEUE_COPY_SOURCE;
        enhanced.LayoutAfter = surface.layout;
        enhanced.pResource = surface.resource.Get();
        enhanced.Subresources = {0, 1, 0, 1, 0, 1};
        D3D12_BARRIER_GROUP group{}; group.Type = D3D12_BARRIER_TYPE_TEXTURE; group.NumBarriers = 1; group.pTextureBarriers = &enhanced;
        CopyList7->Barrier(1, &group);
    } else if (surface.state != D3D12_RESOURCE_STATE_COPY_SOURCE) {
        std::swap(barrier.Transition.StateBefore, barrier.Transition.StateAfter);
        OriginalBarrier(CopyList.Get(), 1, &barrier);
    }
    if (FAILED(CopyList->Close())) return;
    ID3D12CommandList* commands[]{CopyList.Get()};
    OriginalExecute(queue, 1, commands);
    PendingResource = surface.resource;
    Pending = true;
    InterlockedIncrement(&Shared->submittedCopies);
    // Never recycle a GPU readback buffer before its fence completes.
    if (FAILED(queue->Signal(Fence.Get(), ++FenceValue))) { Shared->state = -4; Shared->enabled = 0; }
}

static void STDMETHODCALLTYPE HookExecute(ID3D12CommandQueue* queue, UINT count, ID3D12CommandList* const* lists) {
    if (queue->GetDesc().Type != D3D12_COMMAND_LIST_TYPE_DIRECT) {
        OriginalExecute(queue, count, lists); return;
    }
    std::lock_guard queueLock(QueueMutex);
    OriginalExecute(queue, count, lists);
    InterlockedIncrement(&Shared->executeCalls);
    // ponytail: one initialized capture queue; per-queue readback is needed
    // if the instrument moves to another queue. Never select an empty queue.
    if (Queue && Queue.Get() != queue) {
        std::lock_guard lock(ListsMutex);
        for (UINT i = 0; i < count; ++i)
            Lists.erase(static_cast<ID3D12GraphicsCommandList*>(lists[i]));
        return;
    }
    CollectFrame();
    const auto now = GetTickCount64();
    if (!CaptureActive(Shared)) {
        std::lock_guard lock(ListsMutex);
        Lists.clear();
        return;
    }
    std::vector<Surface> candidates;
    {
        std::lock_guard lock(ListsMutex);
        std::unordered_map<ID3D12Resource*, Surface> finalStates;
        for (UINT i = 0; i < count; ++i) {
            auto it = Lists.find(static_cast<ID3D12GraphicsCommandList*>(lists[i]));
            // A submission can contain internal/untracked lists. Keep usable
            // surfaces from the lists we did observe instead of discarding the
            // complete batch because one sibling has no barrier record.
            if (it == Lists.end() || it->second.invalid) continue;
            for (auto& [key, value] : it->second.surfaces) finalStates[key] = value;
        }
        for (auto& [key, value] : finalStates) candidates.push_back(value);
        Shared->validCandidates = static_cast<LONG>(candidates.size());
        for (UINT i = 0; i < count; ++i) Lists.erase(static_cast<ID3D12GraphicsCommandList*>(lists[i]));
        for (auto it = Lists.begin(); it != Lists.end();) {
            if (now - it->second.touched > 3000) it = Lists.erase(it); else ++it;
        }
    }
    if (candidates.empty() || Pending || now - LastCapture < 16) return;
    LastCapture = now;
    SubmitCopy(queue, candidates[Rotation++ % candidates.size()]);
}

static DWORD WINAPI Install(void*) {
    Mapping = OpenFileMappingW(FILE_MAP_ALL_ACCESS, FALSE, MappingName(GetCurrentProcessId()).c_str());
    if (!Mapping) return 0;
    Shared = static_cast<CaptureShared*>(MapViewOfFile(Mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(CaptureShared)));
    if (!Shared || Shared->magic != CaptureMagic) return 0;
    ComPtr<ID3D12Device> device;
    ComPtr<ID3D12CommandQueue> queue;
    ComPtr<ID3D12CommandAllocator> allocator;
    ComPtr<ID3D12GraphicsCommandList> list;
    D3D12_COMMAND_QUEUE_DESC q{};
    if (FAILED(D3D12CreateDevice(nullptr, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&device))) ||
        FAILED(device->CreateCommandQueue(&q, IID_PPV_ARGS(&queue))) ||
        FAILED(device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&allocator))) ||
        FAILED(device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, allocator.Get(), nullptr, IID_PPV_ARGS(&list)))) {
        Shared->state = -1; return 0;
    }
    auto** qvt = *reinterpret_cast<void***>(queue.Get());
    auto** lvt = *reinterpret_cast<void***>(list.Get());
    ComPtr<ID3D12GraphicsCommandList7> enhanced;
    list.As(&enhanced);
    // Preserve both the failing stage and MinHook status for real simulator diagnostics.
    const auto check = [](int stage, MH_STATUS status) {
        if (status == MH_OK) return true;
        Shared->state = -(stage * 100 + (status < 0 ? 99 : static_cast<int>(status)));
        Shared->enabled = 0;
        return false;
    };
    if (!check(1, MH_Initialize())) return 0;
    if (!check(2, MH_CreateHook(lvt[26], reinterpret_cast<void*>(HookBarrier), reinterpret_cast<void**>(&OriginalBarrier))) ||
        !check(3, MH_CreateHook(lvt[10], reinterpret_cast<void*>(HookReset), reinterpret_cast<void**>(&OriginalReset))) ||
        !check(4, MH_CreateHook(qvt[10], reinterpret_cast<void*>(HookExecute), reinterpret_cast<void**>(&OriginalExecute))) ||
        (enhanced && !check(5, MH_CreateHook((*reinterpret_cast<void***>(enhanced.Get()))[EnhancedBarrierIndex()], reinterpret_cast<void*>(HookEnhanced), reinterpret_cast<void**>(&OriginalEnhanced))))) {
        MH_Uninitialize(); return 0;
    }
    if (!check(6, MH_EnableHook(MH_ALL_HOOKS))) return 0;
    Shared->state = 1;
    return 0;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(instance);
        HANDLE thread = CreateThread(nullptr, 0, Install, nullptr, 0, nullptr);
        if (thread) CloseHandle(thread);
    }
    return TRUE;
}
