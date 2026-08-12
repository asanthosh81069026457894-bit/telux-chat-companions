$ErrorActionPreference = 'Stop'
$logPath = $args[0]
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  if (Test-Path $logPath) {
    $content = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
    if ($content) {
      $m = [regex]::Match($content, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
      if ($m.Success) {
        Write-Output $m.Value
        exit 0
      }
    }
  }
  Start-Sleep -Seconds 1
}
Write-Output 'TIMEOUT'
exit 1
