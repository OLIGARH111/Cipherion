from pathlib import Path
import importlib

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse

BASE = Path(__file__).resolve().parent
app = FastAPI(title="Cipherion Render Boot")
backend_error = None

try:
    backend = importlib.import_module("main")
    real_app = backend.app
    app.mount("/", real_app)
    print("Cipherion: backend loaded")
except Exception as exc:
    real_app = None
    backend_error = f"{type(exc).__name__}: {exc}"
    print(f"Cipherion: backend failed to import: {backend_error}")

@app.get("/health")
async def health():
    if real_app is not None:
        return {"ok": True, "service": "cipherion", "backend_loaded": True}
    return JSONResponse(
        {"ok": False, "service": "cipherion", "backend_loaded": False, "error": backend_error},
        status_code=503,
    )

if real_app is None:
    @app.get("/")
    async def root_fallback():
        return FileResponse(BASE / "index.html")

    @app.get("/{path:path}")
    async def fallback(path: str):
        if path.endswith((".css", ".js")):
            candidate = BASE / path
            if candidate.is_file():
                return FileResponse(candidate)
        return JSONResponse({"detail": "Cipherion backend failed to start", "error": backend_error}, status_code=503)
