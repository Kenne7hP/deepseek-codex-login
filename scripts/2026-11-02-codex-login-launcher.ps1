param([ValidateSet('Login','DryRun','Status')][string]$Mode = 'Login')
$ErrorActionPreference = 'Stop'
$harnessExe = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
$helperScript = Join-Path $PSScriptRoot '2026-11-02-codex-login-helper.cjs'
$previousElectronMode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $helperArgs = @('--expose-internals', $helperScript)
    if ($Mode -eq 'DryRun') { $helperArgs += '--dry-run' }
    if ($Mode -eq 'Status') { $helperArgs += '--status' }
    & $harnessExe @helperArgs | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Harness helper exited with code $LASTEXITCODE" }
} finally {
    $env:ELECTRON_RUN_AS_NODE = $previousElectronMode
}
