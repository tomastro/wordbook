param(
  [switch]$SmokeTest
)

$ErrorActionPreference = "Stop"
$appDirectory = $PSScriptRoot
$electronPath = Join-Path $appDirectory "node_modules\electron\dist\electron.exe"

function Find-Pnpm {
  $command = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $codexPnpm = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
  if (Test-Path -LiteralPath $codexPnpm) { return $codexPnpm }

  return $null
}

if (-not (Test-Path -LiteralPath $electronPath)) {
  $pnpmPath = Find-Pnpm
  if (-not $pnpmPath) {
    throw "Electron is not set up. Install Node.js, then run corepack enable in this folder."
  }

  Write-Host "Setting up Wordbook for the first launch..."
  Push-Location $appDirectory
  try {
    & $pnpmPath install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }

    if (-not (Test-Path -LiteralPath $electronPath)) {
      & $pnpmPath exec install-electron --no
      if ($LASTEXITCODE -ne 0) { throw "Electron download failed." }
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $electronPath)) {
  throw "Electron executable was not found."
}

if ($SmokeTest) {
  & $electronPath $appDirectory --smoke-test
  exit $LASTEXITCODE
}

Start-Process -FilePath $electronPath -ArgumentList @($appDirectory) -WorkingDirectory $appDirectory
