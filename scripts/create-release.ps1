param([Parameter(Mandatory=$true)][string]$Commit,[string]$OutputDirectory=(Join-Path $PSScriptRoot '../artifacts'))
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Release.psm1') -Force
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if((& git -C $root rev-parse HEAD) -cne $Commit -or $LASTEXITCODE -ne 0) {throw 'Release provenance requires the checked-out commit'}
& git -C $root diff --quiet HEAD -- outputs/tennis-local/chrome-extension runtime-files.json build.ps1 scripts .github/workflows/reliability.yml
if($LASTEXITCODE -ne 0) {throw 'Commit the tested source and release tools before creating release provenance'}
New-TennisReleaseManifest $root $Commit ([IO.Path]::GetFullPath($OutputDirectory)) | ConvertTo-Json -Depth 8
