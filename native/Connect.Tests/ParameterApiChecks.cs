using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using StandRig.Connect;

internal static class ParameterApiChecks
{
    public static async Task Run()
    {
        static void Check(bool value,string label){if(!value)throw new Exception(label);Console.WriteLine("PASS "+label);}
        double now=0;var state=new ParameterControl(()=>now);
        var definitions=new[]{new ParameterDefinition("X",-30,30,0),new ParameterDefinition("Eye",0,1,1)};
        string model=state.Load(definitions);
        var basePose=new Dictionary<string,double>{{"X",3},{"Eye",.7}};
        state.Set(model,new Dictionary<string,double>{{"X",20}},1000);
        Check(state.Apply(model,basePose)["X"]==20&&basePose["X"]==3&&state.Apply(model,basePose)["Eye"]==.7,"external overrides only requested channels without mutating source");
        try{state.Set(model,new Dictionary<string,double>{{"X",5},{"Eye",2}});throw new Exception("accepted invalid");}catch(ArgumentException){}
        Check(state.Snapshot().Overrides["X"]==20,"invalid batch is atomic");
        now=1;Check(state.Apply(model,basePose)["X"]==3&&state.Snapshot().Overrides.Count==0,"lease expiry restores live input");
        state.Set(model,new Dictionary<string,double>{{"X",10},{"Eye",0}});state.Clear(model,new[]{"X"});
        Check(state.Apply(model,basePose)["X"]==3&&state.Apply(model,basePose)["Eye"]==0,"selective clear");
        string next=state.Load(definitions);state.Unload(model);
        Check(state.Snapshot().ModelSession==next&&state.Snapshot().Overrides.Count==0,"reload invalidates leases; stale unload cannot clear new model");
        try{state.Set(model,new Dictionary<string,double>{{"X",1}});throw new Exception("accepted stale model");}catch(ParameterSessionException){}

        var reserve=new TcpListener(IPAddress.Loopback,0);reserve.Start();int port=((IPEndPoint)reserve.LocalEndpoint).Port;reserve.Stop();if(Environment.GetEnvironmentVariable("CONNECT_TEST_FIXED_PORT")=="1")port=22036;
        string folder=Path.Combine(Path.GetTempPath(),"connect-api-test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);string file=Path.Combine(folder,"session.json");
        try{
            using(var server=new ParameterHttpServer(state,file,port)){
                using var http=new HttpClient{BaseAddress=new Uri(server.Url),Timeout=TimeSpan.FromSeconds(5)};
                Check((await http.GetAsync("/api/v1/parameters")).StatusCode==HttpStatusCode.Unauthorized,"HTTP rejects missing token");
                using var session=JsonDocument.Parse(File.ReadAllText(file));http.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",session.RootElement.GetProperty("token").GetString());
                try{using var duplicate=new ParameterHttpServer(state,file,port);throw new Exception("Duplicate listener accepted");}catch(IOException){}
                Check(JsonDocument.Parse(File.ReadAllText(file)).RootElement.GetProperty("token").GetString()==session.RootElement.GetProperty("token").GetString(),"occupied port preserves active credentials");
                http.DefaultRequestHeaders.ConnectionClose=true;Check((await http.GetAsync("/api/v1/parameters")).StatusCode==HttpStatusCode.OK,"HTTP Connection close clients");http.DefaultRequestHeaders.ConnectionClose=false;
                using var list=JsonDocument.Parse(await http.GetStringAsync("/api/v1/parameters"));
                Check(list.RootElement.GetProperty("modelSession").GetString()==next&&list.RootElement.GetProperty("parameters").GetArrayLength()==2,"HTTP discovers model and ranges");
                async Task<HttpStatusCode> Post(string route,string body){using var response=await http.PostAsync("/api/v1/parameters/"+route,new StringContent(body,Encoding.UTF8,"application/json"));return response.StatusCode;}
                string prefix="{\"modelSession\":\""+next+"\",";
                Check(await Post("set",prefix+"\"values\":{\"X\":12},\"ttlMs\":500}")==HttpStatusCode.OK&&state.Apply(next,basePose)["X"]==12,"HTTP set reaches render overlay");
                foreach(string bad in new[]{"\"values\":{\"X\":\"five\"}","\"values\":{\"X\":40}","\"values\":{\"Unknown\":0}","\"values\":{\"X\":1,\"X\":2}","\"values\":{\"X\":1},\"ttlMs\":0","\"values\":{\"X\":1},\"extra\":true"})
                    Check(await Post("set",prefix+bad+"}")==HttpStatusCode.BadRequest,"HTTP strict validation");
                Check(state.Snapshot().Overrides["X"]==12,"HTTP rejected writes preserve state");
                Check(await Post("set","{\"modelSession\":\"stale\",\"values\":{\"X\":0}}")==HttpStatusCode.Conflict,"HTTP stale model conflict");
                http.DefaultRequestHeaders.Add("Origin","http://example.test");Check((await http.GetAsync("/api/v1/parameters")).StatusCode==HttpStatusCode.Forbidden,"HTTP rejects browser origin");http.DefaultRequestHeaders.Remove("Origin");
                Check(await Post("set",new string(' ',32769))==HttpStatusCode.RequestEntityTooLarge,"HTTP bounded payload");
                Check(await Post("clear",prefix+"\"ids\":[\"X\"]}")==HttpStatusCode.OK&&state.Apply(next,basePose)["X"]==3,"HTTP clear restores live pose");
                state.Unload(next);Check(await Post("clear",prefix.TrimEnd(',')+"}")==HttpStatusCode.Conflict,"HTTP no model conflict");
            }
            Check(!File.Exists(file),"HTTP shutdown removes credentials");
            using var restarted=new ParameterHttpServer(state,file,port);Check(File.Exists(file),"HTTP port restart");
        }finally{if(File.Exists(file))File.Delete(file);Directory.Delete(folder);}
    }
}
