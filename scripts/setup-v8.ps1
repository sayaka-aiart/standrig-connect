param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
if(!$OutputDirectory){$OutputDirectory=Split-Path $PSScriptRoot -Parent}
$out=[IO.Path]::GetFullPath($OutputDirectory)
if(!(Test-Path -LiteralPath (Join-Path $out 'Connect.Desktop.exe'))){throw 'Select the extracted Connect application directory'}
$url='https://api.nuget.org/v3-flatcontainer/microsoft.clearscript.v8.native.win-x64/7.5.1.1/microsoft.clearscript.v8.native.win-x64.7.5.1.1.nupkg'
$packageHash='798453061D5E868C2C296943E4FCDFCE53AE39783FE5459A630B9E82BCA2137D'
$dllHash='23F7B297C59CD77E103E5C3E39EB784E7D43D50670D2DD9AE51BDCEFE51A883A'
$relative='runtimes/win-x64/native/ClearScriptV8.win-x64.dll'
$target=Join-Path $out $relative
$temp=Join-Path ([IO.Path]::GetTempPath()) ('standrig-v8-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $package=Join-Path $temp 'runtime.nupkg'
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $package
    if((Get-FileHash -LiteralPath $package).Hash -ne $packageHash){throw 'V8 NuGet package hash mismatch; no DLL installed'}
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip=[IO.Compression.ZipFile]::OpenRead($package)
    $dll=Join-Path $temp 'runtime.dll'
    try {
        $entry=$zip.GetEntry($relative)
        if(!$entry){throw 'Pinned V8 package has no expected DLL'}
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$dll,$false)
        if((Get-FileHash -LiteralPath $dll).Hash -ne $dllHash){throw 'V8 DLL hash mismatch; no DLL installed'}
        $notice=$zip.GetEntry('License.txt')
        if(!$notice){throw 'Pinned V8 package has no license'}
        $licenses=Join-Path $out 'licenses'
        New-Item -ItemType Directory -Force -Path $licenses | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($notice,(Join-Path $licenses 'V8-DOWNLOADED-LICENSE.txt'),$true)
    } finally {$zip.Dispose()}
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item -LiteralPath $dll -Destination $target
    @{version='7.5.1.1';url=$url;packageSha256=$packageHash;dllSha256=$dllHash;downloadedByUserSetup=$true} | ConvertTo-Json | Set-Content (Join-Path $out 'V8-PROVENANCE.json')
    Write-Output 'V8 setup complete. Camera tracking additionally requires Setup-Tracking.cmd.'
} finally {
    # Delete only the exact files created in our unique temporary directory.
    foreach($name in @('runtime.nupkg','runtime.dll')){
        $file=Join-Path $temp $name
        if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}
    }
    Remove-Item -LiteralPath $temp
}
