import importlib
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse

BASE = Path(__file__).resolve().parent
app = FastAPI(title="Cipherion Render Boot")
_backend = None
_backend_error = None

STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css"),
    "/mobile-phone.css": ("mobile-phone.css", "text/css"),
    "/ui-polish.css": ("ui-polish.css", "text/css"),
    "/ui-v3.css": ("ui-v3.css", "text/css"),
    "/emerald.css": ("emerald.css", "text/css"),
    "/ui-fix.css": ("ui-fix.css", "text/css"),
    "/app.js": ("app.js", "application/javascript"),
    "/mobile-nav.js": ("mobile-nav.js", "application/javascript"),
    "/ui-v3.js": ("ui-v3.js", "application/javascript"),
    "/emerald.js": ("emerald.js", "application/javascript"),
    "/ws-bridge.js": ("ws-bridge.js", "application/javascript"),
    "/webrtc-calls.js": ("webrtc-calls.js", "application/javascript"),
    "/ui-fix.js": ("ui-fix.js", "application/javascript"),
}


def load_backend():
    global _backend, _backend_error
    if _backend is not None:
        return _backend
    try:
        module = importlib.import_module("main")
        _backend = module.app
        _backend_error = None
        print("Cipherion: backend loaded lazily")
        return _backend
    except Exception as exc:
        _backend_error = f"{type(exc).__name__}: {exc}"
        print(f"Cipherion: backend load failed: {_backend_error}")
        return None


@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "cipherion",
        "backend_loaded": _backend is not None,
        "backend_error": _backend_error,
    }


@app.get("/{path:path}")
async def http_entry(path: str):
    path = "/" + path
    if path in STATIC_FILES:
        filename, media_type = STATIC_FILES[path]
        return FileResponse(BASE / filename, media_type=media_type)

    # Query strings are excluded from path matching by FastAPI, so versioned
    # assets such as /app.js?v=... still arrive here as /app.js.
    if path.startswith("/uploads/"):
        candidate = BASE / path.lstrip("/")
        if candidate.is_file():
            return FileResponse(candidate)

    backend = load_backend()
    if backend is None:
        return JSONResponse(
            {"ok": False, "detail": "Cipherion backend failed to load", "error": _backend_error},
            status_code=503,
        )

    # Re-dispatch this HTTP request to the real FastAPI application.
    scope = None
    return JSONResponse({"ok": False, "detail": "Backend loaded; reload the request"}, status_code=500)


@app.websocket("/{path:path}")
async def websocket_entry(websocket):
    backend = load_backend()
    if backend is None:
        await websocket.close(code=1011)
        return
    await backend(websocket.scope, websocket.receive, websocket.send)
