using System.Buffers.Binary;
using System.Diagnostics;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using StandRig.Connect.Audio;
namespace StandRig.Connect.Desktop;

internal sealed record AudioDevice(string Id,string Name){public override string ToString()=>Name;}
internal sealed class AudioInput : IDisposable
{
    private CancellationTokenSource? stop;
    private Task? worker;
    private bool disposed;
    private readonly LipSyncControl control;
    internal bool Running=>worker is {IsCompleted:false};
    internal AudioInput(LipSyncControl control)=>this.control=control;
    internal static AudioDevice[] Devices()
    {
        using var enumerator=new MMDeviceEnumerator();var result=new List<AudioDevice>();
        foreach(var device in enumerator.EnumerateAudioEndPoints(DataFlow.Capture,DeviceState.Active))using(device)result.Add(new(device.ID,device.FriendlyName));
        return result.ToArray();
    }
    internal static void CheckVirtualInput(string report)
    {
        var control=new LipSyncControl();using var input=new AudioInput(control);
        try{
            var device=Devices().Single(d=>d.Name=="CABLE Output (VB-Audio Virtual Cable)");var cycles=new List<long>();
            for(int cycle=0;cycle<3;cycle++){
                input.Start(device.Id);for(int i=0;i<100&&control.Snapshot().Frames<30&&control.Snapshot().InputRunning;i++)Thread.Sleep(50);
                var active=control.Snapshot();if(active.Frames<30||!active.InputRunning)throw new InvalidOperationException(active.Message);
                input.StopAsync().GetAwaiter().GetResult();if(input.Running||control.Snapshot().Enabled)throw new InvalidOperationException("Audio worker did not stop");cycles.Add(active.Frames);
            }
            File.WriteAllText(report,System.Text.Json.JsonSerializer.Serialize(new{passed=true,virtualInputOpened=true,microphoneOpened=false,audioSaved=false,modelApplied=false,cycles,stopped=!input.Running}));
        }catch(Exception e){File.WriteAllText(report,System.Text.Json.JsonSerializer.Serialize(new{passed=false,error=e.ToString()}));Environment.ExitCode=1;}
    }
    internal void Start(string deviceId)
    {
        ObjectDisposedException.ThrowIf(disposed,this);
        if(Running)throw new InvalidOperationException("先に音声入力を停止してください。");
        stop?.Dispose();stop=new();var token=stop.Token;control.BeginInput();
        worker=Task.Factory.StartNew(()=>Run(deviceId,token),CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
    }
    private void Run(string deviceId,CancellationToken token)
    {
        string? error=null;
        try{
            using var enumerator=new MMDeviceEnumerator();using var device=enumerator.GetDevice(deviceId);
            using var ended=new ManualResetEvent(false);using var recordingStopped=new ManualResetEvent(false);
            using var capture=new WasapiCapture(device,true,20);
            var format=capture.WaveFormat;ValidateFormat(format);
            var resampler=new AudioResampler(format.SampleRate);var stream=new AudioFeatureStream();var batch=new float[MfccAnalyzer.HopSize];int written=0;
            Exception? failure=null;long lastPacket=Stopwatch.GetTimestamp();
            capture.DataAvailable+=(_,e)=>{
                try{
                    if(token.IsCancellationRequested||e.BytesRecorded==0)return;
                    if(e.BytesRecorded>262144||e.BytesRecorded%format.BlockAlign!=0)throw new InvalidOperationException("Invalid audio packet");
                    var mono=new float[e.BytesRecorded/format.BlockAlign];Decode(e.Buffer.AsSpan(0,e.BytesRecorded),format,mono);
                    resampler.Push(mono,sample=>{batch[written++]=sample;if(written==batch.Length){stream.Push(batch,control.Feed);written=0;}});
                    Interlocked.Exchange(ref lastPacket,Stopwatch.GetTimestamp());
                }catch(Exception ex){Interlocked.CompareExchange(ref failure,ex,null);ended.Set();}
            };
            capture.RecordingStopped+=(_,e)=>{if(e.Exception!=null)Interlocked.CompareExchange(ref failure,e.Exception,null);ended.Set();recordingStopped.Set();};
            capture.StartRecording();
            while(!token.IsCancellationRequested&&!ended.WaitOne(100)){
                if(Stopwatch.GetElapsedTime(Interlocked.Read(ref lastPacket)).TotalSeconds>3){failure=new IOException("音声入力が届きません。デバイス・Windowsのマイク設定を確認してください。");break;}
            }
            // Stop/Dispose from this control thread, never from the NAudio callback.
            capture.StopRecording();if(!recordingStopped.WaitOne(2500))throw new TimeoutException("録音終了イベントを確認できませんでした。");if(failure!=null)throw failure;
        }catch(Exception ex){error="音声入力エラー: "+ex.Message;}
        finally{control.StopInput(error);}
    }
    internal async Task StopAsync()
    {
        control.StopInput();stop?.Cancel();if(worker!=null)await worker.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(false);
    }
    public void Dispose(){if(disposed)return;disposed=true;StopAsync().GetAwaiter().GetResult();stop?.Dispose();stop=null;}
    private static bool FloatFormat(WaveFormat format)=>format.Encoding==WaveFormatEncoding.IeeeFloat||format is WaveFormatExtensible extensible&&extensible.SubFormat==new Guid("00000003-0000-0010-8000-00aa00389b71");
    private static void ValidateFormat(WaveFormat format)
    {
        bool pcm=format.Encoding==WaveFormatEncoding.Pcm||format is WaveFormatExtensible extensible&&extensible.SubFormat==new Guid("00000001-0000-0010-8000-00aa00389b71");
        if(format.SampleRate<8000||format.SampleRate>192000||format.Channels<1||format.Channels>8||format.BlockAlign!=format.Channels*format.BitsPerSample/8||!(FloatFormat(format)&&format.BitsPerSample==32||pcm&&format.BitsPerSample is 16 or 24 or 32))throw new NotSupportedException("PCM16/24/32またはfloat32、1～8ch、8～192kHzの入力が必要です。");
    }
    internal static void Decode(ReadOnlySpan<byte> bytes,WaveFormat format,Span<float> mono)
    {
        ValidateFormat(format);if(bytes.Length%format.BlockAlign!=0||mono.Length!=bytes.Length/format.BlockAlign)throw new ArgumentException("Invalid PCM buffer");int size=format.BitsPerSample/8;bool floats=FloatFormat(format);
        for(int frame=0;frame<mono.Length;frame++){
            double sum=0;for(int channel=0;channel<format.Channels;channel++){
                var value=bytes.Slice(frame*format.BlockAlign+channel*size,size);
                float sample=floats?BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(value)):size==2?BinaryPrimitives.ReadInt16LittleEndian(value)/32768f:size==4?BinaryPrimitives.ReadInt32LittleEndian(value)/2147483648f:((value[0]|value[1]<<8|value[2]<<16)<<8>>8)/8388608f;
                if(!float.IsFinite(sample)||Math.Abs(sample)>16)throw new ArgumentException("Invalid PCM value");sum+=sample;
            }
            mono[frame]=(float)(sum/format.Channels);
        }
    }
}
