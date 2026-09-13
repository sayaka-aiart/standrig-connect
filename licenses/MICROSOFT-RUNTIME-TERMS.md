# Microsoft runtime terms / Microsoftランタイムの条件

## 適用範囲

配布バイナリの `Connect.Graphics.dll` と `Connect.Camera.dll` には、Visual C++のリリース用ランタイムが静的リンクされています。この文書の条件は、そのMicrosoft所有のランタイム部分にのみ適用します。StandRig Connect自身のコードに適用されるApache-2.0や、他の第三者コードのライセンスを変更するものではありません。ビルド環境は `BUILD-INFO.json` を参照してください。

## 利用者・再配布者への条件

Microsoftランタイム部分を含む配布バイナリの利用・再配布に先立ち、以下に同意してください。同意しない場合は、この配布バイナリを利用・再配布しないでください。

- Microsoftランタイム部分は、Connectの機能を利用するために使用できます。Microsoftの所有権および著作権等の表示を保持してください。
- 再配布はアプリケーションの一部として行い、この文書とライセンス・権利表示を添付し、次の配布者および利用者にも同じ条件への同意を求めてください。Microsoftランタイムを単独製品として提供する権利は付与しません。
- 適用法または該当する第三者ライセンスが認める場合を除き、Microsoftランタイム部分のリバースエンジニアリング、逆コンパイル、逆アセンブル、技術的制限の回避を行わないでください。この制限はConnect自身のソースコードの変更を制限しません。
- MicrosoftランタイムをApache-2.0等に再ライセンスしたり、そのソース公開・改変権の付与を義務付ける条件の対象にしたりしないでください。Microsoftの推奨・提供を示唆する名称や商標の使用は認めません。
- 適用される法令・輸出規制を遵守してください。Microsoftランタイムは現状のまま提供されます。法令上排除できない権利を除き、Microsoftおよびその供給者は保証を提供しません。

## English

These terms apply only to Microsoft-owned release runtime code statically linked into `Connect.Graphics.dll` and `Connect.Camera.dll`. Connect's Apache-2.0 code and separately licensed components retain their licenses. See `BUILD-INFO.json` for the toolchain.

Before using or redistributing these binaries, agree to these conditions; otherwise do not use or redistribute them:

- Use the runtime with Connect; retain ownership notices.
- Redistribute it only within the application, preserving this document and notices and requiring downstream distributors and users to accept these conditions. No standalone runtime offering is authorized.
- Do not reverse engineer, decompile, disassemble or circumvent runtime restrictions, except where applicable law or third-party licenses permit. This does not restrict modifying Connect's own source.
- Do not relicense Microsoft runtime code under Apache-2.0 or impose source-disclosure or modification-right requirements on it. Do not imply Microsoft endorsement or misuse its trademarks.
- Comply with applicable laws and export controls. The runtime is provided as is, without warranties from Microsoft or its suppliers, subject to non-excludable legal rights.

## Upstream basis / 公式根拠

- [Visual Studio Community 2022 license, section 4](https://visualstudio.microsoft.com/license-terms/vs2022-ga-community/)
- [Visual Studio 2022 redistribution list](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution)
- [Microsoft C++ static deployment](https://learn.microsoft.com/en-us/cpp/windows/deployment-in-visual-cpp?view=msvc-170)

This document describes the conditions for this application's Microsoft runtime portions; it is not a Visual Studio license grant. Builders and redistributors must comply with their applicable Microsoft license, including permitted distributable components and release-only distribution. Separate .NET runtimes and downloaded NuGet/MediaPipe components retain their own terms.
