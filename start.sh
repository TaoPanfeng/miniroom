#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
if command -v node >/dev/null 2>&1; then
  exec node scripts/serve.mjs --open
fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 - <<'PY'
import http.server
import pathlib
import socketserver
import urllib.parse
import webbrowser

ROOT = pathlib.Path.cwd().resolve()
TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
    '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
}

def allowed(relative):
    return (bool(relative.parts) and not any(part.startswith('.') for part in relative.parts)
            and (str(relative) in ('index.html', 'styles.css')
                 or relative.parts[0] in ('src', 'vendor', 'assets'))
            and relative.suffix.lower() in TYPES)

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.serve(False)

    def do_HEAD(self):
        self.serve(True)

    def serve(self, head):
        try:
            raw = urllib.parse.unquote(self.path.split('?')[0], errors='strict')
            if not raw.startswith('/') or any(c in raw for c in ('\\', '\0', ':')):
                self.send_error(400)
                return
            relative = pathlib.PurePosixPath('index.html' if raw == '/' else raw[1:])
            if not allowed(relative) or any(part.startswith('.') for part in raw.split('/') if part):
                self.send_error(404)
                return
            file = (ROOT / relative).resolve()
            actual = file.relative_to(ROOT)
            if not allowed(actual) or not file.is_file():
                self.send_error(404)
                return
            data = file.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', TYPES[file.suffix.lower()])
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            if not head:
                self.wfile.write(data)
        except (ValueError, UnicodeError):
            self.send_error(400)
        except (FileNotFoundError, PermissionError, IsADirectoryError):
            self.send_error(404)

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address

for port in range(8080, 8180):
    try:
        server = Server(('127.0.0.1', port), Handler)
        break
    except OSError as error:
        if error.errno not in (48, 98, 10048):
            raise
else:
    raise SystemExit('No free local port was found. Close an old Miniroom window and try again.')
url = f'http://127.0.0.1:{port}/'
print(f'Miniroom is ready.\nLocal: {url}\nKeep this window open. Press Ctrl+C to stop.', flush=True)
try:
    webbrowser.open(url)
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
fi
printf '%s\n' 'Miniroom needs Node.js or Python 3 on macOS/Linux.' 'Install one, then run: sh start.sh'
exit 1
