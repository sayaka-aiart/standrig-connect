# StandRig Connect - Windows x64 ZIP

配布候補版です。ZIPをすべて書き込み可能なフォルダへ展開してください。EXEだけを移動しないでください。

利用・再配布の前に `licenses/MICROSOFT-RUNTIME-TERMS.md` を読み、Microsoftランタイム部分の条件に同意してください。Connect自身のコードはApache-2.0のままです。

1. Microsoft公式の **.NET 8 Desktop Runtime (x64)** と **ASP.NET Core 8 Runtime (x64)** をインストールします。SDKやVisual Studioは不要です。
   https://dotnet.microsoft.com/download/dotnet/8.0
2. 再生のみなら `Setup-Runtime.cmd` を実行します。公式NuGetから固定版V8を取得し、パッケージとDLLのSHA-256を検証します。カメラも使う場合は、V8と推論をまとめて導入する次の手順を使えます。
3. カメラを使う場合は `Setup-Tracking.cmd` を実行します。公式配布先から固定版のMediaPipe DLL・顔モデル・姿勢モデルを取得し、SHA-256検証後に配置します。Python不要、初回のみネット接続が必要です。失敗した場合は完了していません。
4. `Connect.Desktop.exe` を起動し、画像込みモデルJSONを開きます。カメラ開始は利用者の操作で行います。

上半身は標準ONです。カメラを使う前にセットアップを完了してください。再生だけでもV8の初回セットアップが必要です。
未署名のためWindowsが警告する場合があります。システム全体のセキュリティ設定を無効化しないでください。

ライセンスは `LICENSE`、`NOTICE`、`licenses/` を参照してください。推論ファイルはZIPに含まれません。モデル画像・保存設定・認証情報も含めません。アプリのスロット等は通常どおりLOCALAPPDATAへ保存されます。

## English

Before use or redistribution, read and agree to `licenses/MICROSOFT-RUNTIME-TERMS.md`, which covers only the Microsoft runtime portions. Connect's own code remains Apache-2.0.

Extract the entire ZIP into a writable folder. Install both .NET 8 Desktop Runtime x64 and ASP.NET Core 8 Runtime x64 from Microsoft. No SDK or Visual Studio is needed.

For playback only, run `Setup-Runtime.cmd` to download the pinned native V8 DLL from official NuGet. Both package and DLL SHA-256 are checked. For camera tracking, run `Setup-Tracking.cmd` before launching the app. It first installs V8, then downloads pinned upstream MediaPipe inference files and verifies SHA-256; Python is not needed. Internet access is needed for setup. Upper-body tracking defaults to ON. Playback alone does not need inference setup.

Start `Connect.Desktop.exe` and open a model JSON with embedded images. Camera capture starts only when requested in the UI. Preserve all DLLs and license files. This candidate is unsigned; do not disable system-wide security settings. User models and settings are not bundled.
