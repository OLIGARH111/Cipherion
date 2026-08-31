import importlib
import json
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse

BASE = Path(__file__).resolve().parent
app = FastAPI(title="Cipherion Render Boot")
_real_app = None
_import_error = None


def load_real_app():
    global _real_app, _import_error
    if _real_app is not None:
        return _real_app
    if _import_error is not None:
        return None
    try:
        module = importlib.import_module("main")
        _real_app = module.app
        return _real_app
    except Exception as exc:
        _import_error = f"{type(exc).__name__}: {exc}"
        print(f"Cipherion boot: main import failed: {_import_error}")
        return None


@app.get("/health")
async def health():
    return {"ok": True, "service": "cipherion", "backend_loaded": _real_app is not None, "backend_error": _import_error}


@app.get("/")
async def root():
    return FileResponse(BASE / "index.html")


@app.get("/{path:path}")
async def fallback_http(path: str):
    real = load_real_app()
    if real is not None:
        from starlette.requests import Request
        from starlette.types import Scope, Receive, Send
        # FastAPI routes are normally reached through ASGI, so this fallback is
        # intentionally limited to returning a useful diagnostic for HTTP paths.
        for route in real.routes:
            if getattr(route, "path", None) == "/" + path and not getattr(route, "methods", None):
                return JSONResponse({"detail": "WebSocket route; use WebSocket"}, status_code=400)
        return JSONResponse({"detail": "Backend loaded; reload the page"})
    return JSONResponse({"ok": False, "detail": "Cipherion backend failed to load", "error": _import_error}, status_code=503)


@app.middleware("http")
async def delegate_to_real_app(request, call_next):
    if request.url.path in ("/", "/health"):
        return await call_next(request)
    real = load_real_app()
    if real is None:
        return JSONResponse({"ok": False, "detail": "Cipherion backend failed to load", "error": _import_error}, status_code=503)
    # Let the actual FastAPI application handle all non-bootstrap HTTP requests.
    sent = []
    response = await real(request.scope, request.receive, request._send)
    return response


@app.websocket("/{path:path}")
async def websocket_fallback(websocket):
    real = load_real_app()
    if real is None:
        await websocket.close(code=1011)
        return
    await real(websocket.scope, websocket.receive, websocket.send)
