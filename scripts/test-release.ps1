$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Release.psm1') -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$module=Get-Module Release
# Never interact with the owner's actual Chrome processes in these tests.
& $module {function script:Get-Process {param($Name,$ErrorAction) if($script:chromeRunning){[pscustomobject]@{Name='chrome'}}}}
$root=Join-Path ([IO.Path]::GetTempPath()) ('tennis-release-tests-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$count=0
function Check($Condition,[string]$Message){if(!$Condition){throw $Message}}
function Reject([scriptblock]$Run,[string]$Pattern){$caught=$null;try{& $Run | Out-Null}catch{$caught=$_};Check ($null -ne $caught) 'Expected refusal';Check ($caught.Exception.Message -match $Pattern) ('Unexpected refusal: '+$caught.Exception.Message)}
function Fixture {
 $dir=Join-Path $root ([guid]::NewGuid().ToString('N'));$source=Join-Path $dir 'source';$install=Join-Path $dir 'installed';$work=Join-Path $dir 'work'
 New-Item -ItemType Directory -Path $source,$install,$work | Out-Null
 $old=@{name='Tennis booking';manifest_version=3;version='0.9.11';permissions=@('storage','alarms');host_permissions=@('https://example.invalid/*')}
 $new=$old.Clone();$new.version='0.9.12'
 $old | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $install 'manifest.json') -Encoding utf8
 $new | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $source 'manifest.json') -Encoding utf8
 foreach($name in @('background.js','popup.html')){[IO.File]::WriteAllText((Join-Path $install $name),'old-'+$name);[IO.File]::WriteAllText((Join-Path $source $name),'new-'+$name)}
 [IO.File]::WriteAllText((Join-Path $source 'extra.js'),'new runtime')
 # Synthetic sentinel files, never real browser journals or vault data.
 [IO.File]::WriteAllText((Join-Path $install 'owner-state.sentinel'),'preserve unrelated files')
 $zip=Join-Path $dir 'tennis-booking-v0.9.12.zip';[IO.Compression.ZipFile]::CreateFromDirectory($source,$zip)
 $metadata=[pscustomobject]@{schemaVersion=1;repository='eddieyang-97/tennis-booking';channel='development';version='0.9.12';commit=('a'*40);tag=('dev-v0.9.12-'+('a'*12));zip=[pscustomobject]@{name='tennis-booking-v0.9.12.zip';sha256=(Get-TennisHash $zip)};files=@(Get-ChildItem $source -File | ForEach-Object {[pscustomobject]@{path=$_.Name;sha256=(Get-TennisHash $_.FullName)}})}
 return [pscustomobject]@{Zip=$zip;Metadata=$metadata;Source=$source;Install=$install;Work=$work}
}
function Install($f){Install-TennisRuntime $f.Zip $f.Metadata $f.Install $f.Work}
function Unchanged($f){Check ((Get-Content -Raw (Join-Path $f.Install 'background.js')) -ceq 'old-background.js') 'Old runtime changed';Check ((Get-Content -Raw (Join-Path $f.Install 'owner-state.sentinel')) -ceq 'preserve unrelated files') 'Unrelated data changed'}
function Case([string]$Name,[scriptblock]$Run){& $Run;$script:count++;Write-Output ('PASS '+$Name)}
Case 'update exact runtime, preserve path/unrelated files, backup and verify provenance' {
 $f=Fixture;$result=Install $f;Check ($result.status -eq 'updated') 'Not updated';Check ($result.directory -eq $f.Install) 'Path changed';Check (Test-Path (Join-Path $result.backup 'background.js')) 'Missing backup'
 foreach($entry in $f.Metadata.files){Check ((Get-TennisHash (Join-Path $f.Install $entry.path)) -ceq $entry.sha256) 'Wrong installed bytes'}
 Check ((Get-Content -Raw (Join-Path $f.Install 'owner-state.sentinel')) -ceq 'preserve unrelated files') 'Lost sentinel'
 Check ((Install $f).status -eq 'already-current') 'Retry not idempotent'
 [IO.File]::AppendAllText((Join-Path $f.Install 'background.js'),'local edit');Reject {Install $f} 'local changes'
}
Case 'running Chrome refuses writes, never closes processes' {
 $f=Fixture;& $module {$script:chromeRunning=$true};try{Reject {Install $f} 'Close Chrome';Unchanged $f}finally{& $module {$script:chromeRunning=$false}}
}
Case 'archive checksum and per-file hash mismatches refuse before writes' {
 $f=Fixture;$f.Metadata.zip.sha256='0'*64;Reject {Install $f} 'checksum';Unchanged $f
 $f=Fixture;$f.Metadata.files[0].sha256='0'*64;Reject {Install $f} 'file checksum';Unchanged $f
}
foreach($name in @('../escape.js','owner.encrypted.json','nested/file.js','.hidden.js','private.json')){Case ('reject unsafe name '+$name) {$f=Fixture;$f.Metadata.files[0].path=$name;Reject {Install $f} 'Unsafe|Unexpected';Unchanged $f}}
foreach($variant in @('duplicate','unexpected','missing','symlink')){Case ('reject archive '+$variant) {
 $f=Fixture;$zip=[IO.Compression.ZipFile]::Open($f.Zip,[IO.Compression.ZipArchiveMode]::Update)
 try{
  if($variant -eq 'missing'){$zip.GetEntry('popup.html').Delete()}
  elseif($variant -eq 'symlink'){$zip.GetEntry('background.js').ExternalAttributes=([int]40960 -shl 16)}
  else {$entry=$zip.CreateEntry($(if($variant -eq 'duplicate'){'background.js'}else{'unexpected.js'}));$stream=$entry.Open();$stream.Dispose()}
 }finally{$zip.Dispose()}
 $f.Metadata.zip.sha256=Get-TennisHash $f.Zip;Reject {Install $f} 'Unsafe|Missing';Unchanged $f
}}
Case 'refuse downgrade and untracked same-version replacement' {
 $f=Fixture;$manifest=Get-Content -Raw (Join-Path $f.Install 'manifest.json') | ConvertFrom-Json;$manifest.version='1.0.0';$manifest | ConvertTo-Json | Set-Content (Join-Path $f.Install 'manifest.json');Reject {Install $f} 'downgrade';Unchanged $f
 $manifest.version='0.9.12';$manifest | ConvertTo-Json | Set-Content (Join-Path $f.Install 'manifest.json');Reject {Install $f} 'Same-version';Unchanged $f
}
Case 'new permissions require review before writes' {
 $f=Fixture;$manifest=Get-Content -Raw (Join-Path $f.Install 'manifest.json') | ConvertFrom-Json;$manifest.permissions=@('storage');$manifest | ConvertTo-Json | Set-Content (Join-Path $f.Install 'manifest.json');Reject {Install $f} 'permissions';Unchanged $f
}
Case 'manifest key change refuses a different extension identity' {
 $f=Fixture;$manifest=Get-Content -Raw (Join-Path $f.Install 'manifest.json') | ConvertFrom-Json;$manifest | Add-Member NoteProperty key 'synthetic-old-key';$manifest | ConvertTo-Json | Set-Content (Join-Path $f.Install 'manifest.json');Reject {Install $f} 'identity key';Unchanged $f
}
Case 'runtime destination directory refuses before writes' {
 $f=Fixture;New-Item -ItemType Directory (Join-Path $f.Install 'extra.js') | Out-Null;Reject {Install $f} 'directory or link';Unchanged $f
}
Case 'partial copy failure rolls back old files and removes only newly created runtime files' {
 $f=Fixture
 & $module {
  $script:failCopy=$true
  function script:Copy-Item {param($LiteralPath,$Destination,[switch]$Force)
   if($script:failCopy -and $LiteralPath -match 'stage-[a-f0-9]+' -and [IO.Path]::GetFileName($LiteralPath) -eq 'popup.html'){$script:failCopy=$false;throw 'Injected copy failure'}
   Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
  }
 }
 try{Reject {Install $f} 'Injected';Unchanged $f;Check (!(Test-Path (Join-Path $f.Install 'extra.js'))) 'New file not rolled back';Check (!(Test-Path (Join-Path $f.Install 'installed-release.json'))) 'False provenance'}finally{& $module {Remove-Item Function:Copy-Item}}
}
Write-Output "$count release/install regression cases passed under PowerShell $($PSVersionTable.PSVersion)"

# Exercise the public updater entry point with HTTP stubs; no GitHub writes/network.
function Invoke-RestMethod {param($Uri,$Headers,$TimeoutSec)
 $route=$Uri.ToString().Replace('https://api.github.com/repos/eddieyang-97/tennis-booking','')
 switch -Wildcard ($route) {
  '/releases?*' {return $global:tennisTestapiReleases}
  '/commits?*' {return @([pscustomobject]@{sha=('a'*40)},[pscustomobject]@{sha=('b'*40)})}
  '/git/ref/*' {return [pscustomobject]@{object=[pscustomobject]@{type='commit';sha=$global:tennisTesttagSha}}}
  '/compare/*' {return [pscustomobject]@{status=$global:tennisTestcomparison}}
  default {throw ('Unexpected test API route '+$route)}
 }
}
function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec)
 $global:tennisTestassetReads+=$Uri.ToString()
 $name=[IO.Path]::GetFileName($Uri.AbsolutePath)
 Copy-Item -LiteralPath (Join-Path $global:tennisTestdownloadFixture $name) -Destination $OutFile
}
function ApiFixture($f){
 $global:tennisTestdownloadFixture=Split-Path $f.Zip;$global:tennisTesttagSha='a'*40;$global:tennisTestcomparison='ahead';$global:tennisTestassetReads=@()
 $f.Metadata | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $global:tennisTestdownloadFixture 'release.json') -Encoding utf8
 $assets=@('release.json',$f.Metadata.zip.name) | ForEach-Object {[pscustomobject]@{name=$_;state='uploaded';size=100;browser_download_url=('https://github.com/eddieyang-97/tennis-booking/releases/download/'+$f.Metadata.tag+'/'+$_)}}
 $release=[pscustomobject]@{draft=$false;prerelease=$true;tag_name=$f.Metadata.tag;target_commitish=$f.Metadata.commit;assets=@($assets)}
 # A delayed older CI run published after the newer main ancestor. Release list
 # order must never determine the selected source revision.
 $global:tennisTestapiReleases=@([pscustomobject]@{draft=$false;prerelease=$true;tag_name=('dev-v0.9.11-'+('b'*12));target_commitish=('b'*40);assets=@()},$release)
}
Case 'updater selects by main ancestry and verifies download without touching installed files' {
 $f=Fixture;ApiFixture $f
 $result=& (Join-Path $PSScriptRoot '../update-extension.ps1') -InstallDirectory $f.Install -WorkDirectory $f.Work -DownloadOnly
 Check ($result.status -eq 'downloaded-and-verified') 'Download not verified';Check ($result.commit -ceq ('a'*40)) 'Selected older publication';Check ($global:tennisTestassetReads.Count -eq 2) 'Unexpected asset requests';Unchanged $f
}
Case 'updater rejects changed tag commit before ZIP download' {
 $f=Fixture;ApiFixture $f;$global:tennisTesttagSha='b'*40
 Reject {& (Join-Path $PSScriptRoot '../update-extension.ps1') -InstallDirectory $f.Install -WorkDirectory $f.Work -DownloadOnly} 'exact tested commit';Check ($global:tennisTestassetReads.Count -eq 1) 'Downloaded ZIP despite wrong tag';Unchanged $f
}
Case 'updater rejects rollback ancestry before ZIP download' {
 $f=Fixture;ApiFixture $f;$global:tennisTestcomparison='behind';$f.Metadata | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $f.Install 'installed-release.json') -Encoding utf8
 Reject {& (Join-Path $PSScriptRoot '../update-extension.ps1') -InstallDirectory $f.Install -WorkDirectory $f.Work -DownloadOnly} 'backwards';Check ($global:tennisTestassetReads.Count -eq 1) 'Downloaded rollback ZIP';Unchanged $f
}
Case 'updater refuses foreign asset URL before downloading it' {
 $f=Fixture;ApiFixture $f;$global:tennisTestapiReleases[1].assets[0].browser_download_url='https://example.invalid/release.json'
 Reject {& (Join-Path $PSScriptRoot '../update-extension.ps1') -InstallDirectory $f.Install -WorkDirectory $f.Work -DownloadOnly} 'origin';Check ($global:tennisTestassetReads.Count -eq 0) 'Foreign download attempted';Unchanged $f
}
Write-Output "$count total release/updater regression cases passed"
