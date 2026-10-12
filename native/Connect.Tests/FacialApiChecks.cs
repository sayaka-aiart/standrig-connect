using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using StandRig.Connect;
internal static class FacialApiChecks
{
    public static async Task Run()
    {
        static void Check(bool ok,string name){if(!ok)throw new Exception(name);Console.WriteLine("PASS "+name);}
        using var fixture=JsonDocument.Parse(File.ReadAllText("scripts/evaluation/facial-fixture.json"));
        string catalog=fixture.RootElement.GetProperty("facialPresets").GetRawText();
        var parameters=new ParameterControl();string session=parameters.Load(new[]{new ParameterDefinition("ParamEyeLOpen",0,1,1)});
        var facial=new FacialControl();facial.Load(session,catalog);
        int commands=0;
        string Apply(string json,double seconds){commands++;return "{\"expressionId\":\"half\",\"expressionWeights\":{\"half\":1},\"visemeWeights\":{},\"transitioning\":false}";}
        string State(double seconds)=>"{\"expressionId\":\"half\",\"expressionWeights\":{\"half\":1},\"visemeWeights\":{},\"transitioning\":false}";
        facial.Submit(session,"{\"action\":\"expression\",\"id\":\"half\"}");
        Check(commands==0&&facial.Snapshot().Pending==1,"facial commands do not evaluate on caller thread");
        facial.Advance(session,0,Apply,State);Check(commands==1&&facial.Snapshot().AppliedSequence==1,"renderer drains facial commands and publishes state");
        string folder=Path.Combine(Path.GetTempPath(),"connect-facial-test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);string file=Path.Combine(folder,"session.json");
        var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();
        try{
            using var server=new ParameterHttpServer(parameters,file,port,facial);
            using var http=new HttpClient{BaseAddress=new Uri(server.Url)};
            Check((await http.GetAsync("/api/v1/facial")).StatusCode==HttpStatusCode.Unauthorized,"facial API requires existing bearer auth");
            using var credentials=JsonDocument.Parse(File.ReadAllText(file));http.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",credentials.RootElement.GetProperty("token").GetString());
            using var discovery=JsonDocument.Parse(await http.GetStringAsync("/api/v1/facial"));Check(discovery.RootElement.GetProperty("modelSession").GetString()==session&&discovery.RootElement.GetProperty("presets").GetProperty("expressions").GetArrayLength()==2,"facial API discovers model-scoped catalog and state");
            async Task<HttpStatusCode> Post(string command,string? model=null){using var response=await http.PostAsync("/api/v1/facial",new StringContent("{\"modelSession\":\""+(model??session)+"\",\"command\":"+command+"}",Encoding.UTF8,"application/json"));return response.StatusCode;}
            Check(await Post("{\"action\":\"expression\",\"id\":\"half\",\"strength\":0.5}")==HttpStatusCode.Accepted,"facial HTTP returns queued acceptance");
            int count=facial.Snapshot().Pending;
            foreach(var bad in new[]{"{\"action\":\"expression\",\"id\":\"missing\"}","{\"action\":\"expression\",\"id\":\"half\",\"strength\":\"five\"}","{\"action\":\"viseme\",\"id\":\"A\",\"strength\":2}","{\"action\":\"visemes\",\"weights\":{\"A\":-1}}","{\"action\":\"visemes\",\"weights\":{\"A\":1,\"A\":0}}","{\"action\":\"clear\",\"layer\":null}","{\"action\":\"clear\",\"immediate\":\"true\"}","{\"action\":\"clear\",\"extra\":1}","{\"action\":\"clear\",\"action\":\"clear\"}","[]"})Check(await Post(bad)==HttpStatusCode.BadRequest,"facial HTTP rejects invalid strict command");
            Check(facial.Snapshot().Pending==count,"rejected facial commands preserve pending/state");
            Check(await Post("{\"action\":\"clear\"}","stale")==HttpStatusCode.Conflict,"facial HTTP rejects stale model session");
            Check(await Post("{\"action\":\"visemes\",\"weights\":{\"A\":0.6,\"I\":0.4}}")==HttpStatusCode.Accepted,"facial HTTP accepts vowel mixture");
            Check(await Post("{\"action\":\"clear\",\"layer\":\"viseme\",\"immediate\":true}")==HttpStatusCode.Accepted,"facial HTTP accepts selective clear");
            http.DefaultRequestHeaders.Add("Origin","http://example.test");Check((await http.GetAsync("/api/v1/facial")).StatusCode==HttpStatusCode.Forbidden,"facial API rejects browser origin");http.DefaultRequestHeaders.Remove("Origin");
            while(facial.Snapshot().Pending<32)facial.Submit(session,"{\"action\":\"clear\"}");
            Check(await Post("{\"action\":\"clear\"}")==HttpStatusCode.TooManyRequests,"facial queue is bounded with HTTP 429");
            facial.Advance(session,1,Apply,State);Check(facial.Snapshot().Pending==0&&facial.Snapshot().AppliedSequence==facial.Snapshot().AcceptedSequence,"all accepted facial commands are applied in order");
            string next=parameters.Load(new[]{new ParameterDefinition("ParamEyeLOpen",0,1,1)});facial.Load(next,"{\"version\":1,\"expressions\":[]}");facial.Unload(session);
            Check(facial.Snapshot().ModelSession==next&&facial.Snapshot().State==null,"model switch clears faces; stale unload preserves new model");
            Check(await Post("{\"action\":\"clear\"}")==HttpStatusCode.Conflict,"facial old session invalid after reload");
            facial.Unload(next);Check(await Post("{\"action\":\"clear\"}",next)==HttpStatusCode.Conflict,"facial API rejects commands without model");
        }finally{if(File.Exists(file))File.Delete(file);Directory.Delete(folder);}
    }
}
