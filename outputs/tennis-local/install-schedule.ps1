# Prepared installer: deliberately blocked until the booking adapter is tested.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$taskName = 'Bethnal Green Tennis Booking'
# Check the exact task first. Errors other than not-found must stop installation.
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue -ErrorVariable taskError
if ($existing) { throw 'A Bethnal Green Tennis Booking task already exists. Review it before replacing it.' }
if ($taskError -and $taskError[0].Exception.Message -notmatch 'No MSFT_ScheduledTask objects found') {
    throw ('Could not determine whether the task already exists: ' + $taskError[0].Exception.Message)
}
$config = Get-Content (Join-Path $root 'preferences.json') -Raw | ConvertFrom-Json
if (-not $config.adapter_verified) {
    throw 'Booking flow is not implemented and tested. No scheduled task was created. Run setup.cmd first.'
}
if (-not $config.automatic_payment_enabled -or $null -eq $config.max_total_gbp) {
    throw 'A verified basket price and explicit spending limit are required before enabling automatic booking.'
}
if ($config.release_days_ahead -ne 7) { throw 'Expected release exactly seven days before playing date.' }
# Windows local time must track London, including daylight saving time.
if ((Get-TimeZone).Id -ne 'GMT Standard Time') {
    throw 'Set Windows time zone to London before installing this midnight schedule.'
}
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw 'Run setup.cmd first.' }
$action = New-ScheduledTaskAction -Execute $python -Argument ('"' + (Join-Path $root 'tennis.py') + '" scheduled') -WorkingDirectory $root
# Pre-open before midnight; the verified adapter must wait for London midnight
# and act only for a newly released Monday-Thursday playing date.
$trigger = New-ScheduledTaskTrigger -Daily -At '23:59'
$settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Bethnal Green Tennis Booking' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Tennis booking with weekly duplicate checks' | Out-Null
Write-Host 'Task registered. Windows must be awake and the user logged in. Successful booking is not guaranteed.'
