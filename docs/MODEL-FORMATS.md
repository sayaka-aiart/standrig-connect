# Model format compatibility

Connect reads legacy RigDocument JSON, `standrig-bundle` v1, `standrig-packed`
v1, and bundle v1 containing a packed rig. Packed offsets stay compact through
managed metadata and slot storage. At the embedded V8 evaluation boundary an
adapter validates topology, ordered vertex IDs, indices, lengths, finite values
and an eight-million packed-offset budget, then restores the evaluator's
ordinary offset representation. Lossless Float64, Float32 and 1/32px Int16
encodings are supported; Connect does not quantize or thin authored data.

External PNG references resolve beneath the selected model's directory. Local
`/assets/...` references also resolve there. Traversal, remote URLs, UNC paths
and links below that directory are rejected. PNG signatures, dimensions and
optional SHA-256 are checked. Each PNG is limited to 96MiB; the model including
imported PNGs is limited to 384MiB (UTF-8 bytes). Hidden source images can exceed
4096px, but images used for rendering retain that per-side limit. Unsupported
blend modes on visible parts are rejected; statically hidden PSD layers do not
prevent loading. This is not a claim of pixel-identical rendering with StandRig.

Slots embed imported images and keep their model payload separate from settings,
with SHA-256 integrity. The source model is never rewritten. Legacy slots remain
readable. Older Connect binaries cannot read the new packed format.

Motion loading uses a separate 16MiB UTF-8 byte limit in both the native UI and
evaluator. Existing key-count, interpolation and range validation still applies.
Connect evaluates its own model and motion: service HTTP compression, ETags and
SSE delta frames do not require a network protocol change here.

Rig features of the pinned StandRig core play as in StandRig: keyed draw order
and draw order groups, multiply/screen colors (applied by the native shader;
masks draw with neutral colors), inverted clips, and pendulum physics. Where a
rig's pendulum overwrites a standard parameter that Connect's tracking, idle
sway, demo pose, motions or parameter API write, or names the mouth
`ParamMouthOpenY` only, the evaluator adds the change to the parameter the rig
listens to, as StandRig's default tracking does; a tracking setup saved in the
rig decides where the head and body angles go. Multiply and screen blending run
in the GPU output merger rather than copying the frame per triangle; compared
with older builds, images can differ by up to 2/255 on a small share of pixels.

The core evaluator remains pinned by `scripts/evaluation/source.json`; the wire
adapter is maintained separately and hashed in evaluator provenance. Regenerate
the embedded evaluator with `npm run build:evaluator`.

Validation: `npm run test:packed` checks fixtures produced by the actual StandRig
codec, including Unicode vertex IDs, sparse/reordered offsets, malformed data
and host-API-free V8 evaluation. `dotnet run --project
native/Connect.Evaluation.Tests -c Release -- --model-documents` checks native
numeric rendering parity, external-file confinement/integrity, independent slot
restoration, and a motion containing 48,000 original keys above the former 4MiB
limit. These checks do not establish real-camera performance, OBS capture or
60fps for a particular production character.
