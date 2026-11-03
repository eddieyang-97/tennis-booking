$ErrorActionPreference = 'Stop'
function Get-TennisHash([string]$Path) {
 $stream=[IO.File]::OpenRead($Path);$hash=[Security.Cryptography.SHA256]::Create()
 try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
 finally {$stream.Dispose();$hash.Dispose()}
}
function Assert-TennisMetadata($Metadata) {
 if($Metadata.schemaVersion -ne 1 -or $Metadata.repository -cne 'eddieyang-97/tennis-booking' -or $Metadata.channel -cne 'development' -or $Metadata.commit -cnotmatch '^[a-f0-9]{40}$' -or $Metadata.version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') {throw 'Invalid development release identity'}
 if($Metadata.tag -cne ('dev-v'+$Metadata.version+'-'+$Metadata.commit.Substring(0,12)) -or $Metadata.zip.name -cne ('tennis-booking-v'+$Metadata.version+'.zip') -or $Metadata.zip.sha256 -cnotmatch '^[a-f0-9]{64}$') {throw 'Release tag, version or archive identity mismatch'}
 $names=@();foreach($file in $Metadata.files) {
  if($file.path -cnotmatch '^[a-zA-Z0-9.-]+$' -or $file.path -match '^\.|fixture|scenario|fake-|encrypted|vault.*json' -or $file.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $names -contains $file.path) {throw 'Unsafe or duplicate runtime filename/hash'}
  if($file.path -notmatch '\.(js|html|png)$' -and $file.path -cnotin @('manifest.json','README.md')) {throw 'Unexpected runtime file type'}
  $names+= $file.path
 }
 if($names.Count -lt 3 -or $names.Count -gt 100 -or $names -cnotcontains 'manifest.json' -or $names -cnotcontains 'background.js' -or $names -cnotcontains 'popup.html') {throw 'Incomplete runtime manifest'}
}
function Test-TennisArchive([string]$ZipPath,$Metadata,[string]$SourceDirectory='') {
 Assert-TennisMetadata $Metadata
 if((Get-Item -LiteralPath $ZipPath).Length -gt 10485760 -or (Get-TennisHash $ZipPath) -cne $Metadata.zip.sha256) {throw 'Archive checksum or size mismatch'}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $zip=[IO.Compression.ZipFile]::OpenRead($ZipPath)
 try {
  $names=@();$total=0L
  foreach($entry in $zip.Entries) {
   $file=@($Metadata.files | Where-Object {$_.path -ceq $entry.FullName})
   if($file.Count -ne 1 -or $names -contains $entry.FullName -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960 -or $entry.Length -gt 2097152) {throw 'Unsafe or unexpected archive entry'}
   $names+=$entry.FullName;$total+=$entry.Length;if($total -gt 20971520) {throw 'Archive expansion limit exceeded'}
   $stream=$entry.Open();$hash=[Security.Cryptography.SHA256]::Create()
   try {$actual=[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$hash.Dispose()}
   if($actual -cne $file[0].sha256) {throw 'Runtime file checksum mismatch'}
   if($SourceDirectory -and (Get-TennisHash (Join-Path $SourceDirectory $entry.FullName)) -cne $actual) {throw 'Archive differs from tested source'}
  }
  if($names.Count -ne @($Metadata.files).Count) {throw 'Missing runtime archive entries'}
 }finally{$zip.Dispose()}
}
function New-TennisReleaseManifest([string]$RepositoryRoot,[string]$Commit,[string]$OutputDirectory) {
 if($Commit -cnotmatch '^[a-f0-9]{40}$') {throw 'A full tested commit SHA is required'}
 $source=Join-Path $RepositoryRoot 'outputs/tennis-local/chrome-extension'
 $manifest=Get-Content -Raw -LiteralPath (Join-Path $source 'manifest.json') | ConvertFrom-Json
 $version=$manifest.version;$zipName='tennis-booking-v'+$version+'.zip';$zip=Join-Path $OutputDirectory $zipName
 $files=@(Get-Content -Raw -LiteralPath (Join-Path $RepositoryRoot 'runtime-files.json') | ConvertFrom-Json | ForEach-Object { [ordered]@{path=$_;sha256=Get-TennisHash (Join-Path $source $_)} })
 $release=[ordered]@{schemaVersion=1;repository='eddieyang-97/tennis-booking';channel='development';version=$version;commit=$Commit;tag=('dev-v'+$version+'-'+$Commit.Substring(0,12));zip=[ordered]@{name=$zipName;sha256=Get-TennisHash $zip};files=$files}
 Test-TennisArchive $zip $release $source
 $utf8=New-Object Text.UTF8Encoding($false)
 [IO.File]::WriteAllText((Join-Path $OutputDirectory 'release.json'),($release | ConvertTo-Json -Depth 8)+"`n",$utf8)
 [IO.File]::WriteAllText((Join-Path $OutputDirectory 'checksums.txt'),($release.zip.sha256+'  '+$zipName+"`n"),$utf8)
 return $release
}
function Assert-TennisChromeClosed {
 if(@(Get-Process chrome -ErrorAction SilentlyContinue).Count) {throw 'Close Chrome before applying this update. No browser process will be closed automatically.'}
}
function Install-TennisRuntime([string]$ZipPath,$Metadata,[string]$InstallDirectory,[string]$WorkDirectory,[switch]$AdoptUntracked) {
 Test-TennisArchive $ZipPath $Metadata
 $target=Get-Item -LiteralPath $InstallDirectory -ErrorAction Stop
 if(!$target.PSIsContainer -or ($target.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Choose the existing unpacked extension directory, not a link'}
 $root=$target.FullName;$manifestPath=Join-Path $root 'manifest.json'
 $old=Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
 if($old.name -cne 'Tennis booking' -or $old.manifest_version -ne 3 -or [version]$old.version -gt [version]$Metadata.version) {throw 'Wrong extension directory or downgrade refused'}
 $provenance=Join-Path $root 'installed-release.json';$prior=$null
 if(Test-Path -LiteralPath $provenance) {
  $prior=Get-Content -Raw -LiteralPath $provenance | ConvertFrom-Json;Assert-TennisMetadata $prior
  foreach($file in $prior.files) {if(!(Test-Path -LiteralPath (Join-Path $root $file.path)) -or (Get-TennisHash (Join-Path $root $file.path)) -cne $file.sha256) {throw 'Installed runtime has local changes; preserve/review them before updating'}}
  if($prior.commit -ceq $Metadata.commit) {return [pscustomobject]@{status='already-current';version=$old.version;directory=$root}}
 }
 if(!$prior) {
  if([version]$old.version -eq [version]$Metadata.version) {
   throw 'Same-version replacement requires installed provenance. For a repository-backed install, update with Git and reload the existing extension.'
  }
  if(!$AdoptUntracked) {
   throw 'Installed runtime has no release provenance. Update repository-backed installs with Git. For an older standalone install, review local changes before opting in with -AdoptUntracked.'
  }
 }
 $taskStage=Join-Path $WorkDirectory ('stage-'+[guid]::NewGuid().ToString('N'));$backup=Join-Path $WorkDirectory ('backup-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $taskStage,$backup -Force | Out-Null
 [IO.Compression.ZipFile]::ExtractToDirectory($ZipPath,$taskStage)
 $new=Get-Content -Raw -LiteralPath (Join-Path $taskStage 'manifest.json') | ConvertFrom-Json
 if($new.version -cne $Metadata.version -or $new.name -cne 'Tennis booking' -or $new.manifest_version -ne 3) {throw 'Packaged manifest identity mismatch'}
 if($new.key -cne $old.key) {throw 'Extension identity key changed; manual review required'}
 $oldAccess=@($old.permissions)+@($old.host_permissions)+@($old.content_scripts | ForEach-Object {$_.matches})
 $newAccess=@($new.permissions)+@($new.host_permissions)+@($new.content_scripts | ForEach-Object {$_.matches})
 if(@($newAccess | Where-Object {$_ -and $oldAccess -cnotcontains $_}).Count) {throw 'New permissions/site access require manual review'}
 $paths=@($Metadata.files | ForEach-Object {$_.path})+@('installed-release.json');$existed=@{}
 foreach($name in $paths) {
  $path=Join-Path $root $name
  if(Test-Path -LiteralPath $path) {
   $item=Get-Item -LiteralPath $path;if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {throw 'Runtime destination is a directory or link'}
   Copy-Item -LiteralPath $path -Destination (Join-Path $backup $name);$existed[$name]=$true
  }
 }
 Assert-TennisChromeClosed
 $written=@()
 try {
  # The manifest/version changes last. Never enumerate/delete unrelated files.
  foreach($name in @($Metadata.files | Where-Object {$_.path -cne 'manifest.json'} | ForEach-Object {$_.path})+@('manifest.json')) {
   Assert-TennisChromeClosed;$written+=$name
   Copy-Item -LiteralPath (Join-Path $taskStage $name) -Destination (Join-Path $root $name) -Force
   $expected=($Metadata.files | Where-Object {$_.path -ceq $name}).sha256
   if((Get-TennisHash (Join-Path $root $name)) -cne $expected) {throw 'Installed file verification failed'}
  }
  $written+='installed-release.json';$utf8=New-Object Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($provenance,($Metadata | ConvertTo-Json -Depth 8)+"`n",$utf8)
 }catch {
  $failure=$_
  try {foreach($name in $written) {
   $path=Join-Path $root $name
   if($existed[$name]) {Copy-Item -LiteralPath (Join-Path $backup $name) -Destination $path -Force}
   elseif(Test-Path -LiteralPath $path) {Remove-Item -LiteralPath $path -Force}
  }}catch {throw ('Update and rollback failed; keep Chrome closed. Backup: '+$backup)}
  throw ('Update failed; prior files restored. Backup: '+$backup+'. '+$failure.Exception.Message)
 }
 return [pscustomobject]@{status='updated';version=$Metadata.version;commit=$Metadata.commit;directory=$root;backup=$backup;reload='Start Chrome to load the new files, then unlock the card. Browser storage was not accessed.'}
}
Export-ModuleMember -Function Get-TennisHash,Assert-TennisMetadata,Test-TennisArchive,New-TennisReleaseManifest,Install-TennisRuntime,Assert-TennisChromeClosed
