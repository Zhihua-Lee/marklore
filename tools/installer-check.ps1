# Installer check, run before a release: installs the given setup silently for
# the current user into .local\install-test, checks shortcuts, the Apps entry,
# a smoke start with an isolated profile, upgrade over itself and uninstall.
# It writes Marklore registrations under HKCU to test their cleanup, after
# backing up the ones already there, and restores them at the end.
#   powershell -ExecutionPolicy Bypass -File tools\installer-check.ps1 -Setup <path to Marklore-Setup-*.exe>
param([string]$Setup)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path $root '.local\install-test'
$dir = Join-Path $work 'Marklore'
$exe = Join-Path $dir 'Marklore.exe'
$profileDir = Join-Path $work 'profile'
$results = New-Object System.Collections.Generic.List[string]
$failed = 0
function Check($name, $ok) {
  $script:results.Add(("{0}  {1}" -f ($(if ($ok) { 'PASS' } else { 'FAIL' })), $name))
  if (-not $ok) { $script:failed++ }
}
function RegValue($key, $name) {
  try { (Get-ItemProperty -Path $key -Name $name -ErrorAction Stop).$name } catch { $null }
}
$cmdKey = 'HKCU:\Software\Classes\Marklore.Markdown\shell\open\command'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Marklore.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Marklore.lnk'
$appData = Join-Path $env:APPDATA 'Marklore'
function Snapshot($path) {
  if (-not (Test-Path $path)) { return '' }
  (Get-ChildItem $path -Recurse -Force | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join "`n"
}
function UninstallEntry {
  Get-ChildItem $uninstallRoot | Where-Object { (RegValue $_.PSPath 'DisplayName') -eq 'Marklore' }
}
function Install {
  $p = Start-Process $Setup -ArgumentList @('/S', '/currentuser', "/D=$dir") -Wait -PassThru
  return $p.ExitCode
}
function Uninstall {
  $u = Join-Path $dir 'Uninstall Marklore.exe'
  Start-Process $u -ArgumentList @('/S', '/currentuser') -Wait | Out-Null
  # The uninstaller hands off to a copy in %TEMP%; wait for it to finish.
  for ($i = 0; $i -lt 120 -and ((Test-Path $exe) -or (UninstallEntry)); $i++) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Seconds 1
}

# Back up what is registered now.
$backup = Join-Path $work 'backup'
New-Item -ItemType Directory -Force $backup | Out-Null
Remove-Item (Join-Path $backup '*.reg') -ErrorAction SilentlyContinue
Start-Process reg.exe -ArgumentList @('export', 'HKCU\Software\Classes\Marklore.Markdown', "`"$(Join-Path $backup 'progid.reg')`"", '/y') -Wait -WindowStyle Hidden
Start-Process reg.exe -ArgumentList @('export', 'HKCU\Software\Marklore', "`"$(Join-Path $backup 'software.reg')`"", '/y') -Wait -WindowStyle Hidden
$before = @{
  command = RegValue $cmdKey '(default)'
  registered = RegValue 'HKCU:\Software\RegisteredApplications' 'Marklore'
  md = $null -ne (RegValue 'HKCU:\Software\Classes\.md\OpenWithProgids' 'Marklore.Markdown')
  markdown = $null -ne (RegValue 'HKCU:\Software\Classes\.markdown\OpenWithProgids' 'Marklore.Markdown')
  run = RegValue $runKey 'Marklore'
}
$appDataBefore = Snapshot $appData
$desktopHad = Test-Path $desktopLink
$menuHad = Test-Path $startMenu

try {
  # 1. Install, leave another copy's registration alone on uninstall.
  Check 'installer exit code 0' ((Install) -eq 0)
  Check 'program installed' (Test-Path $exe)
  Check 'uninstaller beside the program' (Test-Path (Join-Path $dir 'Uninstall Marklore.exe'))
  Check 'Start menu shortcut' (Test-Path $startMenu)
  Check 'desktop shortcut' (Test-Path $desktopLink)
  $entry = UninstallEntry
  Check 'Apps & features entry' ($null -ne $entry)
  if ($entry) { Check 'entry uninstalls this folder' ("$(RegValue $entry.PSPath 'UninstallString')".Contains("$dir\Uninstall Marklore.exe")) }
  Check 'no portable data folder created' (-not (Test-Path (Join-Path $dir 'data')))
  # A debug.log left in Electron's own folder would ship with local paths.
  Check 'no debug.log shipped' (-not (Test-Path (Join-Path $dir 'debug.log')))

  # Smoke launch with an isolated profile, window inactive.
  $env:FOLIO_DATA_DIR = $profileDir; $env:FOLIO_TEST_INACTIVE = '1'
  $app = Start-Process $exe -PassThru
  Start-Sleep -Seconds 6
  $alive = -not $app.HasExited
  Check 'installed app starts' $alive
  Check 'isolated profile used' ((Get-ChildItem $profileDir -Force -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, 'CurrentCultureIgnoreCase') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:FOLIO_DATA_DIR, Env:FOLIO_TEST_INACTIVE
  Start-Sleep -Seconds 1

  Uninstall
  Check 'program folder removed' (-not (Test-Path $dir))
  Check 'Start menu shortcut removed' (-not (Test-Path $startMenu))
  Check 'desktop shortcut removed' (-not (Test-Path $desktopLink))
  Check 'Apps & features entry removed' ($null -eq (UninstallEntry))
  Check "another copy's file association kept" ((RegValue $cmdKey '(default)') -eq $before.command)
  Check "another copy's RegisteredApplications kept" ((RegValue 'HKCU:\Software\RegisteredApplications' 'Marklore') -eq $before.registered)

  # 2. Registrations that point here: kept on upgrade, removed on uninstall.
  Check 'reinstall exit code 0' ((Install) -eq 0)
  $ours = '"' + $exe + '" "%1"'
  # Written through .NET: PowerShell 5.1 strips quotes from native arguments.
  $H = 'HKEY_CURRENT_USER\Software'
  $none = [Microsoft.Win32.RegistryValueKind]::None
  [Microsoft.Win32.Registry]::SetValue("$H\Classes\Marklore.Markdown\shell\open\command", '', $ours)
  [Microsoft.Win32.Registry]::SetValue("$H\Marklore\Capabilities", 'ApplicationName', 'Marklore')
  [Microsoft.Win32.Registry]::SetValue("$H\RegisteredApplications", 'Marklore', 'Software\Marklore\Capabilities')
  [Microsoft.Win32.Registry]::SetValue("$H\Classes\.md\OpenWithProgids", 'Marklore.Markdown', [byte[]]@(), $none)
  [Microsoft.Win32.Registry]::SetValue("$H\Classes\.markdown\OpenWithProgids", 'Marklore.Markdown', [byte[]]@(), $none)
  # The exact value Electron's setLoginItemSettings writes.
  [Microsoft.Win32.Registry]::SetValue("$H\Microsoft\Windows\CurrentVersion\Run", 'Marklore', '"' + $exe + '" --background')
  Check 'test registration written exactly' (((RegValue $cmdKey '(default)') -eq $ours) -and ((RegValue $runKey 'Marklore') -eq ('"' + $exe + '" --background')))

  Check 'upgrade over itself exit code 0' ((Install) -eq 0)
  Check 'upgrade keeps file association' ((RegValue $cmdKey '(default)') -eq $ours)
  Check 'upgrade keeps startup entry' ($null -ne (RegValue $runKey 'Marklore'))
  Check 'upgrade keeps shortcuts' ((Test-Path $startMenu) -and (Test-Path $desktopLink))

  Uninstall
  Check 'own file association removed' (-not (Test-Path 'HKCU:\Software\Classes\Marklore.Markdown'))
  Check 'own capabilities removed' (-not (Test-Path 'HKCU:\Software\Marklore'))
  Check 'own RegisteredApplications removed' ($null -eq (RegValue 'HKCU:\Software\RegisteredApplications' 'Marklore'))
  Check 'own .md OpenWithProgids removed' ($null -eq (RegValue 'HKCU:\Software\Classes\.md\OpenWithProgids' 'Marklore.Markdown'))
  Check 'own startup entry removed' ($null -eq (RegValue $runKey 'Marklore'))
  Check 'program folder removed again' (-not (Test-Path $dir))
}
finally {
  $ErrorActionPreference = 'Continue'
  if (Test-Path (Join-Path $dir 'Uninstall Marklore.exe')) { Uninstall }
  # Restore the registrations exactly as they were.
  $H = 'HKEY_CURRENT_USER\Software'
  $hkcu = [Microsoft.Win32.Registry]::CurrentUser
  foreach ($k in @('Software\Classes\Marklore.Markdown', 'Software\Marklore')) {
    if ($hkcu.OpenSubKey($k)) { $hkcu.DeleteSubKeyTree($k) }
  }
  foreach ($file in @('progid.reg', 'software.reg')) {
    $path = Join-Path $backup $file
    if (Test-Path $path) { Start-Process reg.exe -ArgumentList @('import', "`"$path`"") -Wait -WindowStyle Hidden }
  }
  function Restore($sub, $name, $value, $kind) {
    $key = $hkcu.CreateSubKey($sub)
    if ($null -ne $value) { $key.SetValue($name, $value, $kind) } else { $key.DeleteValue($name, $false) }
    $key.Close()
  }
  $sz = [Microsoft.Win32.RegistryValueKind]::String
  $none = [Microsoft.Win32.RegistryValueKind]::None
  Restore 'Software\RegisteredApplications' 'Marklore' $before.registered $sz
  foreach ($ext in @('md', 'markdown')) {
    Restore "Software\Classes\.$ext\OpenWithProgids" 'Marklore.Markdown' $(if ($before[$ext]) { [byte[]]@() } else { $null }) $none
  }
  Restore 'Software\Microsoft\Windows\CurrentVersion\Run' 'Marklore' $before.run $sz
}

Check 'registrations restored' (((RegValue $cmdKey '(default)') -eq $before.command) -and ((RegValue 'HKCU:\Software\RegisteredApplications' 'Marklore') -eq $before.registered))
Check 'shortcuts as before' (((Test-Path $desktopLink) -eq $desktopHad) -and ((Test-Path $startMenu) -eq $menuHad))
# The running copy keeps writing to its profile: check it is still there.
Check '%APPDATA%\Marklore kept' ((-not $appDataBefore) -or (Test-Path (Join-Path $appData 'session.json')))
$results
"failed: $failed"
