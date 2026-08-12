$ErrorActionPreference = 'Stop'
for ($i = 0; $i -lt 90; $i++) {
  try {
    $r = Invoke-WebRequest 'http://127.0.0.1:3000' -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) {
      Write-Output "READY after ${i}s"
      exit 0
    }
  } catch { }
  Start-Sleep -Seconds 1
}
Write-Output 'TIMEOUT'
exit 1
