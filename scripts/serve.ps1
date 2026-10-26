param([int]$Port = 8080, [switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mime = @{
    '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
    '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'
    '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.woff' = 'font/woff'; '.woff2' = 'font/woff2'
    '.wasm' = 'application/wasm'; '.glb' = 'model/gltf-binary'; '.gltf' = 'model/gltf+json'
    '.bin' = 'application/octet-stream'; '.mp3' = 'audio/mpeg'; '.ogg' = 'audio/ogg'
    '.wav' = 'audio/wav'; '.mp4' = 'video/mp4'; '.webm' = 'video/webm'
}

function Send-Response($stream, [int]$status, [byte[]]$body, [string]$type, [bool]$headOnly) {
    $reason = @{ 200 = 'OK'; 400 = 'Bad Request'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 431 = 'Request Header Fields Too Large'; 500 = 'Internal Server Error' }
    $header = "HTTP/1.1 $status $($reason[$status])`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: same-origin`r`n"
    if ($status -eq 405) { $header += "Allow: GET, HEAD`r`n" }
    $header += "`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if (-not $headOnly) { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
}

function Send-Text($stream, [int]$status, [string]$message, [bool]$headOnly) {
    Send-Response $stream $status ([System.Text.Encoding]::UTF8.GetBytes($message)) 'text/plain; charset=utf-8' $headOnly
}

function Get-StaticFile([string]$target) {
    # Decode before validating; dots, backslashes, drive names and ADS are never public paths.
    $pathname = [System.Uri]::UnescapeDataString(($target -split '\?', 2)[0])
    if (-not $pathname.StartsWith('/') -or $pathname -match '[\\:\x00]' -or $pathname -match '%(?![0-9a-fA-F]{2})') { return $null }
    if ($pathname -eq '/') { $relative = 'index.html' } else { $relative = $pathname.Substring(1) }
    $parts = $relative -split '/'
    if (@($parts | Where-Object { $_.StartsWith('.') }).Count -gt 0) { return $null }
    if ($relative -notin @('index.html', 'styles.css') -and $relative -notmatch '^(src|vendor|assets)/') { return $null }
    $extension = [System.IO.Path]::GetExtension($relative).ToLowerInvariant()
    if (-not $mime.ContainsKey($extension)) { return $null }
    $file = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $file.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
    $walk = $root
    foreach ($part in $parts) {
        $walk = Join-Path $walk $part
        if (-not (Test-Path -LiteralPath $walk)) { return $null }
        $item = Get-Item -LiteralPath $walk -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $null }
    }
    if (-not [System.IO.File]::Exists($file)) { return $null }
    return @{ Path = $file; Type = $mime[$extension] }
}

if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }
$listener = $null
for ($candidate = $Port; $candidate -le [Math]::Min($Port + 99, 65535); $candidate++) {
    $attempt = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
    try {
        $attempt.Start()
        $listener = $attempt
        $Port = $candidate
        break
    } catch {
        $attempt.Stop()
        $cause = $_.Exception
        while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
        if ($cause -isnot [System.Net.Sockets.SocketException] -or $cause.SocketErrorCode -ne [System.Net.Sockets.SocketError]::AddressAlreadyInUse) { throw }
    }
}
if ($null -eq $listener) { throw 'No free local port was found. Close an old Miniroom window and try again.' }

$url = "http://127.0.0.1:$Port/"
Write-Host "Miniroom is ready.`nLocal: $url`nKeep this window open. Close it or press Ctrl+C to stop."
if (-not $NoOpen) {
    try { Start-Process $url } catch { Write-Host "Open $url in your browser." }
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $stream = $null
        $headOnly = $false
        try {
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 15000
            # Browsers may preconnect without sending a request; do not block the asset queue.
            if (-not $client.Client.Poll(500000, [System.Net.Sockets.SelectMode]::SelectRead) -or $client.Available -eq 0) {
                continue
            }
            $stream = $client.GetStream()
            $stream.ReadTimeout = 5000
            $stream.WriteTimeout = 15000
            $buffer = New-Object byte[] 1024
            $header = New-Object System.Text.StringBuilder
            while ($header.ToString().IndexOf("`r`n`r`n") -lt 0 -and $header.Length -le 16384) {
                $count = $stream.Read($buffer, 0, $buffer.Length)
                if ($count -eq 0) { break }
                [void]$header.Append([System.Text.Encoding]::ASCII.GetString($buffer, 0, $count))
            }
            if ($header.Length -gt 16384) {
                Send-Text $stream 431 'Request headers are too large.' $false
                continue
            }
            $requestLine = ($header.ToString() -split "`r`n", 2)[0]
            if ($requestLine -notmatch '^(GET|HEAD|POST|PUT|DELETE|PATCH|OPTIONS|CONNECT|TRACE) ([^ ]+) HTTP/1\.[01]$') {
                Send-Text $stream 400 'Invalid HTTP request.' $false
                continue
            }
            $method = $Matches[1]
            $target = $Matches[2]
            $headOnly = $method -eq 'HEAD'
            if ($method -notin @('GET', 'HEAD')) {
                Send-Text $stream 405 'Method not allowed.' $headOnly
                continue
            }
            $staticFile = Get-StaticFile $target
            if ($null -eq $staticFile) {
                Send-Text $stream 404 'Not found.' $headOnly
                continue
            }
            $content = [System.IO.File]::ReadAllBytes($staticFile.Path)
            Send-Response $stream 200 $content $staticFile.Type $headOnly
        } catch {
            if ($null -ne $stream -and $stream.CanWrite) {
                try { Send-Text $stream 500 'Unable to read this file.' $headOnly } catch { }
            }
        } finally {
            if ($null -ne $stream) { $stream.Dispose() }
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
