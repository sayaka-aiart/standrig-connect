param([string]$Destination, [switch]$WithSpout, [string]$VisualStudioProduct = "Microsoft.VisualStudio.Product.Community")
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if(!$Destination){throw 'Specify a new -Destination directory'}
$dest=[IO.Path]::GetFullPath($Destination)
if(Test-Path -LiteralPath $dest){throw 'Destination already exists; use a new directory'}
& (Join-Path $PSScriptRoot 'build-native.ps1') -WithSpout:$WithSpout -VisualStudioProduct $VisualStudioProduct
& dotnet publish (Join-Path $root 'native/Connect.Desktop/Connect.Desktop.csproj') -c Release --self-contained false -p:DebugType=None -p:DebugSymbols=false -o $dest --nologo
if($LASTEXITCODE -ne 0){throw 'Publish failed'}
$v8=Join-Path $dest 'runtimes/win-x64/native/ClearScriptV8.win-x64.dll'
if(!(Test-Path -LiteralPath $v8)){throw 'Expected V8 DLL missing from publish output'}
Remove-Item -LiteralPath $v8
if(Get-ChildItem -LiteralPath $dest -Recurse -File | Where-Object {$_.Name -like 'ClearScriptV8*'}){throw 'Unexpected native V8 artifact remains'}
$bin=Join-Path $root 'native/Connect.Desktop/bin/Release/net8.0-windows'
foreach($name in @('Connect.Graphics.dll','Connect.Camera.dll')){Copy-Item -LiteralPath (Join-Path $bin $name) -Destination $dest}
# Framework-dependent package: do not copy the installed inference files or models.
foreach($name in @('LICENSE','NOTICE')){Copy-Item -LiteralPath (Join-Path $root $name) -Destination $dest}
Copy-Item -LiteralPath (Join-Path $root 'docs/BINARY-NOTICES.md') -Destination (Join-Path $dest 'THIRD_PARTY.md')
$licenses=Join-Path $dest 'licenses'
New-Item -ItemType Directory -Path $licenses | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'licenses/MICROSOFT-RUNTIME-TERMS.md') -Destination $licenses
Copy-Item -LiteralPath (Join-Path $root 'native/Connect.Evaluation/THIRD_PARTY') -Destination (Join-Path $licenses 'NuGet') -Recurse
foreach($name in @('STANDRIG-LICENSE','STANDRIG-NOTICE','ZOD-LICENSE','provenance.json')){Copy-Item -LiteralPath (Join-Path $root "native/Connect.Evaluation/Resources/$name") -Destination $licenses}
if($WithSpout){
    Copy-Item -LiteralPath (Join-Path $root 'workspace/vendor/Spout2/LICENSE') -Destination (Join-Path $licenses 'SPOUT-LICENSE.txt')
    Copy-Item -LiteralPath (Join-Path $root 'licenses/ANGLE-LICENSE.txt') -Destination $licenses
}
New-Item -ItemType Directory -Path (Join-Path $dest 'scripts') | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'setup-v8.ps1') -Destination (Join-Path $dest 'scripts')
Copy-Item -LiteralPath (Join-Path $root 'scripts/release/Setup-Runtime.cmd') -Destination $dest
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'setup-native-inference.ps1') -Destination (Join-Path $dest 'scripts')
Copy-Item -LiteralPath (Join-Path $root 'scripts/release/Setup-Tracking.cmd') -Destination $dest
Copy-Item -LiteralPath (Join-Path $root 'docs/PORTABLE.md') -Destination (Join-Path $dest 'START-HERE.md')
Copy-Item -LiteralPath (Join-Path $root 'docs/UPPER-BODY.md') -Destination $dest
$source=& git -C $root rev-parse HEAD
$dirty=[bool](& git -C $root status --porcelain)
$toolchain=Get-Content (Join-Path $root "native/artifacts/TOOLCHAIN.json") -Raw | ConvertFrom-Json
@{toolchain=$toolchain;sourceCommit=$source;workingTreeModified=$dirty;frameworkDependent=$true;spout=[bool]$WithSpout;inferenceBundled=$false;nativeV8Bundled=$false;releaseApproved=$false} | ConvertTo-Json | Set-Content (Join-Path $dest 'BUILD-INFO.json')
$hashes=[ordered]@{}
foreach($file in Get-ChildItem -LiteralPath $dest -Recurse -File | Sort-Object FullName){
    $relative=$file.FullName.Substring($dest.TrimEnd('\').Length+1).Replace('\','/')
    $hashes[$relative]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
$hashes | ConvertTo-Json | Set-Content (Join-Path $dest 'SHA256SUMS.json')
Compress-Archive -LiteralPath $dest -DestinationPath ($dest+'.zip')
Write-Output "Candidate package: $dest.zip"
