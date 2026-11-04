# Servidor simples (sem instalar nada) para abrir a versao HTML em http://localhost:8080
$ErrorActionPreference = 'Stop'
$raiz = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $raiz.EndsWith([IO.Path]::DirectorySeparatorChar)) { $raiz += [IO.Path]::DirectorySeparatorChar }
$tipos = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.svg' = 'image/svg+xml'; '.json' = 'application/json' }

$ouvinte = $null
foreach ($porta in 8080..8089) {
  try {
    $ouvinte = New-Object System.Net.HttpListener
    $ouvinte.Prefixes.Add("http://localhost:$porta/")
    $ouvinte.Start()
    break
  } catch { $ouvinte = $null }
}
if (-not $ouvinte) { Write-Host 'Nao consegui abrir nenhuma porta entre 8080 e 8089.'; exit 1 }

$url = "http://localhost:$porta/"
Write-Host ''
Write-Host '=============================================='
Write-Host '  CLAVICULARIO DIGITAL (versao HTML)'
Write-Host "  Abra: $url"
Write-Host "  Monitor: ${url}claviculario.html#monitor"
Write-Host '  NAO FECHE ESTA JANELA enquanto estiver usando.'
Write-Host '=============================================='
Start-Process $url

while ($ouvinte.IsListening) {
  $ctx = $ouvinte.GetContext()
  $resp = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'claviculario.html' }
    $arq = [IO.Path]::GetFullPath((Join-Path $raiz $rel))
    if ($arq.StartsWith($raiz) -and (Test-Path -LiteralPath $arq -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($arq)
      $ext = [IO.Path]::GetExtension($arq).ToLower()
      $resp.ContentType = if ($tipos.ContainsKey($ext)) { $tipos[$ext] } else { 'application/octet-stream' }
      $resp.Headers.Add('Cache-Control', 'no-cache')
      $resp.ContentLength64 = $bytes.Length
      $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $resp.StatusCode = 404
      $msg = [Text.Encoding]::UTF8.GetBytes('Nao encontrado')
      $resp.OutputStream.Write($msg, 0, $msg.Length)
    }
  } catch { } finally { $resp.Close() }
}
