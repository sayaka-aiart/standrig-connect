#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <wrl/client.h>
#include <string>
#include <cstring>
#include <mfreadwrite.h>
#include <mferror.h>
#include <cstdlib>
#include <new>
using Microsoft::WRL::ComPtr;
struct Sources {
    IMFActivate** items=nullptr;UINT count=0;
    ~Sources(){for(UINT i=0;i<count;i++)items[i]->Release();CoTaskMemFree(items);}
};
struct Text { wchar_t* value=nullptr;~Text(){CoTaskMemFree(value);} };
// Returns alternating friendly-name / opaque symbolic-link strings, each NUL terminated.
// Caller owns CoTaskMem memory. Enumeration never activates a media source or captures video.
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectListCameras(wchar_t** data,UINT* length,UINT* count){
    if(!data||!length||!count)return E_POINTER;*data=nullptr;*length=0;*count=0;
    HRESULT com=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
    if(FAILED(com))return com;
    HRESULT hr=MFStartup(MF_VERSION,MFSTARTUP_FULL);
    if(FAILED(hr)){CoUninitialize();return hr;}
    try{
        hr=[&]()->HRESULT{
            ComPtr<IMFAttributes> attributes;HRESULT result=MFCreateAttributes(&attributes,1);if(FAILED(result))return result;
            result=attributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);if(FAILED(result))return result;
            Sources sources;result=MFEnumDeviceSources(attributes.Get(),&sources.items,&sources.count);if(FAILED(result))return result;
            if(sources.count>256)return E_OUTOFMEMORY;
            std::wstring text;
            for(UINT i=0;i<sources.count;i++){
                Text name,link;UINT nameLength=0,linkLength=0;
                result=sources.items[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,&name.value,&nameLength);if(FAILED(result))return result;
                result=sources.items[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,&link.value,&linkLength);if(FAILED(result))return result;
                if(nameLength>32768||linkLength>32768)return E_OUTOFMEMORY;
                text.append(name.value,nameLength);text.push_back(0);text.append(link.value,linkLength);text.push_back(0);
            }
            if(!text.empty()){
                auto memory=static_cast<wchar_t*>(CoTaskMemAlloc(text.size()*sizeof(wchar_t)));if(!memory)return E_OUTOFMEMORY;
                memcpy(memory,text.data(),text.size()*sizeof(wchar_t));*data=memory;
            }
            *length=static_cast<UINT>(text.size());*count=sources.count;return S_OK;
        }();
    }catch(...){hr=E_FAIL;}
    MFShutdown();CoUninitialize();return hr;
}

struct Capture {
    ComPtr<IMFMediaSource> source;ComPtr<IMFSourceReader> reader;
    UINT width=0,height=0;LONG stride=0;bool com=false,mf=false;
    ~Capture(){reader.Reset();if(source)source->Shutdown();source.Reset();if(mf)MFShutdown();if(com)CoUninitialize();}
};
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectOpenCamera(const wchar_t* link,Capture** output){
    if(!link||!output)return E_POINTER;*output=nullptr;
    auto c=new(std::nothrow) Capture();if(!c)return E_OUTOFMEMORY;
    HRESULT hr=[&]()->HRESULT{
        HRESULT r=CoInitializeEx(nullptr,COINIT_MULTITHREADED);if(FAILED(r))return r;c->com=true;
        r=MFStartup(MF_VERSION);if(FAILED(r))return r;c->mf=true;
        ComPtr<IMFAttributes> a;r=MFCreateAttributes(&a,2);if(FAILED(r))return r;
        r=a->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);if(FAILED(r))return r;
        r=a->SetString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,link);if(FAILED(r))return r;
        r=MFCreateDeviceSource(a.Get(),&c->source);if(FAILED(r))return r;
        ComPtr<IMFAttributes> options;r=MFCreateAttributes(&options,1);if(FAILED(r))return r;
        r=options->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING,TRUE);if(FAILED(r))return r;
        r=MFCreateSourceReaderFromMediaSource(c->source.Get(),options.Get(),&c->reader);if(FAILED(r))return r;
        r=c->reader->SetStreamSelection(static_cast<DWORD>(MF_SOURCE_READER_ALL_STREAMS),FALSE);if(FAILED(r))return r;
        r=c->reader->SetStreamSelection(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM),TRUE);if(FAILED(r))return r;
        for(DWORD i=0;i<512;i++){
            ComPtr<IMFMediaType> native; r=c->reader->GetNativeMediaType(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM),i,&native);if(FAILED(r))break;
            UINT w=0,h=0;if(SUCCEEDED(MFGetAttributeSize(native.Get(),MF_MT_FRAME_SIZE,&w,&h))&&w==640&&h==480){
                r=c->reader->SetCurrentMediaType(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM),nullptr,native.Get());if(SUCCEEDED(r))break;
            }
        }
        ComPtr<IMFMediaType> type;r=MFCreateMediaType(&type);if(FAILED(r))return r;
        r=type->SetGUID(MF_MT_MAJOR_TYPE,MFMediaType_Video);if(FAILED(r))return r;
        r=type->SetGUID(MF_MT_SUBTYPE,MFVideoFormat_RGB32);if(FAILED(r))return r;
        r=c->reader->SetCurrentMediaType(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM),nullptr,type.Get());if(FAILED(r))return r;
        type.Reset();r=c->reader->GetCurrentMediaType(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM),&type);if(FAILED(r))return r;
        r=MFGetAttributeSize(type.Get(),MF_MT_FRAME_SIZE,&c->width,&c->height);if(FAILED(r))return r;
        if(!c->width||!c->height||c->width>1920||c->height>1080)return MF_E_INVALIDMEDIATYPE;
        UINT stride=0;r=type->GetUINT32(MF_MT_DEFAULT_STRIDE,&stride);
        if(SUCCEEDED(r))c->stride=static_cast<LONG>(stride);else {r=MFGetStrideForBitmapInfoHeader(MFVideoFormat_RGB32.Data1,c->width,&c->stride);if(FAILED(r))return r;}
        return S_OK;
    }();
    if(FAILED(hr)){delete c;return hr;}*output=c;return S_OK;
}
extern "C" __declspec(dllexport) HRESULT __cdecl ConnectReadCamera(Capture* c,BYTE* pixels,UINT capacity,UINT* width,UINT* height){
    if(!c||!pixels||!width||!height)return E_POINTER;
    *width=c->width;*height=c->height;if(capacity<c->width*c->height*4)return E_INVALIDARG;
    ComPtr<IMFSample> sample;DWORD flags=0;LONGLONG timestamp=0;
    HRESULT hr=c->reader->ReadSample(static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM),0,nullptr,&flags,&timestamp,&sample);if(FAILED(hr))return hr;
    if(flags&(MF_SOURCE_READERF_ERROR|MF_SOURCE_READERF_ENDOFSTREAM|MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED))return E_FAIL;
    if(!sample)return S_FALSE;
    ComPtr<IMFMediaBuffer> buffer;hr=sample->ConvertToContiguousBuffer(&buffer);if(FAILED(hr))return hr;
    ComPtr<IMF2DBuffer> twoD;
    if(SUCCEEDED(buffer.As(&twoD))){
        BYTE* row=nullptr;LONG pitch=0;hr=twoD->Lock2D(&row,&pitch);if(FAILED(hr))return hr;
        if(static_cast<UINT>(std::abs(pitch))<c->width*4){twoD->Unlock2D();return E_FAIL;}
        for(UINT y=0;y<c->height;y++)memcpy(pixels+y*c->width*4,row+static_cast<ptrdiff_t>(y)*pitch,c->width*4);
        twoD->Unlock2D();
    }else{
        BYTE* data=nullptr;DWORD length=0;hr=buffer->Lock(&data,nullptr,&length);if(FAILED(hr))return hr;
        const auto pitch=static_cast<UINT>(std::abs(c->stride));
        if(pitch<c->width*4||static_cast<ULONGLONG>(pitch)*c->height>length){buffer->Unlock();return E_FAIL;}
        for(UINT y=0;y<c->height;y++){UINT row=c->stride<0?c->height-1-y:y;memcpy(pixels+y*c->width*4,data+row*pitch,c->width*4);}
        buffer->Unlock();
    }
    return S_OK;
}
extern "C" __declspec(dllexport) void __cdecl ConnectCloseCamera(Capture* c){delete c;}
