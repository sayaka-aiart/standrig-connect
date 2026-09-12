param([string]$Configuration = "Release", [switch]$WithSpout)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Visual Studio C++ Build Tools and Windows SDK are required.' }
$vcvars = Join-Path $vs 'VC/Auxiliary/Build/vcvars64.bat'
$source = Join-Path $root 'native/Connect.Graphics/Graphics.cpp'
$cameraSource = Join-Path $root 'native/Connect.Camera/Camera.cpp'
$out = Join-Path $root 'native/artifacts'
New-Item -ItemType Directory -Force $out | Out-Null
$spoutFlags = ''
if ($WithSpout) {
    $sdk=Join-Path $root 'workspace/vendor/Spout2'
    $revision= & git -C $sdk rev-parse HEAD
    if($LASTEXITCODE -ne 0 -or $revision -ne 'c2bcc12147711d12ace7d5f08e869d774d840f8a'){throw 'Run setup-spout.ps1 to install the pinned SDK'}
    if((& git -C $sdk status --porcelain)){throw 'Spout SDK must have no local modifications'}
    $dx=Join-Path $sdk 'SPOUTSDK/SpoutDirectX/SpoutDX'
    $gl=Join-Path $sdk 'SPOUTSDK/SpoutGL'
    $sources=@("$dx/SpoutDX.cpp") + @('SpoutCopy','SpoutDirectX','SpoutFrameCount','SpoutSenderNames','SpoutSharedMemory','SpoutUtils' | ForEach-Object {"$gl/$_.cpp"})
    $spoutFlags='/DCONNECT_SPOUT /DSPOUT_BUILD_STATIC /I"'+$dx+'" '+(($sources | ForEach-Object {'"'+$_+'"'}) -join ' ')
}
Push-Location $out
try {
    $batch = Join-Path $out 'build-graphics.cmd'
    [IO.File]::WriteAllLines($batch, @("@echo off", "chcp 65001 >nul", "call `"$vcvars`" >nul", "if errorlevel 1 exit /b 1", "cl.exe /nologo /LD /EHsc /O2 /std:c++17 /W4 $spoutFlags `"$source`" /link d3d11.lib dxgi.lib d3dcompiler.lib user32.lib gdi32.lib shell32.lib advapi32.lib comdlg32.lib comctl32.lib ole32.lib /OUT:Connect.Graphics.dll", "exit /b %errorlevel%"), [Text.UTF8Encoding]::new($false))
    & cmd.exe /d /c $batch
    if ($LASTEXITCODE -ne 0) { throw 'Native graphics build failed' }
    $cameraBatch = Join-Path $out 'build-camera.cmd'
    [IO.File]::WriteAllLines($cameraBatch, @("@echo off", "chcp 65001 >nul", "call `"$vcvars`" >nul", "if errorlevel 1 exit /b 1", "cl.exe /nologo /LD /EHsc /O2 /std:c++17 /W4 `"$cameraSource`" /link mf.lib mfplat.lib mfreadwrite.lib mfuuid.lib ole32.lib /OUT:Connect.Camera.dll", "exit /b %errorlevel%"), [Text.UTF8Encoding]::new($false))
    & cmd.exe /d /c $cameraBatch
    if ($LASTEXITCODE -ne 0) { throw 'Native camera build failed' }
} finally { Pop-Location }
& dotnet build (Join-Path $root 'native/Connect.Desktop/Connect.Desktop.csproj') -c $Configuration --nologo
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed' }
Copy-Item -LiteralPath (Join-Path $out 'Connect.Graphics.dll') -Destination (Join-Path $root "native/Connect.Desktop/bin/$Configuration/net8.0-windows/Connect.Graphics.dll")


Copy-Item -LiteralPath (Join-Path $out 'Connect.Camera.dll') -Destination (Join-Path $root "native/Connect.Desktop/bin/$Configuration/net8.0-windows/Connect.Camera.dll")

if($WithSpout){Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE') -Destination (Join-Path $root "native/Connect.Desktop/bin/$Configuration/net8.0-windows/SPOUT-LICENSE.txt")}
