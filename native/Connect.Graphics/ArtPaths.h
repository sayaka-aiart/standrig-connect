// Circle stamps match the public server path brush, including overlap alpha accumulation.
struct PathStamp {float x,y,rx,ry,r,g,b,a;};
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectDrawPath(Graphics* g,const PathStamp* stamps,UINT count){
    if(!g||!g->vertexShader||!stamps||count==0||count>100000)return E_INVALIDARG;
    for(UINT i=0;i<count;i++){const auto& s=stamps[i];if(!std::isfinite(s.x)||!std::isfinite(s.y)||!std::isfinite(s.rx)||!std::isfinite(s.ry)||s.rx<=0||s.ry<=0||!std::isfinite(s.r)||!std::isfinite(s.g)||!std::isfinite(s.b)||!std::isfinite(s.a)||s.a<0||s.a>1)return E_INVALIDARG;}
    if(!g->pathVertex){
        const char* code=R"(
struct I {float4 circle:POSITION;float4 color:COLOR;};
struct P {float4 pos:SV_POSITION;float2 local:TEXCOORD;float4 color:COLOR;};
P vs(I s,uint id:SV_VertexID){float2 q[6]={float2(-1,-1),float2(1,-1),float2(1,1),float2(-1,-1),float2(1,1),float2(-1,1)};P p;p.local=q[id];p.pos=float4(s.circle.xy+q[id]*s.circle.zw,0,1);p.color=s.color;return p;}
float4 ps(P p):SV_TARGET{if(dot(p.local,p.local)>1)discard;return float4(p.color.rgb*p.color.a,p.color.a);}
)";
        ComPtr<ID3DBlob> vs,ps,error;HRESULT hr=D3DCompile(code,strlen(code),nullptr,nullptr,nullptr,"vs","vs_4_0",D3DCOMPILE_ENABLE_STRICTNESS,0,&vs,&error);if(FAILED(hr))return hr;
        hr=D3DCompile(code,strlen(code),nullptr,nullptr,nullptr,"ps","ps_4_0",D3DCOMPILE_ENABLE_STRICTNESS,0,&ps,&error);if(FAILED(hr))return hr;
        D3D11_INPUT_ELEMENT_DESC elements[]={{"POSITION",0,DXGI_FORMAT_R32G32B32A32_FLOAT,0,0,D3D11_INPUT_PER_INSTANCE_DATA,1},{"COLOR",0,DXGI_FORMAT_R32G32B32A32_FLOAT,0,16,D3D11_INPUT_PER_INSTANCE_DATA,1}};
        hr=g->device->CreateInputLayout(elements,2,vs->GetBufferPointer(),vs->GetBufferSize(),&g->pathLayout);if(FAILED(hr))return hr;
        hr=g->device->CreatePixelShader(ps->GetBufferPointer(),ps->GetBufferSize(),nullptr,&g->pathPixel);if(FAILED(hr))return hr;
        hr=g->device->CreateVertexShader(vs->GetBufferPointer(),vs->GetBufferSize(),nullptr,&g->pathVertex);if(FAILED(hr))return hr;
    }
    HRESULT hr=UploadBuffer(g,g->vertices,g->vertexCapacity,D3D11_BIND_VERTEX_BUFFER,stamps,count*sizeof(PathStamp));if(FAILED(hr))return hr;
    UINT stride=sizeof(PathStamp),offset=0;g->context->IASetVertexBuffers(0,1,g->vertices.GetAddressOf(),&stride,&offset);g->context->IASetInputLayout(g->pathLayout.Get());
    g->context->VSSetShader(g->pathVertex.Get(),nullptr,0);g->context->PSSetShader(g->pathPixel.Get(),nullptr,0);g->context->OMSetBlendState(g->blend.Get(),nullptr,0xffffffff);g->context->DrawInstanced(6,count,0,0);
    g->context->IASetInputLayout(g->layout.Get());g->context->VSSetShader(g->vertexShader.Get(),nullptr,0);g->context->PSSetShader(g->pixelShader.Get(),nullptr,0);return g->device->GetDeviceRemovedReason();
}
