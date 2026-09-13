# StandRig Connect

**A Windows tracking and streaming app** · [日本語](README.md)

Animate models made in [StandRig](https://github.com/sayaka-aiart/StandRig) with a camera and send output to OBS. After exporting embedded-image model JSON, StandRig, a browser and Python do not need to run. Model evaluation uses embedded V8 internally.

This is the **0.1.0 development preview** source release, not a finished installer.

## Features

- [External parameter API](docs/PARAMETER-API.md): discover, temporarily override and clear values over local HTTP.
- Embedded-image model JSON loading and Direct3D 11 rendering.
- Camera tracking for head orientation, eyelids, gaze and mouth; mirrored by default.
- Gain, inversion, smoothing, eye closure threshold and neutral calibration.
- Local slots containing a model copy and tracking settings; last-used slot selected on startup.
- StandRig motion loading, playback, pause, stop, seek, speed and looping.
- Breathing, breathing with sway, and breathing with smooth random micro-movement.
- OBS Game Capture / Window Capture and optional Spout2 output.
- Processing continues with the control window minimized or in the tray.

Optional upper-body tracking estimates shoulder yaw and roll. Body pitch uses shoulders and hips; arms and full-body tracking are not supported. Expression hotkeys, an external expression API and vowel recognition are not implemented.

## Binary ZIP candidate

The prebuilt ZIP is currently a locally tested candidate; it has not been published as a GitHub Release. If you have the candidate, extract the entire ZIP and:

1. Install Microsoft's .NET 8 Desktop Runtime and ASP.NET Core 8 Runtime, both x64.
2. Run `Setup-Runtime.cmd` for playback, or `Setup-Tracking.cmd` for camera tracking. The latter installs V8 plus face and upper-body inference.
3. Start `Connect.Desktop.exe` and open model JSON with embedded images.

Initial setup needs internet access. Native V8, inference DLLs and inference models are excluded from the ZIP, downloaded from pinned official sources and verified with SHA-256. ZIP users do not need Visual Studio, an SDK or Python.

[Setup details](docs/PORTABLE.md) · [Binary third-party notices](docs/BINARY-NOTICES.md)

Before use or redistribution, read and accept the [Microsoft runtime conditions](licenses/MICROSOFT-RUNTIME-TERMS.md). They cover only Microsoft runtime portions inside the native DLLs; Connect's own code remains Apache-2.0.

## Build and run

Install Windows x64, .NET 8 SDK, an appropriately licensed Visual Studio 2022 installation (such as Community for eligible users) with C++ tools and a Windows SDK. See [details](docs/BUILD.md). Run PowerShell in the repository root:

```powershell
powershell -NoProfile -File scripts/build-native.ps1
# Optional face inference: downloads pinned third-party files.
powershell -NoProfile -File scripts/setup-native-inference.ps1
.\native\Connect.Desktop\bin\Release\net8.0-windows\Connect.Desktop.exe
```

The generated evaluator is included; ordinary builds and usage do not need Node.js. Framework-dependent execution requires the .NET 8 Windows Desktop Runtime and ASP.NET Core 8 Runtime.


Embedded-image models use `.srig` (JSON content). Existing embedded-image `.json` files remain supported. Renaming an image-free rig.json does not make it a portable Connect model.

## Usage

1. Load a PSD and rig in StandRig and export **model JSON with embedded images**. Direct PSD or image-free rig.json loading is not supported.
2. Open the JSON in Model (`モデル`).
3. In Streaming (`配信`), select and start the camera, enable tracking, calibrate and adjust as needed.
4. Save a slot in Model. Use `スロットを使う` to restore it next time.
5. Select an idle preset or load a motion in `モーション`.

Slots are saved manually under `%LOCALAPPDATA%\StandRigConnect\model-slots`. They store the model copy, calibration and controls, but not camera startup, OBS output, motion playback or idle selection. Old payloads are retained and storage grows; cleanup/history UI is not implemented.

Evaluation order is base input → tracking → additive idle → loaded motion → API overrides. Later layers override only supplied parameters. Idle leaves eyes and mouth alone. When no breathing parameter is bound to the model, a small vertical stretch anchored at the stage bottom provides breathing movement.

## Control parameters externally

Connect exposes its external parameter API at `http://127.0.0.1:22036`: discover parameter IDs and ranges, temporarily override values, and clear selected or all overrides. AI scripts and other tools can call it directly without running StandRig. Credentials are stored in `%LOCALAPPDATA%\StandRigConnect\api-session.json`; Connect's API tab shows the location. Never share or commit this file.

Overrides affect only supplied parameters and expire after one second by default (configurable from 100 to 10000ms), restoring ordinary input. Renew before expiry for continuous control. Retrieve a new model session ID after switching models. Stream Deck integration can use scripts or actions supporting HTTP calls; a dedicated plugin and expression-switching API are not implemented.

[Request formats and Python example](docs/PARAMETER-API.md). This API belongs to Connect and does not persistently edit model files.

## Output resolution and framing

Open Streaming (`配信`) → `解像度・構図…` to choose 640×480, 1280×720, 1920×1080, 720×1280, 1080×1920 or 1080×1080. The initial default remains 640×480.

On the preview, **mouse wheel zooms; left-drag moves the model**. Zoom ranges from 25% to 300%, anchored at the cursor. Dragging is not limited to half the canvas size: you can continue moving in any direction after zooming. If the model moves off-screen, open `解像度・構図…` and click `全体を表示` to reset zoom and position. Framing changes the output image itself, including Spout2.

The preview window fits on the screen while Spout2 sends the selected render resolution. Window Capture depends on window size; use Spout2 for transparent output at the configured resolution. Receivers may need to reacquire the texture during a resolution change.

Resolution and framing are saved automatically as local app-wide settings and restored on startup, separately from model slots. Changing resolution does not reload the model, tracking or motion.

## OBS output

| Method | OBS setup | Output window |
| --- | --- | --- |
| Game Capture | Select `Output — Model`, allow transparency | Keep visible |
| Window Capture | Windows Graphics Capture; opaque background | Keep visible |
| Spout2 | Separate receiver plugin; select `StandRig Connect`, Premultiplied Alpha | May be hidden; build with Spout and enable sending |

The control window may be minimized. × hides it to the tray; exit through the tray menu. No OBS plugin is bundled. Use one instance at a time.

## Limits and license

Output resolution is configurable, with a target loop of 60Hz. Higher resolutions increase GPU load and memory use; actual performance depends on model and PC. Rendering, camera and OBS have been exercised locally, not qualified for every GPU, camera or sleep/resume scenario.

Models require suitable parameters and rigging. Assets must be embedded PNGs. Limits include a 64MiB model, 4096px per image dimension and a 256MiB base texture budget. Image corrections have additional limits.

Camera processing is local with no ordinary upload or recording. Explicit diagnostics may save screenshots/reports. Private artwork, settings and test assets are excluded from source distribution.

[Source distribution](docs/SOURCE-DISTRIBUTION.md) · [Third-party notices](THIRD_PARTY.md)

Original code is [Apache-2.0](LICENSE); third-party components and artwork retain their licenses. This is independent of Live2D/Cubism and does not directly play CMO3/MOC3 files.

See [Upper-body tracking](docs/UPPER-BODY.md#english) for optional setup and limitations.

Idle breathing and micro-motion are added to tracking values. Loaded motion and external API overrides retain priority on their channels. If the breath parameter is not referenced by parts or deformers, breathing uses up to 1.2% vertical stretch anchored at the stage bottom as a simple fallback.
