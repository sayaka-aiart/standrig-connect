#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <wrl/client.h>
#include <new>
#include <d3dcompiler.h>
#include <vector>
#include <cmath>
#ifdef CONNECT_SPOUT
#include <SpoutDX.h>
#endif
using Microsoft::WRL::ComPtr;
struct Graphics {
#ifdef CONNECT_SPOUT
    spoutDX* sender=nullptr;
#endif
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    ComPtr<IDXGISwapChain> swap;
    ComPtr<ID3D11Texture2D> frame;
    ComPtr<ID3D11RenderTargetView> target;
    ComPtr<ID3D11Texture2D> staging;
    ComPtr<ID3D11VertexShader> vertexShader;
    ComPtr<ID3D11PixelShader> pixelShader;
    ComPtr<ID3D11InputLayout> layout;
    ComPtr<ID3D11SamplerState> sampler;
    ComPtr<ID3D11BlendState> blend;
    ComPtr<ID3D11RasterizerState> raster;
    ComPtr<ID3D11Buffer> vertices, indices;
    UINT vertexCapacity=0,indexCapacity=0;
    std::vector<ComPtr<ID3D11ShaderResourceView>> textures;
    ComPtr<ID3D11Texture2D> maskFrame,contentFrame;
    ComPtr<ID3D11RenderTargetView> maskTarget,contentTarget;
    ComPtr<ID3D11ShaderResourceView> maskView,contentView;
    ComPtr<ID3D11VertexShader> compositeVertex;
    ComPtr<ID3D11PixelShader> compositePixel;
    int groupStage=0;
    int blendMode=0;
    ComPtr<ID3D11Texture2D> blendFrame;
    ComPtr<ID3D11ShaderResourceView> blendView;
    ComPtr<ID3D11PixelShader> blendShaders[3];
    ComPtr<ID3D11VertexShader> pathVertex;
    ComPtr<ID3D11PixelShader> pathPixel;
    ComPtr<ID3D11InputLayout> pathLayout;
};
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectCreate(HWND window, UINT width, UINT height, Graphics** result) {
    if(!result || !window || width==0 || height==0 || width>4096 || height>4096)return E_INVALIDARG;
    *result=nullptr; auto g=new(std::nothrow) Graphics();if(!g)return E_OUTOFMEMORY;
    DXGI_SWAP_CHAIN_DESC swap={};swap.BufferDesc.Width=width;swap.BufferDesc.Height=height;
    swap.BufferDesc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;swap.SampleDesc.Count=1;swap.BufferUsage=DXGI_USAGE_RENDER_TARGET_OUTPUT;
    swap.BufferCount=2;swap.OutputWindow=window;swap.Windowed=TRUE;swap.SwapEffect=DXGI_SWAP_EFFECT_FLIP_DISCARD;
    HRESULT hr=D3D11CreateDeviceAndSwapChain(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        nullptr,0,D3D11_SDK_VERSION,&swap,&g->swap,&g->device,nullptr,&g->context);
    if(FAILED(hr)){delete g;return hr;}
    D3D11_TEXTURE2D_DESC desc={};desc.Width=width;desc.Height=height;desc.MipLevels=1;desc.ArraySize=1;
    desc.Format=DXGI_FORMAT_B8G8R8A8_UNORM;desc.SampleDesc.Count=1;desc.Usage=D3D11_USAGE_DEFAULT;
    desc.BindFlags=D3D11_BIND_RENDER_TARGET|D3D11_BIND_SHADER_RESOURCE;
    hr=g->device->CreateTexture2D(&desc,nullptr,&g->frame);
    if(SUCCEEDED(hr))hr=g->device->CreateRenderTargetView(g->frame.Get(),nullptr,&g->target);
    if(FAILED(hr)){delete g;return hr;}
    *result=g;return S_OK;
}
// Resize render surfaces on the model worker; retain uploaded textures and shaders.
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectResize(Graphics* g,UINT width,UINT height){
    if(!g||width<256||height<256||width>1920||height>1920)return E_INVALIDARG;
    D3D11_TEXTURE2D_DESC desc;g->frame->GetDesc(&desc);
    if(desc.Width==width&&desc.Height==height)return S_OK;
    desc.Width=width;desc.Height=height;
    ComPtr<ID3D11Texture2D> frame;ComPtr<ID3D11RenderTargetView> target;
    HRESULT hr=g->device->CreateTexture2D(&desc,nullptr,&frame);
    if(SUCCEEDED(hr))hr=g->device->CreateRenderTargetView(frame.Get(),nullptr,&target);
    if(FAILED(hr))return hr;
    g->context->ClearState();g->context->Flush();
    hr=g->swap->ResizeBuffers(2,width,height,DXGI_FORMAT_B8G8R8A8_UNORM,0);
    if(FAILED(hr))return hr;
    g->frame=frame;g->target=target;g->staging.Reset();
    g->compositePixel.Reset();g->compositeVertex.Reset();
    g->maskView.Reset();g->contentView.Reset();g->maskTarget.Reset();g->contentTarget.Reset();
    g->maskFrame.Reset();g->contentFrame.Reset();g->blendView.Reset();g->blendFrame.Reset();g->groupStage=0;
    return S_OK;
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectDrawDiagnostic(Graphics* g,float phase,BOOL present) {
    if(!g)return E_INVALIDARG;
    const float color[4]={0.15f+0.25f*phase,0.15f,0.45f,1.0f};
    g->context->ClearRenderTargetView(g->target.Get(),color);
    if(!present){g->context->Flush();return g->device->GetDeviceRemovedReason();}
    ComPtr<ID3D11Texture2D> back;
    HRESULT hr=g->swap->GetBuffer(0,IID_PPV_ARGS(&back));if(FAILED(hr))return hr;
    g->context->CopyResource(back.Get(),g->frame.Get());
    hr=g->swap->Present(0,DXGI_PRESENT_DO_NOT_WAIT);
    if(hr==DXGI_ERROR_WAS_STILL_DRAWING || hr==DXGI_STATUS_OCCLUDED)return S_FALSE;
    return hr;
}
// Diagnostic only: production output must remain on the GPU.
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectReadPixel(Graphics* g,UINT* bgra) {
    if(!g||!bgra)return E_INVALIDARG;
    if(!g->staging){D3D11_TEXTURE2D_DESC d;g->frame->GetDesc(&d);d.Usage=D3D11_USAGE_STAGING;d.BindFlags=0;d.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
        HRESULT hr=g->device->CreateTexture2D(&d,nullptr,&g->staging);if(FAILED(hr))return hr;}
    g->context->CopyResource(g->staging.Get(),g->frame.Get());D3D11_MAPPED_SUBRESOURCE mapped={};
    HRESULT hr=g->context->Map(g->staging.Get(),0,D3D11_MAP_READ,0,&mapped);if(FAILED(hr))return hr;
    *bgra=*static_cast<UINT*>(mapped.pData);g->context->Unmap(g->staging.Get(),0);return S_OK;
}
extern "C" __declspec(dllexport) void __cdecl ConnectDestroy(Graphics* g){if(g){
#ifdef CONNECT_SPOUT
if(g->sender){g->sender->ReleaseSender();delete g->sender;g->sender=nullptr;}
#endif
g->context->ClearState();g->context->Flush();delete g;}}
#include "TexturedMesh.h"
#include "ArtPaths.h"

extern "C" __declspec(dllexport) HRESULT __cdecl ConnectSpoutFrame(Graphics* g,BOOL enabled){
    if(!g)return E_INVALIDARG;
#ifdef CONNECT_SPOUT
    if(!enabled){if(g->sender){g->sender->ReleaseSender();delete g->sender;g->sender=nullptr;}return S_FALSE;}
    if(!g->sender){
        auto sender=new(std::nothrow) spoutDX();if(!sender)return E_OUTOFMEMORY;
        if(!sender->OpenDirectX11(g->device.Get())||!sender->SetSenderName("StandRig Connect")){delete sender;return E_FAIL;}
        g->sender=sender;
    }
    return g->sender->SendTexture(g->frame.Get())?S_OK:E_FAIL;
#else
    return enabled?E_NOTIMPL:S_FALSE;
#endif
}