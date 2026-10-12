namespace StandRig.Connect.Audio;

// Independent streaming resampler. 63-tap normalized low-pass before decimation;
// fractional interpolation retains phase across arbitrarily split capture packets.
public sealed class AudioResampler
{
    private readonly double[] history=new double[63],kernel=new double[63];
    private readonly double step;
    private int position;
    private long inputIndex=-1;
    private double nextOutput,previous;
    public AudioResampler(int sampleRate)
    {
        if(sampleRate<8000||sampleRate>192000)throw new ArgumentException("Unsupported audio sample rate");
        step=sampleRate/(double)MfccAnalyzer.SampleRate;
        double cutoff=.45*Math.Min(1,1/step),sum=0;
        for(int i=0;i<kernel.Length;i++){
            int x=i-kernel.Length/2;double sinc=x==0?2*cutoff:Math.Sin(2*Math.PI*cutoff*x)/(Math.PI*x);
            kernel[i]=sinc*(.54-.46*Math.Cos(2*Math.PI*i/(kernel.Length-1)));sum+=kernel[i];
        }
        for(int i=0;i<kernel.Length;i++)kernel[i]/=sum;
    }
    public void Push(ReadOnlySpan<float> input,Action<float> output)
    {
        foreach(var value in input){
            if(!float.IsFinite(value)||Math.Abs(value)>16)throw new ArgumentException("Invalid audio sample");
            history[position]=value;double filtered=0;
            for(int i=0;i<kernel.Length;i++)filtered+=kernel[i]*history[(position-i+kernel.Length)%kernel.Length];position=(position+1)%kernel.Length;inputIndex++;
            while(nextOutput<=inputIndex){
                double fraction=Math.Clamp(nextOutput-(inputIndex-1),0,1);output((float)(previous+(filtered-previous)*fraction));nextOutput+=step;
            }
            previous=filtered;
        }
    }
}
