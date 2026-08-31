import importlib
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.responses import HTMLResponse

BASE = Path(__file__).resolve().parent
app = FastAPI(title="Cipherion")
_backend = None
_backend_error = None

MEDIA = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8", ".json": "application/json",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2",
}

BOOTSTRAP = r'''<script>
(() => {
  const style = document.createElement('style');
  style.textContent = `html,body{margin:0!important;width:100%!important;min-height:100%!important;background:#022c22!important}#auth-screen{display:flex!important;min-height:100vh;align-items:center;justify-content:center}#auth-screen.hidden{display:flex!important}.auth-box{display:block!important;visibility:visible!important;opacity:1!important}`;
  document.head.appendChild(style);
  window.addEventListener('error', e => {
    console.error('Cipherion JS error:', e.error || e.message);
    const box = document.getElementById('auth-screen');
    if (box && !box.querySelector('.boot-error')) {
      const p = document.createElement('p');
      p.className = 'boot-error';
      p.style.cssText = 'color:#fca5a5;text-align:center;margin-top:12px;font:14px system-ui;';
      p.textContent = 'Интерфейс загружен. Ошибка JavaScript: ' + (e.message || 'неизвестная ошибка');
      box.querySelector('.auth-box')?.appendChild(p);
    }
  });
})();
</script>'''


def load_backend():
    global _backend, _backend_error
    if _backend is not None:
        return _backend
    try:
        _backend = importlib.import_module("main").app
        _backend_error = None
        print("Cipherion: backend loaded")
    except Exception as exc:
        _backend_error = f"{type(exc).__name__}: {exc}"
        print(f"Cipherion: backend load failed: {_backend_error}")
    return _backend


def static_file(path: str):
    clean = path.lstrip("/") or "index.html"
    candidate = (BASE / clean).resolve()
    try:
        candidate.relative_to(BASE)
    except ValueError:
        return None
    if candidate.is_file() and candidate.suffix.lower() in MEDIA:
        return candidate
    return None


@app.get("/health")
async def health():
    return {"ok": True, "service": "cipherion", "backend_loaded": _backend is not None, "backend_error": _backend_error}


@app.get("/")
async def root():
    html = (BASE / "index.html").read_text(encoding="utf-8")
    if "Cipherion JS error" not in html:
        html = html.replace("</body>", BOOTSTRAP + "</body>")
    return HTMLResponse(html)


@app.middleware("http")
async def backend_middleware(request, call_next):
    path = request.url.path
    if path == "/" or path == "/health":
        return await call_next(request)
    asset = static_file(path)
    if asset is not None:
        return FileResponse(asset, media_type=MEDIA[asset.suffix.lower()])
    backend = load_backend()
    if backend is None:
        return JSONResponse({"ok": False, "detail": "Backend failed to load", "error": _backend_error}, status_code=503)
    messages = []
    async def send(message):
        messages.append(message)
    await backend(request.scope, request.receive, send)
    status = 500
    headers = []
    body = bytearray()
    for message in messages:
        if message["type"] == "http.response.start":
            status = message["status"]
            headers = message.get("headers", [])
        elif message["type"] == "http.response.body":
            body.extend(message.get("body", b""))
    return Response(content=bytes(body), status_code=status, headers={k.decode(): v.decode() for k, v in headers})


@app.get("/{path:path}")
async def fallback(path: str):
    asset = static_file(path)
    if asset is not None:
        return FileResponse(asset, media_type=MEDIA[asset.suffix.lower()])
    return JSONResponse({"ok": False, "detail": "Not found"}, status_code=404)


@app.websocket("/{path:path}")
async def websocket_entry(websocket):
    backend = load_backend()
    if backend is None:
        await websocket.close(code=1011)
        return
    await backend(websocket.scope, websocket.receive, websocket.send)
