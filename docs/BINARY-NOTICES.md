# Binary candidate: third-party notices

This framework-dependent Windows x64 candidate contains StandRig Connect, embedded StandRig evaluation code and Zod, ClearScript managed assemblies/ICU, Newtonsoft.Json and optionally statically linked Spout2 code.

Keep LICENSE, NOTICE and the entire licenses directory with the binaries. licenses/NuGet contains the complete collected upstream package notices, including platform-specific sections; these must not be replaced with a single MIT label. Embedded StandRig and Zod notices are included separately. Spout builds include Spout and ANGLE notices.

The native V8 DLL, MediaPipe runtime and Face/Pose Landmarker models are not included. Setup-Runtime.cmd downloads the native V8 DLL from the official pinned NuGet package with package and DLL hash verification. Setup-Tracking.cmd downloads fixed upstream files and retains the MediaPipe notice and provenance locally. No artwork or user settings are included.

.NET Desktop and ASP.NET Core runtimes are installed separately from Microsoft; no .NET runtime or Windows OS DLL is bundled. Connect native DLLs use the release static CRT (/MT). The packaging script defaults to Visual Studio Community and records its product/version and MSVC version in BUILD-INFO.json. A successful build does not itself establish license compliance.

This is a local release candidate, not final license clearance. Microsoft runtime use and redistribution conditions are supplied in licenses/MICROSOFT-RUNTIME-TERMS.md. They apply only to the Microsoft runtime portions, not to Connect's Apache-2.0 source. Users and redistributors must accept those conditions before using or redistributing these binaries. Packaging this document is not evidence of recipient acceptance or blanket legal clearance. Inference DLL transitive notice review remains relevant if inference binaries are later bundled. BUILD-INFO.json deliberately records releaseApproved=false.
