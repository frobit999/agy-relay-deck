param(
  [string]$PackageRoot = $PSScriptRoot,
  [string]$PanelDestination = (Join-Path $HOME "AgyRelayDeck")
)

$ErrorActionPreference = "Stop"
$Payload = Join-Path $PackageRoot "payload\antigravity-cli"
$RelayPayload = Join-Path $PackageRoot "payload\relay-state"
$AppPayload = Join-Path $PackageRoot "app\agy-relay-deck"
$AgyDestination = Join-Path $HOME ".gemini\antigravity-cli"
$RelayDestination = Join-Path $HOME ".agy-relay-deck"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $HOME "AgyMigrationBackup-$Stamp"

if (-not (Test-Path $Payload)) { throw "找不到 payload\antigravity-cli，请确认迁移目录复制完整。" }
if (-not (Test-Path $RelayPayload)) { throw "找不到 payload\relay-state。" }
if (-not (Test-Path $AppPayload)) { throw "找不到 app\agy-relay-deck。" }
if (Get-Process -Name agy -ErrorAction SilentlyContinue) { throw "检测到 agy 正在运行。请先关闭所有 agy 窗口。" }

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
foreach ($Pair in @(@($AgyDestination, "antigravity-cli"), @($RelayDestination, "agy-relay-deck"), @($PanelDestination, "panel"))) {
  if (Test-Path $Pair[0]) {
    Move-Item -Path $Pair[0] -Destination (Join-Path $BackupRoot $Pair[1])
  }
}

function Copy-Tree([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  & robocopy $Source $Destination /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy 失败，退出码 $LASTEXITCODE" }
}

Copy-Tree $Payload $AgyDestination
Copy-Tree $RelayPayload $RelayDestination
Copy-Tree $AppPayload $PanelDestination

$RoomsFile = Join-Path $RelayDestination "rooms.json"
if (Test-Path $RoomsFile) {
  $Rooms = Get-Content -Raw -Encoding UTF8 $RoomsFile | ConvertFrom-Json
  foreach ($Room in $Rooms) {
    $Room.workspace = $HOME
    if ($Room.PSObject.Properties["cleanupManifest"]) { $Room.cleanupManifest = $null }
    foreach ($Retired in @($Room.retiredBranches)) {
      if ($Retired -and $Retired.PSObject.Properties["cleanupManifest"]) { $Retired.cleanupManifest = $null }
    }
  }
  $Rooms | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 $RoomsFile
}

$Desktop = [Environment]::GetFolderPath("Desktop")
$Shortcut = Join-Path $Desktop "Agy Relay.cmd"
"@echo off`r`ncd /d `"$PanelDestination`"`r`ncall start-windows.cmd`r`n" | Set-Content -Encoding ASCII $Shortcut

Write-Host ""
Write-Host "恢复完成。旧 Windows 数据已移动到：$BackupRoot" -ForegroundColor Green
Write-Host "下一步运行 .\Verify-Windows.ps1，然后重新登录 agy 与 Antigravity Tools。"

