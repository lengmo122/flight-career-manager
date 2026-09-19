#include <windows.h>
#include <d3d12.h>
#include <wrl/client.h>
#include <iostream>
#include <string>
using Microsoft::WRL::ComPtr;
int main(int argc, char** argv) {
    const bool multipleQueues = argc > 1 && std::string(argv[1]) == "--multi-queue";
    const bool enhanced = argc > 1 && std::string(argv[1]) == "--enhanced";
    const bool untracked = argc > 1 && std::string(argv[1]) == "--untracked";
    ComPtr<ID3D12Device> device;
    if (FAILED(D3D12CreateDevice(nullptr, D3D_FEATURE_LEVEL_11_0, IID_PPV_ARGS(&device)))) return 1;
    ComPtr<ID3D12CommandQueue> queue;
    D3D12_COMMAND_QUEUE_DESC q{};
    device->CreateCommandQueue(&q, IID_PPV_ARGS(&queue));
    ComPtr<ID3D12CommandQueue> auxiliaryQueue;
    ComPtr<ID3D12CommandAllocator> auxiliaryAllocator;
    ComPtr<ID3D12GraphicsCommandList> auxiliaryList;
    ComPtr<ID3D12Fence> auxiliaryFence;
    if (multipleQueues) {
        if (FAILED(device->CreateCommandQueue(&q, IID_PPV_ARGS(&auxiliaryQueue))) ||
            FAILED(device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&auxiliaryAllocator))) ||
            FAILED(device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, auxiliaryAllocator.Get(), nullptr, IID_PPV_ARGS(&auxiliaryList))) ||
            FAILED(device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&auxiliaryFence)))) return 2;
        auxiliaryList->Close();
    }
    ComPtr<ID3D12CommandAllocator> allocator;
    device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&allocator));
    ComPtr<ID3D12GraphicsCommandList> list;
    device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, allocator.Get(), nullptr, IID_PPV_ARGS(&list));
    list->Close();
    ComPtr<ID3D12CommandAllocator> untrackedAllocator;
    ComPtr<ID3D12GraphicsCommandList> untrackedList;
    if (untracked) {
        if (FAILED(device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&untrackedAllocator))) ||
            FAILED(device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, untrackedAllocator.Get(), nullptr, IID_PPV_ARGS(&untrackedList)))) return 5;
        untrackedList->Close();
    }
    ComPtr<ID3D12GraphicsCommandList7> enhancedList;
    if (enhanced && FAILED(list.As(&enhancedList))) return 4;
    D3D12_HEAP_PROPERTIES heap{}; heap.Type = D3D12_HEAP_TYPE_DEFAULT;
    D3D12_RESOURCE_DESC texture{};
    texture.Dimension = D3D12_RESOURCE_DIMENSION_TEXTURE2D; texture.Width = 256; texture.Height = 256;
    texture.DepthOrArraySize = 1; texture.MipLevels = 1; texture.SampleDesc.Count = 1;
    texture.Format = DXGI_FORMAT_R8G8B8A8_UNORM; texture.Flags = D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET;
    ComPtr<ID3D12Resource> resource;
    device->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &texture,
        enhanced ? D3D12_RESOURCE_STATE_COMMON : D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE,
        nullptr, IID_PPV_ARGS(&resource));
    D3D12_DESCRIPTOR_HEAP_DESC desc{}; desc.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV; desc.NumDescriptors = 1;
    ComPtr<ID3D12DescriptorHeap> rtv;
    device->CreateDescriptorHeap(&desc, IID_PPV_ARGS(&rtv));
    auto handle = rtv->GetCPUDescriptorHandleForHeapStart();
    device->CreateRenderTargetView(resource.Get(), nullptr, handle);
    ComPtr<ID3D12Fence> fence; device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&fence));
    HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    std::cout << GetCurrentProcessId() << std::endl;
    for (UINT64 frame = 1; frame < 1500; ++frame) {
        if (multipleQueues) {
            auxiliaryAllocator->Reset(); auxiliaryList->Reset(auxiliaryAllocator.Get(), nullptr);
            auxiliaryList->Close();
            ID3D12CommandList* auxiliaryCommands[]{auxiliaryList.Get()};
            auxiliaryQueue->ExecuteCommandLists(1, auxiliaryCommands);
            auxiliaryQueue->Signal(auxiliaryFence.Get(), frame);
            auxiliaryFence->SetEventOnCompletion(frame, event);
            if (WaitForSingleObject(event, 3000) != WAIT_OBJECT_0) return 3;
        }
        allocator->Reset(); list->Reset(allocator.Get(), nullptr);
        D3D12_RESOURCE_BARRIER b{}; b.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
        b.Transition = {resource.Get(), D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES,
            D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE, D3D12_RESOURCE_STATE_RENDER_TARGET};
        if (enhanced) {
            enhancedList->Reset(allocator.Get(), nullptr);
            D3D12_TEXTURE_BARRIER eb{};
            eb.SyncBefore = D3D12_BARRIER_SYNC_ALL;
            eb.SyncAfter = D3D12_BARRIER_SYNC_RENDER_TARGET;
            eb.AccessBefore = frame == 1 ? D3D12_BARRIER_ACCESS_COMMON : D3D12_BARRIER_ACCESS_SHADER_RESOURCE;
            eb.AccessAfter = D3D12_BARRIER_ACCESS_RENDER_TARGET;
            eb.LayoutBefore = frame == 1 ? D3D12_BARRIER_LAYOUT_COMMON : D3D12_BARRIER_LAYOUT_DIRECT_QUEUE_GENERIC_READ;
            eb.LayoutAfter = D3D12_BARRIER_LAYOUT_RENDER_TARGET;
            eb.pResource = resource.Get(); eb.Subresources = {0, 1, 0, 1, 0, 1};
            D3D12_BARRIER_GROUP group{}; group.Type = D3D12_BARRIER_TYPE_TEXTURE; group.NumBarriers = 1; group.pTextureBarriers = &eb;
            enhancedList->Barrier(1, &group);
        } else {
            list->Reset(allocator.Get(), nullptr);
            list->ResourceBarrier(1, &b);
        }
        float background[]{0.12f, 0.35f, (frame % 100) / 100.0f, 1.0f};
        auto* activeList = enhanced ? enhancedList.Get() : list.Get();
        activeList->ClearRenderTargetView(handle, background, 0, nullptr);
        D3D12_RECT first{0, 0, 1, 1}, second{1, 0, 2, 1};
        float red[]{1, 0, 0, 1}, green[]{0, 1, 0, 1};
        activeList->ClearRenderTargetView(handle, red, 1, &first);
        activeList->ClearRenderTargetView(handle, green, 1, &second);
        if (enhanced) {
            D3D12_TEXTURE_BARRIER eb{};
            eb.SyncBefore = D3D12_BARRIER_SYNC_RENDER_TARGET;
            eb.SyncAfter = D3D12_BARRIER_SYNC_ALL_SHADING;
            eb.AccessBefore = D3D12_BARRIER_ACCESS_RENDER_TARGET;
            eb.AccessAfter = D3D12_BARRIER_ACCESS_SHADER_RESOURCE;
            eb.LayoutBefore = D3D12_BARRIER_LAYOUT_RENDER_TARGET;
            eb.LayoutAfter = D3D12_BARRIER_LAYOUT_DIRECT_QUEUE_GENERIC_READ;
            eb.pResource = resource.Get(); eb.Subresources = {0, 1, 0, 1, 0, 1};
            D3D12_BARRIER_GROUP group{}; group.Type = D3D12_BARRIER_TYPE_TEXTURE; group.NumBarriers = 1; group.pTextureBarriers = &eb;
            enhancedList->Barrier(1, &group); enhancedList->Close();
        } else {
            std::swap(b.Transition.StateBefore, b.Transition.StateAfter);
            list->ResourceBarrier(1, &b); list->Close();
        }
        if (untracked) {
            ID3D12CommandList* lists[]{untrackedList.Get(), activeList};
            queue->ExecuteCommandLists(2, lists);
        } else {
            ID3D12CommandList* lists[]{activeList};
            queue->ExecuteCommandLists(1, lists);
        }
        queue->Signal(fence.Get(), frame);
        fence->SetEventOnCompletion(frame, event); WaitForSingleObject(event, 3000);
        Sleep(16);
    }
    CloseHandle(event);
    return 0;
}
