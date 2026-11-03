param(
 [Parameter(Mandatory=$true)][string]$InstallDirectory,
 [string]$Tag,
 [switch]$DownloadOnly,
 [switch]$OpenChrome,
 [string]$WorkDirectory=(Join-Path $env:LOCALAPPDATA 'TennisBooking/updates'),
 [switch]$AdoptUntracked
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'scripts/Release.psm1') -Force
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$repo='eddieyang-97/tennis-booking';$api='https://api.github.com/repos/'+$repo
$headers=@{Accept='application/vnd.github+json';'User-Agent'='TennisBooking-DeveloperUpdater';'X-GitHub-Api-Version'='2022-11-28'}
function Read-Api([string]$Path) {Invoke-RestMethod -Uri ($api+$Path) -Headers $headers -TimeoutSec 30}
if($Tag) {
 if($Tag -cnotmatch '^dev-v\d+\.\d+\.\d+(?:\.\d+)?-[a-f0-9]{12}$') {throw 'Choose an exact development release tag'}
 $release=Read-Api ('/releases/tags/'+$Tag)
}else {
 $releases=@(Read-Api '/releases?per_page=100' | Where-Object {!$_.draft -and $_.prerelease -and $_.tag_name -cmatch '^dev-v\d+\.\d+\.\d+(?:\.\d+)?-[a-f0-9]{12}$'})
 $release=$null
 # Main ancestry, not completion/publication order, determines the newest build.
 foreach($commit in @(Read-Api '/commits?sha=main&per_page=100')) {
  $matches=@($releases | Where-Object {$_.target_commitish -ceq $commit.sha})
  if($matches.Count -gt 1) {throw 'Ambiguous development releases for one commit'}
  if($matches.Count -eq 1) {$release=$matches[0];break}
 }
 if(!$release) {throw 'No tested development release found in recent main history. Wait for main CI or specify -Tag.'}
}
if($release.draft -or !$release.prerelease -or $release.target_commitish -cnotmatch '^[a-f0-9]{40}$') {throw 'Not a published development build with an exact source commit'}
$taskDownload=Join-Path $WorkDirectory ('download-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $taskDownload -Force | Out-Null
function Get-Asset([string]$Name) {
 $assets=@($release.assets | Where-Object {$_.name -ceq $Name -and $_.state -eq 'uploaded'})
 if($assets.Count -ne 1 -or $assets[0].size -gt 10485760) {throw 'Missing, duplicate or oversized release asset'}
 $url=[uri]$assets[0].browser_download_url
 $expected='https://github.com/'+$repo+'/releases/download/'+$release.tag_name+'/'+$Name
 if($url.AbsoluteUri -cne $expected) {throw 'Unexpected release asset origin/path'}
 $path=Join-Path $taskDownload $Name;Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing -TimeoutSec 60 | Out-Null;return $path
}
$metaPath=Get-Asset 'release.json';$metadata=Get-Content -Raw -LiteralPath $metaPath | ConvertFrom-Json;Assert-TennisMetadata $metadata
if($metadata.tag -cne $release.tag_name -or $metadata.commit -cne $release.target_commitish) {throw 'Release provenance does not match its GitHub release'}
$tagRef=Read-Api ('/git/ref/tags/'+$release.tag_name)
if($tagRef.object.type -cne 'commit' -or $tagRef.object.sha -cne $metadata.commit) {throw 'Release tag is not the exact tested commit'}
$installed=Join-Path $InstallDirectory 'installed-release.json'
if(Test-Path -LiteralPath $installed) {
 $prior=Get-Content -Raw -LiteralPath $installed | ConvertFrom-Json;Assert-TennisMetadata $prior
 $comparison=Read-Api ('/compare/'+$prior.commit+'...'+$metadata.commit)
 if($comparison.status -cnotin @('ahead','identical')) {throw 'Update would move backwards or diverge from installed source'}
}
$zip=Get-Asset $metadata.zip.name;Test-TennisArchive $zip $metadata
if($DownloadOnly) {[pscustomobject]@{status='downloaded-and-verified';version=$metadata.version;commit=$metadata.commit;archive=$zip};return}
Install-TennisRuntime $zip $metadata $InstallDirectory $WorkDirectory -AdoptUntracked:$AdoptUntracked
if($OpenChrome) {
 $paths=@((Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),(Join-Path $env:LOCALAPPDATA 'Google/Chrome/Application/chrome.exe'))
 $chrome=$paths | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
 if(!$chrome) {throw 'Update installed; Chrome executable not found. Open Chrome normally.'}
 Start-Process -FilePath $chrome
}
