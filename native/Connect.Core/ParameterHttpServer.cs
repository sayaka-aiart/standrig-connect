using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace StandRig.Connect;

public sealed class ParameterHttpServer : IDisposable
{
    private readonly WebApplication application;
    private readonly CancellationTokenSource stop=new();
    private readonly ParameterControl control;
    private readonly string token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private readonly string sessionFile,sessionContent;
    private static readonly JsonSerializerOptions Json=new(){PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
    public string Url {get;}
    public ParameterHttpServer(ParameterControl control,string sessionFile,int port=22036)
    {
        this.control=control;this.sessionFile=sessionFile;
        if(port<1||port>65535)throw new ArgumentOutOfRangeException(nameof(port));
        Url=$"http://127.0.0.1:{port}";
        var builder=WebApplication.CreateSlimBuilder(new WebApplicationOptions{Args=Array.Empty<string>()});
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options=>{options.Listen(IPAddress.Loopback,port);options.Limits.MaxRequestBodySize=32768;options.Limits.RequestHeadersTimeout=TimeSpan.FromSeconds(5);options.Limits.MaxConcurrentConnections=16;});
        application=builder.Build();application.Run(Handle);
        sessionContent=JsonSerializer.Serialize(new{apiVersion=1,url=Url,token},Json);
        try{
            Task.Run(()=>application.StartAsync()).GetAwaiter().GetResult();Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(sessionFile))!);
            string temporary=sessionFile+"."+Guid.NewGuid().ToString("N")+".tmp";
            try{File.WriteAllText(temporary,sessionContent);File.Move(temporary,sessionFile,true);}finally{if(File.Exists(temporary))File.Delete(temporary);}
        }catch{application.DisposeAsync().AsTask().GetAwaiter().GetResult();stop.Dispose();throw;}
    }
    private static void Fields(JsonElement value,params string[] allowed)
    {
        if(value.ValueKind!=JsonValueKind.Object)throw new ArgumentException("Expected object");
        var seen=new HashSet<string>();foreach(var p in value.EnumerateObject())if(!allowed.Contains(p.Name)||!seen.Add(p.Name))throw new ArgumentException("Unknown or duplicate field: "+p.Name);
    }
    private async Task Handle(HttpContext c)
    {
        var request=c.Request;int code=200;object response;
        try{
            if(c.Connection.RemoteIpAddress==null||!IPAddress.IsLoopback(c.Connection.RemoteIpAddress)||request.Headers.ContainsKey("Origin")||request.Host.Value!=new Uri(Url).Authority){await Reply(c,403,new{error="Loopback non-browser clients only"});return;}
            byte[] supplied=Encoding.UTF8.GetBytes(request.Headers["Authorization"].ToString());byte[] expected=Encoding.UTF8.GetBytes("Bearer "+token);
            if(!CryptographicOperations.FixedTimeEquals(supplied,expected)){await Reply(c,401,new{error="Bearer token required"});return;}
            string route=request.Path.Value??"";
            if(request.Method=="GET"&&route=="/api/v1/parameters"){await Reply(c,200,control.Snapshot());return;}
            if(request.Method!="POST"||route is not ("/api/v1/parameters/set" or "/api/v1/parameters/clear")){await Reply(c,404,new{error="Unknown route or method"});return;}
            if(request.ContentType?.Split(';')[0].Trim()!="application/json"){await Reply(c,415,new{error="application/json required"});return;}
            if(request.ContentLength>32768){await Reply(c,413,new{error="Body exceeds 32 KiB"});return;}
            using var deadline=CancellationTokenSource.CreateLinkedTokenSource(stop.Token);deadline.CancelAfter(TimeSpan.FromSeconds(2));
            using var bytes=new MemoryStream();var buffer=new byte[4096];
            while(true){int n=await request.Body.ReadAsync(buffer,deadline.Token);if(n==0)break;if(bytes.Length+n>32768){await Reply(c,413,new{error="Body exceeds 32 KiB"});return;}bytes.Write(buffer,0,n);}
            using var doc=JsonDocument.Parse(bytes.ToArray(),new JsonDocumentOptions{MaxDepth=8});var root=doc.RootElement;
            Fields(root,route.EndsWith("/set")?new[]{"modelSession","values","ttlMs"}:new[]{"modelSession","ids"});
            string modelSession=root.GetProperty("modelSession").GetString()??throw new ArgumentException("modelSession required");
            if(route.EndsWith("/set")){
                var value=root.GetProperty("values");if(value.ValueKind!=JsonValueKind.Object)throw new ArgumentException("values must be an object");
                var changes=new Dictionary<string,double>();foreach(var p in value.EnumerateObject())if(!changes.TryAdd(p.Name,p.Value.GetDouble()))throw new ArgumentException("Duplicate parameter");
                control.Set(modelSession,changes,root.TryGetProperty("ttlMs",out var ttl)?ttl.GetInt32():1000);
            }else{
                string[]? ids=null;if(root.TryGetProperty("ids",out var value)){if(value.ValueKind!=JsonValueKind.Array)throw new ArgumentException("ids must be an array");ids=value.EnumerateArray().Select(v=>v.GetString()??throw new ArgumentException("Invalid id")).ToArray();}
                control.Clear(modelSession,ids);
            }
            response=new{accepted=true,modelSession};
        }
        catch(BadHttpRequestException e){code=e.StatusCode;response=new{error="Invalid HTTP request"};}
        catch(OperationCanceledException){code=408;response=new{error="Request timed out"};}
        catch(ParameterSessionException e){code=409;response=new{error=e.Message};}
        catch(Exception e) when(e is InvalidOperationException or ArgumentException or JsonException or KeyNotFoundException or FormatException or OverflowException){code=400;response=new{error="Invalid request",detail=e.Message};}
        await Reply(c,code,response);
    }
    private static async Task Reply(HttpContext c,int status,object body)
    {
        if(status==413||status==408)c.Response.Headers["Connection"]="close";
        byte[] bytes=JsonSerializer.SerializeToUtf8Bytes(body,Json);c.Response.StatusCode=status;c.Response.ContentType="application/json; charset=utf-8";c.Response.Headers["Cache-Control"]="no-store";c.Response.ContentLength=bytes.Length;
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(c.RequestAborted);timeout.CancelAfter(TimeSpan.FromSeconds(2));
        await c.Response.Body.WriteAsync(bytes,timeout.Token);
    }
    public void Dispose()
    {
        stop.Cancel();Task.Run(async()=>{using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(3));try{await application.StopAsync(deadline.Token);}finally{await application.DisposeAsync();}}).GetAwaiter().GetResult();
        try{if(File.Exists(sessionFile)&&File.ReadAllText(sessionFile)==sessionContent)File.Delete(sessionFile);}catch(IOException){}catch(UnauthorizedAccessException){}
        stop.Dispose();
    }
}
