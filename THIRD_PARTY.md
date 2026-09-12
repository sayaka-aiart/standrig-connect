# Third-party code and assets

Original StandRig Connect code is licensed under Apache-2.0 (LICENSE). User artwork is not licensed by this project. This source preparation is not a binary/model redistribution bundle.

| Component | Source / recorded license | Included here |
| --- | --- | --- |
| StandRig evaluation core | Fixed commit in scripts/evaluation/source.json; Apache-2.0 | Generated JavaScript, original LICENSE/NOTICE and provenance in native/Connect.Evaluation/Resources |
| Zod 4.3.6 | npm lockfile; MIT | Used by embedded tracking validation; Resources/ZOD-LICENSE |
| ClearScript 7.5.1.1 | NuGet lockfile; MIT | Package references, collected notices in native/Connect.Evaluation/THIRD_PARTY |
| V8, ICU and NuGet transitives | Licenses differ; consult collected full notices and packages.lock.json | Notices, not runtime binaries |
| MediaPipe 0.10.35 | Official PyPI wheel; Apache-2.0 license extracted by setup script | Setup script only; no DLL or inference model |
| Face Landmarker task | Versioned official Google download; URL and SHA-256 pinned in setup script | Not included |
| Spout2 | Pinned leadedge/Spout2 commit; BSD-2-Clause root license, source notices retained upstream | Setup/build integration only; no SDK or binary |
| Windows / .NET / MSVC | Platform dependencies with their own terms | Not bundled |

The native app embeds V8 for model evaluation; it does not require a browser or a Python installation. Connect.Camera uses Windows Media Foundation. Optional inference setup extracts the native C API from a wheel without running Python.

scripts/setup-native-inference.ps1 downloads and verifies fixed upstream files for local installation. Its provenance deliberately records redistributionReviewed=false: bundled binary/model redistribution still needs a separate review of transitive notices and model terms. Do not package the local installed inference files as a release based solely on successful setup.

scripts/setup-spout.ps1 checks out commit c2bcc12147711d12ace7d5f08e869d774d840f8a. The optional build copies the SDK root license beside the output. An OBS receiver plugin is installed separately and is not linked or distributed here.

The npm manifest retains MediaPipe types used by shared tracking code and build tooling. package-lock.json records versions; node_modules is not distributed. scripts/collect-native-notices.ps1 collects available notices from restored NuGet packages. Preserve complete dependency notices when making a future binary package; the collected manifest is provenance, not a blanket license clearance.

Private PSDs, model JSON, calibration profiles, camera/character images, reports, SDK checkouts, inference models and build outputs are excluded by the source allowlist. No example artwork is included in this source snapshot. Developer tests can consume StandRig's separately obtained public sample.

The local parameter API uses Kestrel through the Microsoft.AspNetCore.App 8 shared framework. ASP.NET Core 8 Runtime is required alongside the Windows Desktop runtime for framework-dependent execution. No browser UI or external web hosting service is used.
