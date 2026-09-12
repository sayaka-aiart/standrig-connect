namespace StandRig.Connect;

public sealed record SendStatisticsSnapshot(long Attempts,long Succeeded,long Failed,long Skipped,int? LastError);

/// <summary>Records every enabled send result; a later success does not erase earlier failures.</summary>
public sealed class SendStatistics
{
    private readonly object gate=new();
    private long attempts,succeeded,failed,skipped;
    private int? lastError;
    public void Record(bool enabled,int result)
    {
        if(!enabled)return;
        lock(gate){attempts++;if(result==0)succeeded++;else if(result<0){failed++;lastError=result;}else skipped++;}
    }
    public SendStatisticsSnapshot Snapshot(){lock(gate)return new(attempts,succeeded,failed,skipped,lastError);}
}
