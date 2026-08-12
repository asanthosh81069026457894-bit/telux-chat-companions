$ErrorActionPreference = 'Continue'
$url = 'https://earth-certain-uncertainty-reception.trycloudflare.com/'
$headers = @{
  'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  'Accept'     = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  'Accept-Language' = 'en-US,en;q=0.5'
}
try {
  $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 25 -Headers $headers
  Write-Output ("Status: " + $r.StatusCode)
  Write-Output ("Server: " + $r.Headers['Server'])
  Write-Output ("Cf-Mitigated: " + $r.Headers['Cf-Mitigated'])
  Write-Output ("Title (first 200 chars):")
  $title = ($r.Content | Select-String -Pattern '<title>(.*?)</title>' -AllMatches).Matches[0].Groups[1].Value
  Write-Output $title
} catch {
  Write-Output ("Error: " + $_.Exception.Message)
  if ($_.Exception.Response) {
    Write-Output ("StatusCode: " + [int]$_.Exception.Response.StatusCode)
    $cf = $_.Exception.Response.Headers['Cf-Mitigated']
    if ($cf) { Write-Output ("Cf-Mitigated: " + $cf) }
  }
}
