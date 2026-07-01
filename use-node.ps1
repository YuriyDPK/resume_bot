$NodeHome = Join-Path $PSScriptRoot ".tools\node-v22.23.1-win-x64"

if (-not (Test-Path (Join-Path $NodeHome "node.exe"))) {
  Write-Error "Portable Node.js не найден: $NodeHome"
  exit 1
}

if (($env:Path -split ";") -notcontains $NodeHome) {
  $env:Path = "$NodeHome;$env:Path"
}

Write-Host "Node.js подключен для текущего терминала:" -ForegroundColor Green
node -v
Write-Host "npm:" -ForegroundColor Green
npm -v
Write-Host ""
Write-Host "Теперь можно запускать: npm i, npx prisma migrate dev, npm run dev" -ForegroundColor Cyan
