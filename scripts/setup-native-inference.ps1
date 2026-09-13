param([string]$Configuration='Release', [switch]$WithUpperBody, [string]$OutputDirectory)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$vendor=Join-Path $root 'workspace/vendor/mediapipe-native'
New-Item -ItemType Directory -Force $vendor | Out-Null
$wheel=Join-Path $vendor 'mediapipe-0.10.35-py3-none-win_amd64.whl'
$wheelUrl='https://files.pythonhosted.org/packages/5b/f6/763477e9aeed98accc984ed6ee3f11a21a0c5fd1d1c6586b8d07067748ff/mediapipe-0.10.35-py3-none-win_amd64.whl'
$model=Join-Path $vendor 'official-face_landmarker.task'
$modelUrl='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
if(!(Test-Path -LiteralPath $wheel)){Invoke-WebRequest $wheelUrl -OutFile $wheel}
if(!(Test-Path -LiteralPath $model)){Invoke-WebRequest $modelUrl -OutFile $model}
if((Get-FileHash $wheel).Hash -ne 'B08F001CF3C3CD0D88D9ED68F3368DC8A4913F568281A93117F083115AA672BA'){throw 'MediaPipe wheel hash mismatch'}
if((Get-FileHash $model).Hash -ne '64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF'){throw 'Face model hash mismatch'}
$out=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path $root "native/Connect.Desktop/bin/$Configuration/net8.0-windows"}
if(!(Test-Path -LiteralPath (Join-Path $out 'Connect.Desktop.exe'))){throw 'Build native first'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($wheel)
try{
    foreach($pair in @(@('mediapipe/tasks/c/libmediapipe.dll','libmediapipe.dll'),@('mediapipe-0.10.35.dist-info/licenses/LICENSE','MEDIAPIPE-LICENSE'))){
        $entry=$zip.GetEntry($pair[0]);if(!$entry){throw 'Missing pinned wheel entry'}
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $out $pair[1]),$true)
    }
}finally{$zip.Dispose()}
if((Get-FileHash (Join-Path $out 'libmediapipe.dll')).Hash -ne 'AA8E6C1B618C30CD3A6AD584DEE1B2F2C99C3F3025D683BADA36E1566D9092B7'){throw 'MediaPipe DLL hash mismatch'}
Copy-Item -LiteralPath $model -Destination (Join-Path $out 'face_landmarker.task')
@{version='0.10.35';wheel=$wheelUrl;wheelSha256=(Get-FileHash $wheel).Hash;model=$modelUrl;modelSha256=(Get-FileHash $model).Hash;dllSha256=(Get-FileHash (Join-Path $out 'libmediapipe.dll')).Hash;runtime='C API CPU; no Python/browser runtime';redistributionReviewed=$false} | ConvertTo-Json | Set-Content (Join-Path $out 'INFERENCE-PROVENANCE.json')
Write-Output 'Pinned local inference runtime installed; public redistribution review still required.'

if($WithUpperBody){
    $pose=Join-Path $vendor 'pose_landmarker_lite.task'
    $poseUrl='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
    if(!(Test-Path -LiteralPath $pose)){Invoke-WebRequest $poseUrl -OutFile $pose}
    if((Get-FileHash $pose).Hash -ne '59929E1D1EE95287735DDD833B19CF4AC46D29BC7AFDDBBF6753C459690D574A'){throw 'Pose model hash mismatch'}
    Copy-Item -LiteralPath $pose -Destination (Join-Path $out 'pose_landmarker_lite.task')
    @{model=$poseUrl;sha256=(Get-FileHash $pose).Hash;redistributionReviewed=$false} | ConvertTo-Json | Set-Content (Join-Path $out 'POSE-PROVENANCE.json')
}
