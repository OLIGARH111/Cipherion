from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status, UploadFile, File, Form, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from typing import Dict, List, Optional
from pydantic import BaseModel
import json
import os
import uuid
import aiofiles

from database import init_db, get_db, SessionLocal
from models import User, Chat, ChatMember, Message, Story, StoryReaction, StoryReply, StoryView, Blacklist, DeviceSession
from crypto_utils import init_crypto, encrypt_text, decrypt_text
import random
import string

phone_codes: Dict[str, str] = {}

SECRET_KEY = os.getenv("CIPHERION_SECRET_KEY", "change-this-secret-before-public-deploy")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

init_crypto(SECRET_KEY)

VOICE_DIR = "uploads/voices"
AVATAR_DIR = "uploads/avatars"
IMAGE_DIR = "uploads/images"
GROUP_AVATAR_DIR = "uploads/groups"
STORY_DIR = "uploads/stories"
VIDEO_NOTE_DIR = "uploads/video_notes"
os.makedirs(VOICE_DIR, exist_ok=True)
os.makedirs(AVATAR_DIR, exist_ok=True)
os.makedirs(IMAGE_DIR, exist_ok=True)
os.makedirs(GROUP_AVATAR_DIR, exist_ok=True)
os.makedirs(STORY_DIR, exist_ok=True)
os.makedirs(VIDEO_NOTE_DIR, exist_ok=True)

VIP_STICKER_SET = {
    "👑", "💎", "🥂", "🍾", "🤑", "🎩", "💍", "🏎️", "💰", "🏛️",
    "🔮", "🪄", "🧿", "💠", "🥇", "🏅", "🟣", "🌌", "🦄", "🐉"
}

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token", auto_error=False)

app = FastAPI(title="Cipherion")

def verify_password(plain, hashed):
    return pwd_context.verify(plain, hashed)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_user_by_username(db: Session, username: str):
    return db.query(User).filter(User.username == username).first()

def authenticate_user(db: Session, username: str, password: str):
    user = get_user_by_username(db, username)
    if not user or not verify_password(password, user.password_hash):
        return False
    return user

async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось проверить учётные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )
    raw_token = token or request.cookies.get("cipherion_access_token")
    if not raw_token:
        raise credentials_exception
    try:
        payload = jwt.decode(raw_token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = get_user_by_username(db, username)
    if user is None:
        raise credentials_exception
    return user

def get_user_from_token(token: Optional[str], db: Session) -> Optional[User]:
    if not token:
        return None
    try:
        username = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM]).get("sub")
    except JWTError:
        return None
    return get_user_by_username(db, username) if username else None

def users_are_contacts(db: Session, first_id: int, second_id: int) -> bool:
    if first_id == second_id:
        return True
    shared = db.query(ChatMember.chat_id).filter(ChatMember.user_id == first_id).subquery()
    return db.query(ChatMember).join(Chat).filter(
        ChatMember.user_id == second_id,
        ChatMember.chat_id.in_(shared),
        Chat.is_group == False,
        Chat.is_channel == False,
        Chat.is_favorites == False,
    ).first() is not None

def is_blocked_between(db: Session, first_id: int, second_id: int) -> bool:
    return db.query(Blacklist).filter(
        ((Blacklist.user_id == first_id) & (Blacklist.blocked_user_id == second_id)) |
        ((Blacklist.user_id == second_id) & (Blacklist.blocked_user_id == first_id))
    ).first() is not None

def can_view_private_field(db: Session, owner: User, viewer: User, field: str) -> bool:
    if owner.id == viewer.id:
        return True
    if is_blocked_between(db, owner.id, viewer.id):
        return False
    setting = getattr(owner, f"privacy_{field}", "contacts") or "contacts"
    if setting == "all":
        return True
    if setting == "contacts":
        return users_are_contacts(db, owner.id, viewer.id)
    return False

def private_profile_payload(db: Session, owner: User, viewer: User) -> dict:
    visible = lambda field: can_view_private_field(db, owner, viewer, field)
    avatar = owner.avatar_url if visible("avatar") else None
    return {
        "id": owner.id,
        "username": owner.username,
        "handle": owner.handle,
        "avatar_url": avatar,
        "phone": owner.phone if visible("phone") else None,
        "email": owner.email if visible("email") else None,
        "bio": owner.bio if visible("bio") else None,
        "birthday": owner.birthday if visible("bio") else None,
        "is_online": manager.is_online(owner.id) if visible("online") else False,
        "last_seen": owner.last_seen.isoformat() if owner.last_seen and visible("online") else None,
        "is_vip": bool(getattr(owner, "is_vip", False)),
        "emoji_status": getattr(owner, "emoji_status", None),
    }

def assert_can_send_to_chat(db: Session, chat: Chat, sender_id: int) -> None:
    if chat and not chat.is_group and not getattr(chat, "is_channel", False) and not getattr(chat, "is_favorites", False):
        other = db.query(ChatMember).filter(ChatMember.chat_id == chat.id, ChatMember.user_id != sender_id).first()
        if other and is_blocked_between(db, sender_id, other.user_id):
            raise HTTPException(status_code=403, detail="Нельзя отправлять сообщения заблокированному пользователю")

def assert_can_invite(db: Session, inviter: User, target: User) -> None:
    if is_blocked_between(db, inviter.id, target.id) or not can_view_private_field(db, target, inviter, "invite"):
        raise HTTPException(status_code=403, detail="Этот пользователь запретил приглашения в группы")

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
    def is_online(self, user_id: int) -> bool:
        return user_id in self.active_connections
    async def connect(self, user_id: int, websocket: WebSocket):
        old = self.active_connections.get(user_id)
        if old is not None and old is not websocket:
            try:
                await old.close(code=4000)
            except Exception:
                pass
        await websocket.accept()
        self.active_connections[user_id] = websocket
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.is_online = True
                user.last_seen = datetime.utcnow()
                db.commit()
        finally:
            db.close()
        await self.broadcast_user_status(user_id, True)
    async def disconnect(self, user_id: int, websocket: WebSocket = None):
        current = self.active_connections.get(user_id)
        if websocket is not None and current is not None and current is not websocket:
            return
        if user_id in self.active_connections:
            if websocket is None or self.active_connections.get(user_id) is websocket:
                del self.active_connections[user_id]
        if user_id in self.active_connections:
            return
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.is_online = False
                user.last_seen = datetime.utcnow()
                db.commit()
        finally:
            db.close()
        await self.broadcast_user_status(user_id, False)
    async def send_personal(self, user_id: int, message: dict):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except Exception:
                pass
    async def broadcast_user_status(self, user_id: int, is_online: bool):
        db = SessionLocal()
        owner = db.query(User).filter(User.id == user_id).first()
        dead = []
        for uid, ws in list(self.active_connections.items()):
            if uid == user_id:
                continue
            try:
                viewer = db.query(User).filter(User.id == uid).first()
                visible = bool(owner and viewer and can_view_private_field(db, owner, viewer, "online"))
                await ws.send_json({
                    "type": "user_status",
                    "user_id": user_id,
                    "is_online": bool(is_online and visible)
                })
            except Exception:
                dead.append(uid)
        db.close()
        for uid in dead:
            self.active_connections.pop(uid, None)
    async def send_to_chat(self, chat_id: int, message: dict, exclude_user: int = None):
        db = SessionLocal()
        members = db.query(ChatMember).filter(ChatMember.chat_id == chat_id).all()
        member_ids = [m.user_id for m in members]
        db.close()
        for uid in member_ids:
            if uid != exclude_user and uid in self.active_connections:
                try:
                    await self.active_connections[uid].send_json(message)
                except Exception:
                    pass

manager = ConnectionManager()

@app.on_event("startup")
def startup():
    init_db()

@app.get("/health")
async def health():
    return {"ok": True, "service": "cipherion"}

@app.get("/")
async def root():
    return FileResponse("index.html")

@app.get("/style.css")
async def serve_style_css():
    return FileResponse("style.css", media_type="text/css")

@app.get("/mobile-phone.css")
async def serve_mobile_phone_css():
    return FileResponse("mobile-phone.css", media_type="text/css")

@app.get("/ui-polish.css")
async def serve_ui_polish_css():
    return FileResponse("ui-polish.css", media_type="text/css")

@app.get("/app.js")
async def serve_app_js():
    return FileResponse("app.js", media_type="application/javascript")

@app.get("/mobile-nav.js")
async def serve_mobile_nav_js():
    return FileResponse("mobile-nav.js", media_type="application/javascript")

@app.post("/auth/send-code")
async def send_phone_code(phone: str = Form(...)):
    phone_clean = (phone or "").strip()
    if len(phone_clean) < 10:
        raise HTTPException(status_code=400, detail="Некорректный номер")
    code = "".join(random.choices(string.digits, k=6))
    phone_codes[phone_clean] = code
    return {"ok": True, "demo_code": code, "message": "Код отправлен (демо-режим)"}

import main_api  # noqa: E402
main_api.mount(app, manager, get_current_user, get_user_from_token, get_user_by_username,
               authenticate_user, create_access_token, get_password_hash, verify_password,
               private_profile_payload, can_view_private_field, assert_can_send_to_chat,
               assert_can_invite, is_blocked_between, users_are_contacts,
               SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES,
               VOICE_DIR, AVATAR_DIR, IMAGE_DIR, GROUP_AVATAR_DIR, STORY_DIR, VIDEO_NOTE_DIR,
               VIP_STICKER_SET, phone_codes, encrypt_text, decrypt_text)

# Voice / video note / image uploads
from media_uploads import register_media_uploads  # noqa: E402
register_media_uploads(
    app,
    manager,
    get_current_user,
    assert_can_send_to_chat,
    VOICE_DIR,
    IMAGE_DIR,
    VIDEO_NOTE_DIR,
    GROUP_AVATAR_DIR,
)
