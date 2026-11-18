$ErrorActionPreference = "Stop"
$AccountsFile = Join-Path $HOME ".antigravity_tools\accounts.json"
$RoomsFile = Join-Path $HOME ".agy-relay-deck\rooms.json"

if (-not (Test-Path $AccountsFile)) { throw "找不到 Antigravity Tools accounts.json。请先安装 Tools、导入账号并选中当前账号。" }
if (-not (Test-Path $RoomsFile)) { throw "找不到 Agy Relay rooms.json。请先运行 Restore-Windows.ps1。" }

$Accounts = Get-Content -Raw -Encoding UTF8 $AccountsFile | ConvertFrom-Json
$CurrentId = $Accounts.current_account_id
if (-not $CurrentId) { throw "Antigravity Tools 当前没有选中的账号。" }

$Backup = "$RoomsFile.before-windows-rebind-$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
Copy-Item $RoomsFile $Backup
$Rooms = Get-Content -Raw -Encoding UTF8 $RoomsFile | ConvertFrom-Json
foreach ($Room in $Rooms) {
  if ($Room.state -in @("ready", "handoff_pending_verification", "handoff_source_pending_verification", "handed_off")) {
    $Room.accountId = $CurrentId
  }
  $Room.workspace = $HOME
}
$Rooms | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 $RoomsFile

Write-Host "房间已绑定到 Antigravity Tools 当前账号。" -ForegroundColor Green
Write-Host "原 rooms.json 备份：$Backup"

