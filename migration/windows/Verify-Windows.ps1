param([string]$PackageRoot = $PSScriptRoot)

$ErrorActionPreference = "Stop"
$Verifier = Join-Path $PackageRoot "scripts\verify_windows.py"
if (-not (Test-Path $Verifier)) { throw "找不到 scripts\verify_windows.py" }

$Python = Get-Command python.exe -ErrorAction SilentlyContinue
if ($Python) {
  & $Python.Source $Verifier --package $PackageRoot --restored-root (Join-Path $HOME ".gemini\antigravity-cli")
} else {
  $Py = Get-Command py.exe -ErrorAction SilentlyContinue
  if (-not $Py) { throw "找不到 Python 3。请安装后重新运行。" }
  & $Py.Source -3 $Verifier --package $PackageRoot --restored-root (Join-Path $HOME ".gemini\antigravity-cli")
}
if ($LASTEXITCODE -ne 0) { throw "完整性检查失败。不要抹除 Mac。" }

