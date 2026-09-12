namespace StandRig.Connect;

public static class DemoPose
{
    private static readonly string[] Channels={"ParamAngleX","ParamAngleY","ParamAngleZ","ParamMouthOpen","ParamEyeLOpen","ParamEyeROpen","ParamBodyAngleX","ParamBodyAngleY","ParamBodyAngleZ"};
    // Overlay only; never mutate the latest external/manual input.
    public static Dictionary<string,double> Apply(IReadOnlyDictionary<string,double> input,IReadOnlyDictionary<string,(double Min,double Max)> ranges,double seconds)
    {
        var result=new Dictionary<string,double>(input);int i=0;
        foreach(string id in Channels)if(ranges.TryGetValue(id,out var r))result[id]=(r.Min+r.Max)/2+(r.Max-r.Min)/2*Math.Sin(seconds*(.8+i++*.17));
        return result;
    }
}
