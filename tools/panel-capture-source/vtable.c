#define CINTERFACE
#include <d3d12.h>
#include <stddef.h>
unsigned int EnhancedBarrierIndex(void) {
    return (unsigned int)(offsetof(ID3D12GraphicsCommandList7Vtbl, Barrier) / sizeof(void*));
}
