// Private implementation included after Graphics. Input textures contain premultiplied BGRA bytes.
struct MeshVertex { float x,y,u,v,opacity; };
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectUpdateTexture(Graphics* g,UINT id,const BYTE* bytes,UINT length){
    if(!g||id>=g->textures.size()||!bytes)return E_INVALIDARG;
    ComPtr<ID3D11Resource> resource;g->textures[id]->GetResource(&resource);ComPtr<ID3D11Texture2D> texture;HRESULT hr=resource.As(&texture);if(FAILED(hr))return hr;
    D3D11_TEXTURE2D_DESC d;texture->GetDesc(&d);if(length!=d.Width*d.Height*4)return E_INVALIDARG;
    g->context->UpdateSubresource(texture.Get(),0,nullptr,bytes,d.Width*4,0);return g->device->GetDeviceRemovedReason();
}
static HRESULT PrepareMesh(Graphics* g) {
    if(g->vertexShader)return S_OK;
    const char* shader=R"(
struct V {float2 p:POSITION;float2 uv:TEXCOORD0;float opacity:TEXCOORD1;};
struct P {float4 p:SV_POSITION;float2 uv:TEXCOORD0;float opacity:TEXCOORD1;};
P vs(V v){P p;p.p=float4(v.p,0,1);p.uv=v.uv;p.opacity=v.opacity;return p;}
Texture2D tex:register(t0);SamplerState samp:register(s0);
float4 ps(P p):SV_TARGET{return tex.Sample(samp,p.uv)*p.opacity;}
)";
    ComPtr<ID3DBlob> vs,ps,error;
    HRESULT hr=D3DCompile(shader,strlen(shader),nullptr,nullptr,nullptr,"vs","vs_4_0",D3DCOMPILE_ENABLE_STRICTNESS,0,&vs,&error);
    if(FAILED(hr))return hr;
    hr=D3DCompile(shader,strlen(shader),nullptr,nullptr,nullptr,"ps","ps_4_0",D3DCOMPILE_ENABLE_STRICTNESS,0,&ps,&error);
    if(FAILED(hr))return hr;
    // Create shader last: it is the initialization-complete flag.
    hr=g->device->CreatePixelShader(ps->GetBufferPointer(),ps->GetBufferSize(),nullptr,&g->pixelShader);if(FAILED(hr))return hr;
    D3D11_INPUT_ELEMENT_DESC elements[]={
        {"POSITION",0,DXGI_FORMAT_R32G32_FLOAT,0,0,D3D11_INPUT_PER_VERTEX_DATA,0},
        {"TEXCOORD",0,DXGI_FORMAT_R32G32_FLOAT,0,8,D3D11_INPUT_PER_VERTEX_DATA,0},
        {"TEXCOORD",1,DXGI_FORMAT_R32_FLOAT,0,16,D3D11_INPUT_PER_VERTEX_DATA,0}};
    hr=g->device->CreateInputLayout(elements,3,vs->GetBufferPointer(),vs->GetBufferSize(),&g->layout);if(FAILED(hr))return hr;
    D3D11_SAMPLER_DESC sd={};sd.Filter=D3D11_FILTER_MIN_MAG_MIP_LINEAR;sd.AddressU=sd.AddressV=sd.AddressW=D3D11_TEXTURE_ADDRESS_CLAMP;sd.MaxLOD=D3D11_FLOAT32_MAX;
    hr=g->device->CreateSamplerState(&sd,&g->sampler);if(FAILED(hr))return hr;
    D3D11_BLEND_DESC bd={};auto& rt=bd.RenderTarget[0];rt.BlendEnable=TRUE;rt.SrcBlend=D3D11_BLEND_ONE;rt.DestBlend=D3D11_BLEND_INV_SRC_ALPHA;
    rt.BlendOp=rt.BlendOpAlpha=D3D11_BLEND_OP_ADD;rt.SrcBlendAlpha=D3D11_BLEND_ONE;rt.DestBlendAlpha=D3D11_BLEND_INV_SRC_ALPHA;rt.RenderTargetWriteMask=D3D11_COLOR_WRITE_ENABLE_ALL;
    hr=g->device->CreateBlendState(&bd,&g->blend);if(FAILED(hr))return hr;
    D3D11_RASTERIZER_DESC rd={};rd.FillMode=D3D11_FILL_SOLID;rd.CullMode=D3D11_CULL_NONE;rd.DepthClipEnable=TRUE;
    hr=g->device->CreateRasterizerState(&rd,&g->raster);if(FAILED(hr))return hr;
    return g->device->CreateVertexShader(vs->GetBufferPointer(),vs->GetBufferSize(),nullptr,&g->vertexShader);
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectUploadTexture(Graphics* g,UINT width,UINT height,const BYTE* bytes,UINT length,UINT* id) {
    if(!g||!bytes||!id||!width||!height||width>4096||height>4096||length!=width*height*4||g->textures.size()>=1024)return E_INVALIDARG;
    D3D11_TEXTURE2D_DESC d={};d.Width=width;d.Height=height;d.MipLevels=1;d.ArraySize=1;d.Format=DXGI_FORMAT_B8G8R8A8_UNORM;d.SampleDesc.Count=1;d.Usage=D3D11_USAGE_DEFAULT;d.BindFlags=D3D11_BIND_SHADER_RESOURCE;
    D3D11_SUBRESOURCE_DATA data={};data.pSysMem=bytes;data.SysMemPitch=width*4;
    ComPtr<ID3D11Texture2D> texture;HRESULT hr=g->device->CreateTexture2D(&d,&data,&texture);if(FAILED(hr))return hr;
    ComPtr<ID3D11ShaderResourceView> view;hr=g->device->CreateShaderResourceView(texture.Get(),nullptr,&view);if(FAILED(hr))return hr;
    try{g->textures.push_back(view);}catch(const std::bad_alloc&){return E_OUTOFMEMORY;}
    *id=static_cast<UINT>(g->textures.size()-1);return S_OK;
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectBeginModel(Graphics* g) {
    if(!g)return E_INVALIDARG;HRESULT hr=PrepareMesh(g);if(FAILED(hr))return hr;
    g->groupStage=0;ID3D11ShaderResourceView* empty[2]={nullptr,nullptr};g->context->PSSetShaderResources(0,2,empty);
    const float clear[4]={0,0,0,0};g->context->ClearRenderTargetView(g->target.Get(),clear);
    g->context->OMSetRenderTargets(1,g->target.GetAddressOf(),nullptr);g->context->OMSetBlendState(g->blend.Get(),nullptr,0xffffffff);
    D3D11_TEXTURE2D_DESC d;g->frame->GetDesc(&d);D3D11_VIEWPORT vp={0,0,static_cast<float>(d.Width),static_cast<float>(d.Height),0,1};
    g->context->RSSetViewports(1,&vp);g->context->RSSetState(g->raster.Get());g->context->IASetInputLayout(g->layout.Get());g->context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    g->context->VSSetShader(g->vertexShader.Get(),nullptr,0);g->context->PSSetShader(g->pixelShader.Get(),nullptr,0);g->context->PSSetSamplers(0,1,g->sampler.GetAddressOf());return S_OK;
}
static HRESULT UploadBuffer(Graphics* g,ComPtr<ID3D11Buffer>& buffer,UINT& capacity,UINT flags,const void* data,UINT bytes) {
    if(bytes>capacity){D3D11_BUFFER_DESC d={};d.ByteWidth=bytes;d.Usage=D3D11_USAGE_DYNAMIC;d.BindFlags=flags;d.CPUAccessFlags=D3D11_CPU_ACCESS_WRITE;
        ComPtr<ID3D11Buffer> next;HRESULT hr=g->device->CreateBuffer(&d,nullptr,&next);if(FAILED(hr))return hr;buffer=next;capacity=bytes;}
    D3D11_MAPPED_SUBRESOURCE mapped={};HRESULT hr=g->context->Map(buffer.Get(),0,D3D11_MAP_WRITE_DISCARD,0,&mapped);if(FAILED(hr))return hr;
    memcpy(mapped.pData,data,bytes);g->context->Unmap(buffer.Get(),0);return S_OK;
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectSetBlendMode(Graphics* g,int mode){if(!g||mode<0||mode>3)return E_INVALIDARG;g->blendMode=mode;return S_OK;}
static HRESULT PrepareBlend(Graphics* g){
    if(!g->blendFrame){D3D11_TEXTURE2D_DESC d;g->frame->GetDesc(&d);HRESULT hr=g->device->CreateTexture2D(&d,nullptr,&g->blendFrame);if(FAILED(hr))return hr;
        hr=g->device->CreateShaderResourceView(g->blendFrame.Get(),nullptr,&g->blendView);if(FAILED(hr))return hr;}
    auto& shader=g->blendShaders[g->blendMode-1];
    if(!shader){
        const char* code=R"(
struct P {float4 p:SV_POSITION;float2 uv:TEXCOORD0;float opacity:TEXCOORD1;};
Texture2D tex:register(t0);Texture2D destination:register(t1);SamplerState samp:register(s0);
float4 ps(P p):SV_TARGET{
 float4 s=tex.Sample(samp,p.uv)*p.opacity,d=destination.Load(int3(p.p.xy,0));
 float3 cs=s.a>0?s.rgb/s.a:0,cd=d.a>0?d.rgb/d.a:0;
#if MODE == 1
 float3 b=cs*cd;
#elif MODE == 2
 float3 b=1-(1-cs)*(1-cd);
#else
 float3 b=min(1,cs+cd);
#endif
 return float4(s.rgb*(1-d.a)+b*s.a*d.a+d.rgb*(1-s.a),s.a+d.a*(1-s.a));
})";
        const char* mode=g->blendMode==1?"1":g->blendMode==2?"2":"3";D3D_SHADER_MACRO macros[]={{"MODE",mode},{nullptr,nullptr}};ComPtr<ID3DBlob> compiled,error;
        HRESULT hr=D3DCompile(code,strlen(code),nullptr,macros,nullptr,"ps","ps_4_0",D3DCOMPILE_ENABLE_STRICTNESS,0,&compiled,&error);if(FAILED(hr))return hr;
        hr=g->device->CreatePixelShader(compiled->GetBufferPointer(),compiled->GetBufferSize(),nullptr,&shader);if(FAILED(hr))return hr;
    }
    ID3D11ShaderResourceView* empty=nullptr;g->context->PSSetShaderResources(1,1,&empty);
    auto source=g->groupStage==1?g->contentFrame.Get():g->groupStage==2?g->maskFrame.Get():g->frame.Get();g->context->CopyResource(g->blendFrame.Get(),source);
    g->context->PSSetShaderResources(1,1,g->blendView.GetAddressOf());g->context->PSSetShader(shader.Get(),nullptr,0);g->context->OMSetBlendState(nullptr,nullptr,0xffffffff);return S_OK;
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectDrawMesh(Graphics* g,UINT texture,const MeshVertex* vertices,UINT vertexCount,const UINT* indices,UINT indexCount) {
    if(!g||!g->vertexShader||texture>=g->textures.size()||!vertices||!indices||!vertexCount||vertexCount>1000000||!indexCount||indexCount>3000000||indexCount%3)return E_INVALIDARG;
    for(UINT i=0;i<vertexCount;i++){const auto& v=vertices[i];if(!std::isfinite(v.x)||!std::isfinite(v.y)||!std::isfinite(v.u)||!std::isfinite(v.v)||!std::isfinite(v.opacity)||v.opacity<0||v.opacity>1)return E_INVALIDARG;}
    for(UINT i=0;i<indexCount;i++)if(indices[i]>=vertexCount)return E_INVALIDARG;
    HRESULT hr=UploadBuffer(g,g->vertices,g->vertexCapacity,D3D11_BIND_VERTEX_BUFFER,vertices,vertexCount*sizeof(MeshVertex));if(FAILED(hr))return hr;
    hr=UploadBuffer(g,g->indices,g->indexCapacity,D3D11_BIND_INDEX_BUFFER,indices,indexCount*sizeof(UINT));if(FAILED(hr))return hr;
    UINT stride=sizeof(MeshVertex),offset=0;g->context->IASetVertexBuffers(0,1,g->vertices.GetAddressOf(),&stride,&offset);g->context->IASetIndexBuffer(g->indices.Get(),DXGI_FORMAT_R32_UINT,0);
    g->context->PSSetShaderResources(0,1,g->textures[texture].GetAddressOf());
    // Each triangle must observe earlier fragments, including self-overlapping meshes.
    // This correctness path is deliberately conservative; optimize destination copies after parity QA.
    if(g->blendMode){for(UINT i=0;i<indexCount;i+=3){hr=PrepareBlend(g);if(FAILED(hr))return hr;g->context->DrawIndexed(3,i,0);}}
    else g->context->DrawIndexed(indexCount,0,0);
    if(g->blendMode){ID3D11ShaderResourceView* empty=nullptr;g->context->PSSetShaderResources(1,1,&empty);g->context->PSSetShader(g->pixelShader.Get(),nullptr,0);g->context->OMSetBlendState(g->blend.Get(),nullptr,0xffffffff);}
    return g->device->GetDeviceRemovedReason();
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectEndModel(Graphics* g,BOOL present) {
    if(!g||g->groupStage!=0)return E_INVALIDARG;if(!present){g->context->Flush();return g->device->GetDeviceRemovedReason();}
    ComPtr<ID3D11Texture2D> back;HRESULT hr=g->swap->GetBuffer(0,IID_PPV_ARGS(&back));if(FAILED(hr))return hr;
    g->context->CopyResource(back.Get(),g->frame.Get());hr=g->swap->Present(0,DXGI_PRESENT_DO_NOT_WAIT);
    return hr==DXGI_ERROR_WAS_STILL_DRAWING||hr==DXGI_STATUS_OCCLUDED?S_FALSE:hr;
}

static HRESULT MakeSurface(Graphics* g,ComPtr<ID3D11Texture2D>& texture,ComPtr<ID3D11RenderTargetView>& target,ComPtr<ID3D11ShaderResourceView>& view){
    D3D11_TEXTURE2D_DESC d;g->frame->GetDesc(&d);
    HRESULT hr=g->device->CreateTexture2D(&d,nullptr,&texture);if(FAILED(hr))return hr;
    hr=g->device->CreateRenderTargetView(texture.Get(),nullptr,&target);if(FAILED(hr))return hr;
    return g->device->CreateShaderResourceView(texture.Get(),nullptr,&view);
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectBeginClip(Graphics* g){
    if(!g||!g->vertexShader||g->groupStage!=0)return E_INVALIDARG;
    if(!g->compositePixel){
        HRESULT hr=MakeSurface(g,g->contentFrame,g->contentTarget,g->contentView);if(FAILED(hr))return hr;
        hr=MakeSurface(g,g->maskFrame,g->maskTarget,g->maskView);if(FAILED(hr))return hr;
        const char* code=R"(
float4 vs(uint id:SV_VertexID):SV_POSITION {float2 p=float2((id<<1)&2,id&2);return float4(p*float2(2,-2)+float2(-1,1),0,1);}
Texture2D content:register(t0);Texture2D mask:register(t1);
float4 ps(float4 pos:SV_POSITION):SV_TARGET {int3 p=int3(pos.xy,0);return content.Load(p)*mask.Load(p).a;}
)";
        ComPtr<ID3DBlob> vs,ps,error;
        hr=D3DCompile(code,strlen(code),nullptr,nullptr,nullptr,"vs","vs_4_0",D3DCOMPILE_ENABLE_STRICTNESS,0,&vs,&error);if(FAILED(hr))return hr;
        hr=D3DCompile(code,strlen(code),nullptr,nullptr,nullptr,"ps","ps_4_0",D3DCOMPILE_ENABLE_STRICTNESS,0,&ps,&error);if(FAILED(hr))return hr;
        hr=g->device->CreateVertexShader(vs->GetBufferPointer(),vs->GetBufferSize(),nullptr,&g->compositeVertex);if(FAILED(hr))return hr;
        hr=g->device->CreatePixelShader(ps->GetBufferPointer(),ps->GetBufferSize(),nullptr,&g->compositePixel);if(FAILED(hr))return hr;
    }
    ID3D11ShaderResourceView* empty[2]={nullptr,nullptr};g->context->PSSetShaderResources(0,2,empty);
    const float clear[4]={0,0,0,0};g->context->ClearRenderTargetView(g->contentTarget.Get(),clear);g->context->ClearRenderTargetView(g->maskTarget.Get(),clear);
    g->context->OMSetRenderTargets(1,g->contentTarget.GetAddressOf(),nullptr);g->groupStage=1;return S_OK;
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectClipMask(Graphics* g){
    if(!g||g->groupStage!=1)return E_INVALIDARG;
    g->context->OMSetRenderTargets(1,g->maskTarget.GetAddressOf(),nullptr);g->groupStage=2;return S_OK;
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectEndClip(Graphics* g){
    if(!g||g->groupStage!=2)return E_INVALIDARG;
    g->context->OMSetRenderTargets(1,g->target.GetAddressOf(),nullptr);
    ID3D11ShaderResourceView* views[2]={g->contentView.Get(),g->maskView.Get()};g->context->PSSetShaderResources(0,2,views);
    g->context->IASetInputLayout(nullptr);g->context->VSSetShader(g->compositeVertex.Get(),nullptr,0);g->context->PSSetShader(g->compositePixel.Get(),nullptr,0);
    g->context->Draw(3,0);
    ID3D11ShaderResourceView* empty[2]={nullptr,nullptr};g->context->PSSetShaderResources(0,2,empty);
    g->context->IASetInputLayout(g->layout.Get());g->context->VSSetShader(g->vertexShader.Get(),nullptr,0);g->context->PSSetShader(g->pixelShader.Get(),nullptr,0);
    g->groupStage=0;return g->device->GetDeviceRemovedReason();
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectReadFrame(Graphics* g,BYTE* bytes,UINT length) {
    if(!g||!bytes)return E_INVALIDARG;D3D11_TEXTURE2D_DESC d;g->frame->GetDesc(&d);if(length!=d.Width*d.Height*4)return E_INVALIDARG;
    UINT ignored;HRESULT hr=ConnectReadPixel(g,&ignored);if(FAILED(hr))return hr;
    D3D11_MAPPED_SUBRESOURCE mapped={};hr=g->context->Map(g->staging.Get(),0,D3D11_MAP_READ,0,&mapped);if(FAILED(hr))return hr;
    for(UINT y=0;y<d.Height;y++)memcpy(bytes+y*d.Width*4,static_cast<BYTE*>(mapped.pData)+y*mapped.RowPitch,d.Width*4);
    g->context->Unmap(g->staging.Get(),0);return S_OK;
}
