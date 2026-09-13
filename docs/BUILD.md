# Build and development / ビルド・開発

## Windows x64 prerequisites

- .NET 8 SDK. Running a framework-dependent build requires both the .NET 8 Windows Desktop Runtime and ASP.NET Core 8 Runtime (for the local Kestrel API). The SDK development environment supplies these runtimes.
- Visual Studio 2022 Community (subject to its individual/open-source eligibility), or another appropriately licensed Visual Studio installation: Desktop development with C++, MSVC x64 tools and Windows SDK.
- Microsoft Visual C++ x64 runtime when running on a machine without the build tools.
- Git for optional Spout SDK setup and evaluator regeneration.
- Node.js 24+ and npm only for evaluator regeneration and TypeScript checks.

## Native app

```powershell
powershell -NoProfile -File scripts/build-native.ps1
powershell -NoProfile -File scripts/setup-native-inference.ps1
.\native\Connect.Desktop\bin\Release\net8.0-windows\Connect.Desktop.exe
```

Run from the repository root. The inference setup is optional for playback, required for camera face inference. It downloads a pinned MediaPipe wheel and Face Landmarker model and verifies SHA-256; Python is not needed. Setup does not open the camera. Enable camera access in Windows privacy settings if necessary.

通常のビルドは同梱の評価コードを使用します。カメラ推論のセットアップにはネット接続が必要です。アプリ更新時はトレイから終了してからビルドしてください。DLLを含む出力フォルダ全体が必要で、EXEだけのコピーでは動作しません。

## Optional Spout2

```powershell
powershell -NoProfile -File scripts/setup-spout.ps1
powershell -NoProfile -File scripts/build-native.ps1 -WithSpout
```

Setup checks out the pinned SDK in ignored workspace/vendor. OBS needs a separately installed Spout2 receiver. The default build does not include Spout support. Building without -WithSpout again replaces the Spout-enabled graphics DLL.

## Regenerate the embedded evaluator

The original source commit and generated hash are recorded in scripts/evaluation/source.json and native/Connect.Evaluation/Resources/provenance.json. The committed evaluator allows standalone native builds. To regenerate it:

```powershell
npm ci
# Use a separate checkout. Do not reuse a working model project.
git clone https://github.com/sayaka-aiart/StandRig.git workspace/standrig-source
git -C workspace/standrig-source checkout --detach 35641e23619a23e5f6fe1b1a26e21f61485f1221
node scripts/build-evaluator.mjs workspace/standrig-source
```

The script archives the fixed commit, not the checkout's current working files. Node modules are build dependencies, not a browser runtime for the native app. Preserve the generated license files and source provenance when updating.

## Tests

```powershell
dotnet run --project native/Connect.Tests -c Release
node --experimental-strip-types scripts/evaluation/test-finite-packet.mjs
# Requires evaluator regeneration/vendor source above:
node scripts/evaluation/test-final-geometry.mjs
# Use the public StandRig sample, or explicitly supply your own exported model:
node scripts/evaluation/make-render-fixture.mjs workspace/standrig-source/examples/sample.standrig.json
node scripts/evaluation/make-fixture.mjs reports/native-render-sample.json
dotnet run --project native/Connect.Evaluation.Tests -c Release -- reports/evaluation
dotnet run --project native/Connect.Evaluation.Tests -c Release -- --model-slots
```

Some additional evaluation modes require local fixture files (for example reports/native-production-source.json for eye checks). These files are deliberately not distributed. Do not interpret an unavailable private-fixture check as a passed check. Tests using a public synthetic sample are distinct from real-character visual review.

Core checks cover lifecycle and idle bounds/continuity. Numeric tests do not prove camera direction, visual quality or OBS reception. Review those with your own model and devices. Test output belongs under ignored reports/.

If Git reports a local certificate-store error on Windows, retry with `git -c http.sslBackend=schannel clone ...`; do not disable certificate verification.

## Local binary candidate

Run `powershell -NoProfile -File scripts/package-native.ps1 -Destination reports/connect-candidate -WithSpout` after Spout setup. Use a new destination. Packaging defaults to `Microsoft.VisualStudio.Product.Community`; `-VisualStudioProduct` can select another licensed edition. This records toolchain metadata and uses the release static CRT (`/MT`). It does not grant or verify license rights.

The ZIP excludes native V8 and inference files; see [PORTABLE.md](PORTABLE.md) for first-run setup and [BINARY-NOTICES.md](BINARY-NOTICES.md) for notices. `releaseApproved=false` means candidate packaging is not publication approval.
