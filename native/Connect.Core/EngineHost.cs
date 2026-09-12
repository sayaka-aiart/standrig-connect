using System.Collections.ObjectModel;
using System.Diagnostics;
namespace StandRig.Connect;

public sealed record PoseFrame(long Sequence, IReadOnlyDictionary<string, double> Values);
public sealed record EngineStatus(bool Running, long Ticks, long Accepted, long Superseded, long AppliedSequence, string? Error);
public sealed record EngineTiming(long Frames,long Waits,double MeanStepMs,double MeanWaitOvershootMs,double MaxWaitOvershootMs,long OverBudgetFrames);

/// <summary>One immutable latest sample, never an unbounded tracking backlog.</summary>
public sealed class LatestPose
{
    private readonly object gate = new();
    private PoseFrame? latest;
    private long accepted, superseded, sequence = -1;
    public bool Submit(PoseFrame frame)
    {
        if (frame.Sequence < 0 || frame.Values.Count > 512 || frame.Values.Any(x => string.IsNullOrWhiteSpace(x.Key) || !double.IsFinite(x.Value)))
            throw new ArgumentException("Invalid pose frame");
        var copy = new PoseFrame(frame.Sequence, new ReadOnlyDictionary<string, double>(new Dictionary<string, double>(frame.Values)));
        lock (gate)
        {
            if (frame.Sequence <= sequence) return false;
            if (latest != null) superseded++;
            latest = copy; sequence = frame.Sequence; accepted++; return true;
        }
    }
    public PoseFrame? Take() { lock (gate) { var value = latest; latest = null; return value; } }
    public (long Accepted, long Superseded) Counters { get { lock (gate) return (accepted, superseded); } }
}

/// <summary>UI visibility must never control the evaluator or output clock.</summary>
public interface IFramePipeline : IDisposable
{
    void Step(double elapsedSeconds, PoseFrame? latestPose);
}

public sealed class EngineHost : IDisposable
{
    private readonly object gate = new();
    private readonly LatestPose input = new();
    private CancellationTokenSource? cancellation;
    private Task? worker;
    private long ticks, applied = -1;
    private string? error;
    private bool disposed;
    private EngineTiming? timing;
    public EngineTiming? Timing { get { lock(gate)return timing; } }
    public bool Submit(PoseFrame frame) => input.Submit(frame);
    public EngineStatus Status
    {
        get { lock (gate) { var counts = input.Counters; return new(worker is { IsCompleted: false }, Interlocked.Read(ref ticks), counts.Accepted, counts.Superseded, Interlocked.Read(ref applied), error); } }
    }
    public void Start(Func<IFramePipeline> factory, int tickRate = 60)
    {
        if (tickRate is < 1 or > 240) throw new ArgumentOutOfRangeException(nameof(tickRate));
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (worker is { IsCompleted: false }) return;
            cancellation?.Dispose(); cancellation = new(); error = null;timing=null;
            var token = cancellation.Token;
            worker = Task.Factory.StartNew(() => Run(factory, tickRate, token), token, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        }
    }
    private void Run(Func<IFramePipeline> factory, int rate, CancellationToken token)
    {
        try
        {
            using var pipeline = factory(); // GPU resources created/used/disposed on this thread.
            using var waiter=new FrameWaiter(token);
            var clock = Stopwatch.StartNew(); double deadline = 0;
            long frames=0,waits=0,overBudget=0;double stepSum=0,overshootSum=0,maxOvershoot=0;
            while (!token.IsCancellationRequested)
            {
                double now = clock.Elapsed.TotalSeconds;
                if (now < deadline) {
                    waiter.Wait(deadline-now);
                    if(!token.IsCancellationRequested&&frames>=10){double excess=Math.Max(0,clock.Elapsed.TotalSeconds-deadline);waits++;overshootSum+=excess;maxOvershoot=Math.Max(maxOvershoot,excess);}
                    continue;
                }
                var pose = input.Take(); pipeline.Step(now, pose);
                double duration=clock.Elapsed.TotalSeconds-now;
                if(frames++>=10){stepSum+=duration;if(duration>1d/rate)overBudget++;}
                if (pose != null) Interlocked.Exchange(ref applied, pose.Sequence);
                Interlocked.Increment(ref ticks);
                // Never replay a backlog after UI stalls or machine sleep.
                deadline = Math.Max(deadline + 1d / rate, clock.Elapsed.TotalSeconds);
            }
            lock(gate)timing=new EngineTiming(Math.Max(0,frames-10),waits,stepSum*1000/Math.Max(1,frames-10),overshootSum*1000/Math.Max(1,waits),maxOvershoot*1000,overBudget);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception ex) { lock (gate) error = ex.Message; }
    }
    public bool Stop(TimeSpan timeout)
    {
        Task? stopping;
        lock (gate) { cancellation?.Cancel(); stopping = worker; }
        try { return stopping?.Wait(timeout) ?? true; }
        catch (AggregateException ex) when (ex.InnerExceptions.All(x => x is TaskCanceledException)) { return true; }
    }
    public void Dispose()
    {
        lock (gate) { if (disposed) return; disposed = true; }
        if (!Stop(TimeSpan.FromSeconds(3))) throw new TimeoutException("Native worker did not stop");
        cancellation?.Dispose();
    }
}

/// <summary>Only a lifecycle diagnostic. No camera, model evaluation or rendered frames.</summary>
public sealed class DiagnosticPipeline : IFramePipeline
{
    public void Step(double elapsedSeconds, PoseFrame? latestPose) { }
    public void Dispose() { }
}
