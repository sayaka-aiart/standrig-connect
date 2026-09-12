param()
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$lock=Get-Content (Join-Path $root 'native/Connect.Evaluation/packages.lock.json') -Raw | ConvertFrom-Json
$output=Join-Path $root 'native/Connect.Evaluation/THIRD_PARTY'
New-Item -ItemType Directory -Force $output | Out-Null
$entries=@()
foreach($entry in $lock.dependencies.'net8.0'.PSObject.Properties){
    $name=$entry.Name; $version=$entry.Value.resolved
    $folder=Join-Path $env:USERPROFILE ".nuget/packages/$($name.ToLowerInvariant())/$version"
    $target=Join-Path $output "$name-$version"
    New-Item -ItemType Directory -Force $target | Out-Null
    $notices=Get-ChildItem -LiteralPath $folder -File -Recurse | Where-Object { $_.Name -match '^(license|notice|third.?party)' -or $_.DirectoryName -match '[\\/]licenses([\\/]|$)' }
    foreach($notice in $notices){
        $relative=[IO.Path]::GetRelativePath($folder,$notice.FullName)
        $dest=Join-Path $target $relative
        New-Item -ItemType Directory -Force (Split-Path $dest -Parent) | Out-Null
        Copy-Item -LiteralPath $notice.FullName -Destination $dest
    }
    $nuspec=Get-ChildItem -LiteralPath $folder -Filter '*.nuspec' -File | Select-Object -First 1
    [xml]$xml=Get-Content -LiteralPath $nuspec.FullName -Raw
    $entries+=@{name=$name;version=$version;contentHash=$entry.Value.contentHash;license=$xml.SelectSingleNode("//*[local-name()='license']").InnerText;licenseUrl=$xml.package.metadata.licenseUrl;noticeFiles=$notices.Count}
}
$entries | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $output 'manifest.json')
"Collected notices for $($entries.Count) packages"
