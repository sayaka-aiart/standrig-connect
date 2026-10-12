"""Independent double-precision reference for the selected uLipSync MFCC stages.
Only synthetic signals are used. No Unity assets, recordings or voice profiles.
Regeneration is optional; normal .NET tests read the committed numeric fixture.
"""
from pathlib import Path
import cmath, json, math, struct

ROOT = Path(__file__).resolve().parents[2]
def fft(data):
    if len(data) == 1:
        return data
    even, odd = fft(data[::2]), fft(data[1::2])
    terms = [cmath.exp(-2j * math.pi * i / len(data)) * odd[i] for i in range(len(odd))]
    return [even[i] + terms[i] for i in range(len(odd))] + [even[i] - terms[i] for i in range(len(odd))]

def samples(tones, noise):
    seed = 0x12345678
    result = []
    for i in range(1024):
        seed = (seed * 1664525 + 1013904223) & 0xffffffff
        value = sum(amplitude * math.sin(2 * math.pi * frequency * i / 16000) for frequency, amplitude in tones)
        value += ((seed >> 8) / 16777216 * 2 - 1) * noise
        result.append(struct.unpack('<f', struct.pack('<f', value))[0])
    return result

def analyze(data):
    rms = math.sqrt(sum(x * x for x in data) / len(data))
    processed = [(data[i] if i == 0 else data[i] - .97 * data[i - 1]) * (.54 - .46 * math.cos(2 * math.pi * i / 1023)) for i in range(1024)]
    peak = max(abs(x) for x in processed)
    if peak > 1e-12:
        processed = [x / peak for x in processed]
    spectrum = [abs(x) for x in fft(processed)]
    log_mel = []
    step = 1127 * math.log(8000 / 700 + 1) / 31
    for n in range(30):
        begin, center, end = [700 * (math.exp(step * i / 1127) - 1) for i in (n, n + 1, n + 2)]
        first, middle, last = math.ceil(begin / 15.625), round(center / 15.625), min(512, math.floor(end / 15.625))
        total = 0
        for i in range(first + 1, last + 1):
            hz = 15.625 * i
            value = (hz - begin) / (center - begin) if i < middle else (end - hz) / (end - center)
            total += value / ((end - begin) * .5) * spectrum[i]
        log_mel.append(10 * math.log10(max(1e-12, total)))
    return rms, [sum(log_mel[n] * math.cos((n + .5) * c * math.pi / 30) for n in range(30)) for c in range(1, 13)]

cases = [('silence', [], 0), ('sine220', [[220,.2]], 0), ('sine1000', [[1000,.2]], 0), ('noise', [], .1),
         ('A', [[120,.1],[760,.35],[1200,.2],[2500,.08]], .001),
         ('I', [[120,.1],[300,.35],[2300,.2],[3100,.08]], .001),
         ('U', [[120,.1],[350,.35],[800,.2],[2100,.08]], .001),
         ('E', [[120,.1],[500,.35],[1900,.2],[2700,.08]], .001),
         ('O', [[120,.1],[500,.35],[900,.2],[2400,.08]], .001)]
result = []
for name, tones, noise in cases:
    rms, mfcc = analyze(samples(tones, noise))
    result.append(dict(name=name, tones=tones, noise=noise, rms=rms, mfcc=mfcc))
revision = json.loads((ROOT / 'licenses/LIPSYNC-PROVENANCE.json').read_text())['ulipSync']['commit']
(ROOT / 'scripts/audio/mfcc-reference.json').write_text(json.dumps(dict(upstreamRevision=revision, cases=result), indent=2)+'\n', encoding='utf-8')
print('Generated nine synthetic MFCC reference cases')
