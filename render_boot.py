import importlib
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response

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
    return FileResponse(BASE / "index.html", media_type=MEDIA[".html"])


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
