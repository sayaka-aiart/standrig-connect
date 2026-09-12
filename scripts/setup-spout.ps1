$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$destination=Join-Path $root 'workspace/vendor/Spout2'
$revision='c2bcc12147711d12ace7d5f08e869d774d840f8a'
if(!(Test-Path -LiteralPath $destination)){
 & git -c http.sslBackend=schannel clone --no-checkout https://github.com/leadedge/Spout2.git $destination
 if($LASTEXITCODE -ne 0){throw 'Spout clone failed'}
 & git -C $destination checkout --detach $revision
 if($LASTEXITCODE -ne 0){throw 'Spout checkout failed'}
}
$actual=& git -C $destination rev-parse HEAD
if($LASTEXITCODE -ne 0 -or $actual -ne $revision){throw 'Existing SDK revision differs; preserve it and resolve explicitly'}
Write-Output "Pinned Spout SDK ready: $revision"
