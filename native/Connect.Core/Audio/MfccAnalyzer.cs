// Adapted from uLipSync Algorithm.cs and LipSyncJob.cs.
// Copyright (c) 2021 hecomi. MIT license: licenses/ULIPSYNC-LICENSE.txt.
// Changes: managed reusable FFT buffers, fixed 16kHz input, finite log floor,
// no Unity/Jobs/Burst allocation. See licenses/LIPSYNC-PROVENANCE.json.
namespace StandRig.Connect.Audio;

public sealed record AudioFeatures(double Rms,double[] Mfcc);

public sealed class MfccAnalyzer
{
    public const int SampleRate=16000,WindowSize=1024,Coefficients=12,MelChannels=30,HopSize=320;
    private readonly double[] real=new double[WindowSize],imaginary=new double[WindowSize];
    private readonly double[,] mel=new double[MelChannels,WindowSize/2+1],dct=new double[Coefficients,MelChannels];
    private readonly double[] logMel=new double[MelChannels],window=new double[WindowSize];
    public MfccAnalyzer()
    {
        double melMax=1127*Math.Log(SampleRate/2d/700+1),step=melMax/(MelChannels+1),df=SampleRate/(double)WindowSize;
        for(int n=0;n<MelChannels;n++){
            double begin=700*(Math.Exp(step*n/1127)-1),center=700*(Math.Exp(step*(n+1)/1127)-1),end=700*(Math.Exp(step*(n+2)/1127)-1);
            int first=(int)Math.Ceiling(begin/df),middle=(int)Math.Round(center/df),last=Math.Min(WindowSize/2,(int)Math.Floor(end/df));
            for(int i=first+1;i<=last;i++){double hz=df*i;mel[n,i]=(i<middle?(hz-begin)/(center-begin):(end-hz)/(end-center))/((end-begin)*.5);}
        }
        for(int i=0;i<WindowSize;i++)window[i]=.54-.46*Math.Cos(2*Math.PI*i/(WindowSize-1));
        for(int c=0;c<Coefficients;c++)for(int n=0;n<MelChannels;n++)dct[c,n]=Math.Cos((n+.5)*(c+1)*Math.PI/MelChannels);
    }
    public AudioFeatures Analyze(ReadOnlySpan<float> input)
    {
        if(input.Length!=WindowSize)throw new ArgumentException("MFCC requires exactly 1024 mono samples at 16kHz");
        double energy=0,max=0;
        for(int i=0;i<WindowSize;i++){
            if(!float.IsFinite(input[i])||Math.Abs(input[i])>16)throw new ArgumentException("Invalid audio sample");
            energy+=input[i]* (double)input[i];real[i]=(i==0?input[i]:input[i]-.97*input[i-1])*window[i];max=Math.Max(max,Math.Abs(real[i]));imaginary[i]=0;
        }
        if(max>1e-12)for(int i=0;i<WindowSize;i++)real[i]/=max;
        for(int i=1,j=0;i<WindowSize;i++){
            int bit=WindowSize>>1;for(; (j&bit)!=0;bit>>=1)j^=bit;j^=bit;
            if(i<j)(real[i],real[j])=(real[j],real[i]);
        }
        for(int length=2;length<=WindowSize;length<<=1){
            double angle=-2*Math.PI/length,wrStep=Math.Cos(angle),wiStep=Math.Sin(angle);
            for(int start=0;start<WindowSize;start+=length){double wr=1,wi=0;
                for(int j=0;j<length/2;j++){
                    int a=start+j,b=a+length/2;double tr=wr*real[b]-wi*imaginary[b],ti=wr*imaginary[b]+wi*real[b];
                    real[b]=real[a]-tr;imaginary[b]=imaginary[a]-ti;real[a]+=tr;imaginary[a]+=ti;
                    (wr,wi)=(wr*wrStep-wi*wiStep,wr*wiStep+wi*wrStep);
                }
            }
        }
        for(int i=0;i<=WindowSize/2;i++)real[i]=Math.Sqrt(real[i]*real[i]+imaginary[i]*imaginary[i]);
        for(int n=0;n<MelChannels;n++){double value=0;for(int i=0;i<=WindowSize/2;i++)value+=mel[n,i]*real[i];logMel[n]=10*Math.Log10(Math.Max(1e-12,value));}
        var coefficients=new double[Coefficients];for(int c=0;c<Coefficients;c++)for(int n=0;n<MelChannels;n++)coefficients[c]+=logMel[n]*dct[c,n];
        return new(Math.Sqrt(energy/WindowSize),coefficients);
    }
}

// Ring storage and 20ms hops are bounded; raw audio is never written to disk.
public sealed class AudioFeatureStream
{
    private readonly MfccAnalyzer analyzer=new();
    private readonly float[] ring=new float[MfccAnalyzer.WindowSize],ordered=new float[MfccAnalyzer.WindowSize];
    private int position,count,hop;
    public void Push(ReadOnlySpan<float> samples,Action<AudioFeatures> receive)
    {
        foreach(float value in samples){
            if(!float.IsFinite(value)||Math.Abs(value)>16)throw new ArgumentException("Invalid audio sample");
            ring[position]=value;position=(position+1)%ring.Length;count=Math.Min(ring.Length,count+1);
            if(++hop<MfccAnalyzer.HopSize)continue;hop=0;if(count<ring.Length)continue;
            for(int i=0;i<ring.Length;i++)ordered[i]=ring[(position+i)%ring.Length];receive(analyzer.Analyze(ordered));
        }
    }
}
