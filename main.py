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

# ==================== НАСТРОЙКИ ====================
SECRET_KEY = os.getenv("CIPHERION_SECRET_KEY", "change-this-secret-before-public-deploy")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 дней

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

# Uploads are deliberately *not* mounted as a public StaticFiles directory.
# Every file is served by ``get_upload`` below, which authenticates the request
# and checks the viewer's access to the corresponding resource.

# ==================== УТИЛИТЫ ====================
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
    """Authenticate using Bearer token or the secure HttpOnly session cookie.

    The browser app primarily uses localStorage + Bearer, while the cookie is a
    resilient fallback after a refresh/tab restore. This also prevents a brief
    token race from turning a healthy session into a forced logout.
    """
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
    """Return a user for a bearer/cookie token without turning a bad token into 500."""
    if not token:
        return None
    try:
        username = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM]).get("sub")
    except JWTError:
        return None
    return get_user_by_username(db, username) if username else None


def users_are_contacts(db: Session, first_id: int, second_id: int) -> bool:
    """This app has no contact table; a mutual private chat is its contact relation."""
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
    """Apply privacy server-side; never rely on a client hiding a value."""
    if owner.id == viewer.id:
        return True
    if is_blocked_between(db, owner.id, viewer.id):
        return False
    setting = getattr(owner, f"privacy_{field}", "contacts") or "contacts"
    if setting == "all":
        return True
    if setting == "contacts":
        return users_are_contacts(db, owner.id, viewer.id)
    return False  # nobody and none


def private_profile_payload(db: Session, owner: User, viewer: User) -> dict:
    """The only representation of another user's private profile fields."""
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
    """A blacklist cannot be bypassed through an already-created private chat."""
    if chat and not chat.is_group and not getattr(chat, "is_channel", False) and not getattr(chat, "is_favorites", False):
        other = db.query(ChatMember).filter(ChatMember.chat_id == chat.id, ChatMember.user_id != sender_id).first()
        if other and is_blocked_between(db, sender_id, other.user_id):
            raise HTTPException(status_code=403, detail="Нельзя отправлять сообщения заблокированному пользователю")


def assert_can_invite(db: Session, inviter: User, target: User) -> None:
    if is_blocked_between(db, inviter.id, target.id) or not can_view_private_field(db, target, inviter, "invite"):
        raise HTTPException(status_code=403, detail="Этот пользователь запретил приглашения в группы")

# ==================== МЕНЕДЖЕР ПОДКЛЮЧЕНИЙ ====================
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
    
    def is_online(self, user_id: int) -> bool:
        return user_id in self.active_connections
    
    async def connect(self, user_id: int, websocket: WebSocket):
        # Если уже есть старое соединение — закрываем
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
        # Не снимаем онлайн, если это уже новое соединение
        current = self.active_connections.get(user_id)
        if websocket is not None and current is not None and current is not websocket:
            return
        
        if user_id in self.active_connections:
            if websocket is None or self.active_connections.get(user_id) is websocket:
                del self.active_connections[user_id]
        
        # Если пользователь снова онлайн (переподключился) — не ставим offline
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
                    # A hidden status is always reported as offline; the actual
                    # presence bit never leaves the server for this viewer.
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

# ==================== REST API ====================

@app.on_event("startup")
def startup():
    init_db()

@app.get("/health")
async def health():
    return {"ok": True, "service": "cipherion"}

@app.get("/")
async def root():
    return FileResponse("index.html")

@app.post("/auth/send-code")
async def send_phone_code(phone: str = Form(...)):
    phone_clean = (phone or "").strip()
    if len(phone_clean) < 10:
        raise HTTPException(status_code=400, detail="Некорректный номер")
    code = "".join(random.choices(string.digits, k=6))
    phone_codes[phone_clean] = code
    # Демо: код возвращается в ответе (в проде уходит SMS)
    return {"ok": True, "demo_code": code, "message": "Код отправлен (демо-режим)"}


@app.post("/register")
async def register(
    form: OAuth2PasswordRequestForm = Depends(),
    phone: str = Form(...),
    email: str = Form(...),
    phone_code: str = Form(...),
    db: Session = Depends(get_db)
):
    if len(form.username) < 3:
        raise HTTPException(status_code=400, detail="Имя пользователя слишком короткое")
    if len(form.password) < 4:
        raise HTTPException(status_code=400, detail="Пароль слишком короткий")
    
    phone_clean = (phone or "").strip()
    if len(phone_clean) < 10:
        raise HTTPException(status_code=400, detail="Укажите корректный номер телефона")
    
    email_clean = (email or "").strip()
    if "@" not in email_clean or len(email_clean) < 5:
        raise HTTPException(status_code=400, detail="Укажите корректную почту")
    
    expected = phone_codes.get(phone_clean)
    if not expected or expected != (phone_code or "").strip():
        raise HTTPException(status_code=400, detail="Неверный код подтверждения телефона")
    
    login = form.username.strip().lstrip("@")
    if get_user_by_username(db, login):
        raise HTTPException(status_code=400, detail="Пользователь уже существует")
    
    if db.query(User).filter(User.phone == phone_clean).first():
        raise HTTPException(status_code=400, detail="Этот номер уже зарегистрирован")
    if db.query(User).filter(User.email == email_clean).first():
        raise HTTPException(status_code=400, detail="Эта почта уже зарегистрирована")
    
    user = User(
        username=login,
        handle=login.lower(),
        phone=phone_clean,
        phone_verified=True,
        email=email_clean,
        password_hash=get_password_hash(form.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    phone_codes.pop(phone_clean, None)
    
    access_token = create_access_token(data={"sub": user.username})
    response = JSONResponse({
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "username": user.username,
        "handle": user.handle,
        "phone": user.phone,
        "email": user.email
    })
    response.set_cookie("cipherion_access_token", access_token, httponly=True, samesite="lax", max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    return response

@app.post("/token")
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    cloud_password: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    user = authenticate_user(db, form.username, form.password)
    if not user:
        raise HTTPException(status_code=400, detail="Неверный логин или пароль")
    if user.cloud_password_hash and not (cloud_password and verify_password(cloud_password, user.cloud_password_hash)):
        raise HTTPException(status_code=401, detail="Введите облачный пароль")
    
    access_token = create_access_token(data={"sub": user.username})
    response = JSONResponse({
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user.id,
        "username": user.username
    })
    response.set_cookie("cipherion_access_token", access_token, httponly=True, samesite="lax", max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    return response

def serialize_message(m: Message, read_status: str = "sent") -> dict:
    """Расшифровывает текст перед отдачей клиенту."""
    raw = m.content or ""
    msg_type = m.message_type or "text"
    if msg_type in ("text", "sticker"):
        plain = decrypt_text(raw)
    else:
        plain = decrypt_text(raw) if raw.startswith("enc:") else raw
    return {
        "id": m.id,
        "sender_id": m.sender_id,
        "sender_name": m.sender.username if m.sender else "",
        "sender_handle": getattr(m.sender, "handle", None) if m.sender else None,
        # A message must never bypass the avatar privacy rule. Callers that
        # know the viewer replace this with a permitted value below.
        "sender_avatar": None,
        "content": plain,
        "message_type": msg_type,
        "media_url": m.media_url,
        "is_encrypted": bool(getattr(m, "is_encrypted", True)),
        "transcript": m.transcript,
        "is_pinned": bool(getattr(m, "is_pinned", False)),
        "is_deleted": bool(getattr(m, "is_deleted", False)),
        "read_status": read_status,
        "created_at": m.created_at.isoformat() if m.created_at else None
    }


def compute_read_status(db: Session, msg: Message, current_user_id: int) -> str:
    """Статус просмотра для своих сообщений."""
    if msg.sender_id != current_user_id:
        return "none"
    others = db.query(ChatMember).filter(
        ChatMember.chat_id == msg.chat_id,
        ChatMember.user_id != current_user_id
    ).all()
    if not others:
        return "read"  # избранное / только я
    # Прочитано, если хотя бы один собеседник дочитал до этого сообщения
    for o in others:
        last = o.last_read_message_id or 0
        if last >= msg.id:
            return "read"
    return "delivered"


@app.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "avatar_url": current_user.avatar_url,
        "phone": current_user.phone,
        "email": current_user.email,
        "bio": current_user.bio,
        "birthday": current_user.birthday,
        "is_vip": bool(getattr(current_user, "is_vip", False)),
        "emoji_status": getattr(current_user, "emoji_status", None),
        "handle": getattr(current_user, "handle", None),
        "is_online": current_user.is_online
    }


@app.post("/vip/activate")
async def activate_vip(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == current_user.id).first()
    user.is_vip = True
    db.commit()
    return {"is_vip": True, "message": "Cipherion VIP активирован"}


@app.post("/vip/deactivate")
async def deactivate_vip(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == current_user.id).first()
    user.is_vip = False
    db.commit()
    return {"is_vip": False, "message": "VIP отключён"}


class ProfileUpdate(BaseModel):
    phone: Optional[str] = None
    email: Optional[str] = None
    bio: Optional[str] = None
    birthday: Optional[str] = None
    emoji_status: Optional[str] = None
    handle: Optional[str] = None


@app.patch("/me")
async def update_me(
    body: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == current_user.id).first()
    if body.phone is not None:
        phone = body.phone.strip()[:30] or None
        if phone and len(phone) < 10:
            raise HTTPException(status_code=400, detail="Укажите корректный номер телефона")
        if phone and db.query(User).filter(User.phone == phone, User.id != user.id).first():
            raise HTTPException(status_code=400, detail="Этот номер уже зарегистрирован")
        user.phone = phone
    if body.email is not None:
        email = body.email.strip()[:120] or None
        if email and ("@" not in email or len(email) < 5):
            raise HTTPException(status_code=400, detail="Укажите корректную почту")
        if email and db.query(User).filter(User.email == email, User.id != user.id).first():
            raise HTTPException(status_code=400, detail="Эта почта уже зарегистрирована")
        user.email = email
    if body.bio is not None:
        user.bio = body.bio.strip()[:300] or None
    if body.birthday is not None:
        user.birthday = body.birthday.strip()[:20] or None
    if body.emoji_status is not None:
        if not user.is_vip and body.emoji_status.strip():
            raise HTTPException(status_code=403, detail="Эмодзи-статус доступен только Cipherion VIP")
        user.emoji_status = body.emoji_status.strip()[:16] or None
    if body.handle is not None:
        handle = body.handle.strip().lstrip("@").lower()
        if handle:
            if len(handle) < 3:
                raise HTTPException(status_code=400, detail="Ник слишком короткий (мин. 3)")
            if not handle.replace("_", "").isalnum():
                raise HTTPException(status_code=400, detail="Ник: только латиница, цифры и _")
            taken = db.query(User).filter(User.handle == handle, User.id != user.id).first()
            if taken:
                raise HTTPException(status_code=400, detail="Этот @ник уже занят")
            user.handle = handle
        else:
            user.handle = None
    db.commit()
    db.refresh(user)
    return {
        "id": user.id,
        "username": user.username,
        "handle": user.handle,
        "avatar_url": user.avatar_url,
        "phone": user.phone,
        "email": user.email,
        "bio": user.bio,
        "birthday": user.birthday,
        "is_vip": bool(user.is_vip),
        "emoji_status": user.emoji_status
    }

@app.get("/users")
async def get_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    users = db.query(User).filter(User.id != current_user.id).all()
    return [
        private_profile_payload(db, u, current_user)
        for u in users
    ]


@app.get("/users/{user_id}/profile")
async def get_user_profile(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return private_profile_payload(db, user, current_user)

@app.post("/upload/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Только изображения")
    
    # Определяем расширение
    ext = "jpg"
    ct = file.content_type or ""
    if "png" in ct:
        ext = "png"
    elif "webp" in ct:
        ext = "webp"
    elif "gif" in ct:
        ext = "gif"
    
    filename = f"{current_user.id}_{uuid.uuid4().hex[:12]}.{ext}"
    filepath = os.path.join(AVATAR_DIR, filename)
    
    content = await file.read()
    if len(content) > 3 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс 3 МБ)")
    
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(content)
    
    # Удаляем старый аватар если был
    if current_user.avatar_url:
        old_path = current_user.avatar_url.lstrip("/")
        if os.path.exists(old_path) and old_path.startswith("uploads/avatars/"):
            try:
                os.remove(old_path)
            except Exception:
                pass
    
    avatar_url = f"/uploads/avatars/{filename}"
    
    # Обновляем в БД
    user = db.query(User).filter(User.id == current_user.id).first()
    user.avatar_url = avatar_url
    db.commit()
    
    return {"avatar_url": avatar_url}


@app.get("/uploads/{category}/{filename}")
async def get_upload(category: str, filename: str, request: Request, db: Session = Depends(get_db)):
    """Authenticated, authorization-checked file delivery.

    Browser image/video tags cannot send an Authorization header, so login and
    registration also set an HttpOnly same-site cookie. A copied direct URL has
    no authority by itself and is rejected.
    """
    if category not in {"avatars", "images", "voices", "video_notes", "groups", "stories"}:
        raise HTTPException(status_code=404, detail="Файл не найден")
    if os.path.basename(filename) != filename:
        raise HTTPException(status_code=404, detail="Файл не найден")
    authorization = request.headers.get("authorization", "")
    bearer = authorization[7:] if authorization.lower().startswith("bearer ") else None
    viewer = get_user_from_token(bearer or request.cookies.get("cipherion_access_token"), db)
    if not viewer:
        raise HTTPException(status_code=401, detail="Требуется авторизация")

    url = f"/uploads/{category}/{filename}"
    allowed = False
    if category == "avatars":
        owner = db.query(User).filter(User.avatar_url == url).first()
        allowed = bool(owner and can_view_private_field(db, owner, viewer, "avatar"))
    elif category in {"images", "voices", "video_notes"}:
        message = db.query(Message).filter(Message.media_url == url, Message.is_deleted == False).first()
        allowed = bool(message and db.query(ChatMember).filter(
            ChatMember.chat_id == message.chat_id, ChatMember.user_id == viewer.id
        ).first())
    elif category == "groups":
        chat = db.query(Chat).filter(Chat.avatar_url == url).first()
        allowed = bool(chat and db.query(ChatMember).filter(
            ChatMember.chat_id == chat.id, ChatMember.user_id == viewer.id
        ).first())
    elif category == "stories":
        story = db.query(Story).filter(Story.media_url == url, Story.expires_at > datetime.utcnow()).first()
        allowed = story is not None

    path = os.path.join("uploads", category, filename)
    if not allowed or not os.path.isfile(path):
        # Do not disclose whether a private file exists.
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(path, headers={"Cache-Control": "private, no-store"})

@app.get("/chats")
async def get_chats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memberships = db.query(ChatMember).filter(ChatMember.user_id == current_user.id).all()
    result = []
    
    for m in memberships:
        chat = m.chat
        last_msg = db.query(Message).filter(Message.chat_id == chat.id)\
            .order_by(Message.created_at.desc()).first()
        
        chat_name = chat.name
        if getattr(chat, "is_favorites", False):
            chat_name = "⭐ Избранное"
        elif not chat.is_group and not getattr(chat, "is_channel", False):
            other = db.query(ChatMember).filter(
                ChatMember.chat_id == chat.id,
                ChatMember.user_id != current_user.id
            ).first()
            if other:
                chat_name = other.user.username
        
        last_text = None
        if last_msg:
            if last_msg.message_type == "voice":
                last_text = "🎤 Голосовое сообщение"
            elif last_msg.message_type == "image":
                last_text = "📷 Фото"
            elif last_msg.message_type == "video_note":
                last_text = "🔵 Видеосообщение"
            elif last_msg.message_type == "sticker":
                last_text = decrypt_text(last_msg.content) if last_msg.content else "Стикер"
            else:
                last_text = decrypt_text(last_msg.content) if last_msg.content else None
        
        other_avatar = None
        if not chat.is_group and not getattr(chat, "is_channel", False):
            other = db.query(ChatMember).filter(
                ChatMember.chat_id == chat.id,
                ChatMember.user_id != current_user.id
            ).first()
            if other:
                if can_view_private_field(db, other.user, current_user, "avatar"):
                    other_avatar = other.user.avatar_url
        
        is_channel = bool(getattr(chat, "is_channel", False))
        is_favorites = bool(getattr(chat, "is_favorites", False))
        result.append({
            "id": chat.id,
            "name": chat_name or "Чат",
            "is_group": chat.is_group,
            "is_channel": is_channel,
            "is_favorites": is_favorites,
            "avatar_url": chat.avatar_url if (chat.is_group or is_channel) else other_avatar,
            "created_by": chat.created_by,
            "description": getattr(chat, "description", None),
            "last_message": last_text,
            "last_message_time": last_msg.created_at.isoformat() if last_msg else None
        })
    
    # Сортируем по времени последнего сообщения
    result.sort(key=lambda x: x["last_message_time"] or "", reverse=True)
    return result

@app.post("/chats/private/{user_id}")
async def create_private_chat(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя создать чат с собой")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if is_blocked_between(db, current_user.id, target.id):
        raise HTTPException(status_code=403, detail="Нельзя начать чат с заблокированным пользователем")
    
    # Проверяем, существует ли уже чат
    my_chats = db.query(ChatMember.chat_id).filter(ChatMember.user_id == current_user.id).subquery()
    existing = db.query(ChatMember).filter(
        ChatMember.user_id == user_id,
        ChatMember.chat_id.in_(my_chats)
    ).join(Chat).filter(Chat.is_group == False).first()
    
    if existing:
        return {"chat_id": existing.chat_id}
    
    # Создаём новый
    chat = Chat(is_group=False)
    db.add(chat)
    db.commit()
    db.refresh(chat)
    
    db.add(ChatMember(chat_id=chat.id, user_id=current_user.id))
    db.add(ChatMember(chat_id=chat.id, user_id=user_id))
    db.commit()
    
    return {"chat_id": chat.id}

class GroupCreate(BaseModel):
    name: str
    user_ids: List[int]

@app.post("/chats/group")
async def create_group_chat(
    body: GroupCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Название группы обязательно")
    targets = db.query(User).filter(User.id.in_(set(body.user_ids))).all()
    if len(targets) != len(set(body.user_ids)):
        raise HTTPException(status_code=404, detail="Один или несколько пользователей не найдены")
    for target in targets:
        if target.id != current_user.id:
            assert_can_invite(db, current_user, target)
    
    chat = Chat(name=body.name.strip(), is_group=True, is_channel=False, created_by=current_user.id)
    db.add(chat)
    db.commit()
    db.refresh(chat)
    
    members = set(body.user_ids + [current_user.id])
    for uid in members:
        db.add(ChatMember(chat_id=chat.id, user_id=uid))
    db.commit()
    
    return {"chat_id": chat.id, "name": body.name}


class ChannelCreate(BaseModel):
    name: str
    description: Optional[str] = None

@app.post("/chats/favorites")
async def get_or_create_favorites(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Личный чат «Избранное» — только для себя, никого добавить нельзя."""
    existing = db.query(Chat).filter(
        Chat.is_favorites == True,
        Chat.created_by == current_user.id
    ).first()
    
    if existing:
        # убедимся что пользователь в участниках
        member = db.query(ChatMember).filter(
            ChatMember.chat_id == existing.id,
            ChatMember.user_id == current_user.id
        ).first()
        if not member:
            db.add(ChatMember(chat_id=existing.id, user_id=current_user.id))
            db.commit()
        return {"chat_id": existing.id, "name": "⭐ Избранное", "is_favorites": True}
    
    chat = Chat(
        name="⭐ Избранное",
        is_group=False,
        is_channel=False,
        is_favorites=True,
        created_by=current_user.id,
        description="Сохранённые сообщения. Только для вас."
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)
    db.add(ChatMember(chat_id=chat.id, user_id=current_user.id))
    db.commit()
    
    return {"chat_id": chat.id, "name": "⭐ Избранное", "is_favorites": True}


@app.post("/chats/channel")
async def create_channel(
    body: ChannelCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Название канала обязательно")
    
    chat = Chat(
        name=body.name.strip(),
        is_group=False,
        is_channel=True,
        description=(body.description or "").strip()[:500] or None,
        created_by=current_user.id
    )
    db.add(chat)
    db.commit()
    db.refresh(chat)
    
    db.add(ChatMember(chat_id=chat.id, user_id=current_user.id))
    db.commit()
    
    return {
        "chat_id": chat.id,
        "name": chat.name,
        "is_channel": True,
        "description": chat.description
    }

@app.post("/messages")
async def send_message(
    chat_id: int = Form(...),
    content: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Надёжная REST-отправка текстового сообщения. WebSocket используется для доставки в реальном времени."""
    text = (content or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Сообщение не может быть пустым")
    text = text[:4000]

    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа к этому чату")

    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")
    assert_can_send_to_chat(db, chat, current_user.id)
    if chat.is_channel and chat.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="В канале писать может только администратор")

    msg = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        content=encrypt_text(text),
        message_type="text",
        is_encrypted=True
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    response = serialize_message(msg, "delivered")
    db.close()

    await manager.send_to_chat(chat_id, {
        "type": "new_message",
        **response
    })
    return response


@app.get("/chats/{chat_id}/messages")
async def get_messages(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа")
    
    messages = db.query(Message).filter(
        Message.chat_id == chat_id,
        Message.is_deleted == False
    ).order_by(Message.created_at.asc()).limit(300).all()
    
    result = []
    for m in messages:
        status = compute_read_status(db, m, current_user.id)
        item = serialize_message(m, status)
        if m.sender and can_view_private_field(db, m.sender, current_user, "avatar"):
            item["sender_avatar"] = m.sender.avatar_url
        result.append(item)
    return result


@app.post("/messages/{message_id}/delete")
async def delete_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == msg.chat_id, ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа")
    chat = db.query(Chat).filter(Chat.id == msg.chat_id).first()
    is_admin = chat and (chat.created_by == current_user.id or getattr(member, "is_admin", False))
    if msg.sender_id != current_user.id and not is_admin:
        raise HTTPException(status_code=403, detail="Можно удалить только своё сообщение")
    msg.is_deleted = True
    msg.content = encrypt_text("")
    db.commit()
    await manager.send_to_chat(msg.chat_id, {
        "type": "message_deleted",
        "chat_id": msg.chat_id,
        "message_id": msg.id
    })
    return {"ok": True}


@app.post("/messages/{message_id}/pin")
async def pin_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == msg.chat_id, ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа")
    msg.is_pinned = not bool(msg.is_pinned)
    db.commit()
    await manager.send_to_chat(msg.chat_id, {
        "type": "message_pinned",
        "chat_id": msg.chat_id,
        "message_id": msg.id,
        "is_pinned": msg.is_pinned
    })
    return {"ok": True, "is_pinned": msg.is_pinned}


@app.post("/chats/{chat_id}/read")
async def mark_chat_read(
    chat_id: int,
    last_message_id: int = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа")
    
    prev = member.last_read_message_id or 0
    if last_message_id > prev:
        member.last_read_message_id = last_message_id
        db.commit()
    
    # Уведомляем других участников, что сообщения прочитаны
    await manager.send_to_chat(chat_id, {
        "type": "messages_read",
        "chat_id": chat_id,
        "user_id": current_user.id,
        "last_message_id": last_message_id
    }, exclude_user=current_user.id)
    
    return {"ok": True, "last_read_message_id": member.last_read_message_id}


@app.post("/messages/{message_id}/transcribe")
async def transcribe_voice(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """VIP: расшифровка (транскрипция) голосового сообщения."""
    if not getattr(current_user, "is_vip", False):
        raise HTTPException(status_code=403, detail="Расшифровка голосовых доступна только Cipherion VIP")
    
    msg = db.query(Message).filter(Message.id == message_id).first()
    if not msg or msg.message_type != "voice":
        raise HTTPException(status_code=404, detail="Голосовое сообщение не найдено")
    
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == msg.chat_id,
        ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа")
    
    if msg.transcript:
        return {"transcript": msg.transcript, "cached": True}
    
    duration = decrypt_text(msg.content) if (msg.content or "").startswith("enc:") else (msg.content or "0")
    
    # Демо-расшифровка (структура готова под Whisper/STT API)
    transcript = (
        f"🎙 Расшифровка Cipherion VIP\n"
        f"Голосовое сообщение · ~{duration} сек.\n"
        f"Текст: содержимое защищено шифрованием на сервере. "
        f"Для полной AI-транскрипции речи подключите STT (Whisper) в настройках сервера."
    )
    
    msg.transcript = transcript
    db.commit()
    
    return {"transcript": transcript, "cached": False}


@app.post("/upload/voice")
async def upload_voice(
    chat_id: int = Form(...),
    duration: str = Form("0"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа")
    
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if chat and getattr(chat, "is_channel", False) and chat.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="В канале писать может только администратор")
    assert_can_send_to_chat(db, chat, current_user.id)
    
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс 5 МБ)")
    
    # Определяем расширение мягко — браузеры иногда шлют странный content-type
    ct = (file.content_type or "").lower()
    filename_hint = (file.filename or "").lower()
    ext = "webm"
    if "ogg" in ct or filename_hint.endswith(".ogg"):
        ext = "ogg"
    elif "mp4" in ct or "m4a" in ct or filename_hint.endswith(".m4a"):
        ext = "m4a"
    elif "mpeg" in ct or "mp3" in ct or filename_hint.endswith(".mp3"):
        ext = "mp3"
    elif "wav" in ct or filename_hint.endswith(".wav"):
        ext = "wav"
    
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(VOICE_DIR, filename)
    
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(content)
    
    media_url = f"/uploads/voices/{filename}"
    
    msg = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        content=encrypt_text(str(duration or "0")),
        message_type="voice",
        media_url=media_url,
        is_encrypted=True
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    
    response = {
        "type": "new_message",
        "id": msg.id,
        "chat_id": chat_id,
        "sender_id": current_user.id,
        "sender_name": current_user.username,
        "sender_avatar": current_user.avatar_url,
        "content": str(duration or "0"),
        "message_type": "voice",
        "media_url": media_url,
        "is_encrypted": True,
        "transcript": None,
        "created_at": msg.created_at.isoformat()
    }
    
    await manager.send_to_chat(chat_id, response)
    return response


@app.post("/upload/image")
async def upload_image(
    chat_id: int = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа")
    
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if chat and getattr(chat, "is_channel", False) and chat.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="В канале писать может только администратор")
    assert_can_send_to_chat(db, chat, current_user.id)
    
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Только изображения")
    
    ext = "jpg"
    ct = file.content_type or ""
    if "png" in ct:
        ext = "png"
    elif "webp" in ct:
        ext = "webp"
    elif "gif" in ct:
        ext = "gif"
    
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(IMAGE_DIR, filename)
    
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс 8 МБ)")
    
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(content)
    
    media_url = f"/uploads/images/{filename}"
    
    msg = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        content=encrypt_text("📷 Фото"),
        message_type="image",
        media_url=media_url,
        is_encrypted=True
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    
    response = {
        "type": "new_message",
        "id": msg.id,
        "chat_id": chat_id,
        "sender_id": current_user.id,
        "sender_name": current_user.username,
        "sender_avatar": current_user.avatar_url,
        "content": "📷 Фото",
        "message_type": "image",
        "media_url": media_url,
        "is_encrypted": True,
        "created_at": msg.created_at.isoformat()
    }
    
    await manager.send_to_chat(chat_id, response)
    return response


@app.post("/upload/video_note")
async def upload_video_note(
    chat_id: int = Form(...),
    duration: str = Form("0"),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Круглое видеосообщение (video note)."""
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа")
    
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if chat and getattr(chat, "is_channel", False) and chat.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="В канале писать может только администратор")
    assert_can_send_to_chat(db, chat, current_user.id)
    
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if len(content) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс 12 МБ)")
    
    ct = (file.content_type or "").lower()
    ext = "webm"
    if "mp4" in ct:
        ext = "mp4"
    elif "quicktime" in ct:
        ext = "mov"
    
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(VIDEO_NOTE_DIR, filename)
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(content)
    
    media_url = f"/uploads/video_notes/{filename}"
    msg = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        content=encrypt_text(str(duration or "0")),
        message_type="video_note",
        media_url=media_url,
        is_encrypted=True
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    
    response = {
        "type": "new_message",
        "id": msg.id,
        "chat_id": chat_id,
        "sender_id": current_user.id,
        "sender_name": current_user.username,
        "sender_avatar": current_user.avatar_url,
        "content": str(duration or "0"),
        "message_type": "video_note",
        "media_url": media_url,
        "is_encrypted": True,
        "created_at": msg.created_at.isoformat()
    }
    await manager.send_to_chat(chat_id, response)
    return response


@app.get("/chats/{chat_id}/info")
async def get_chat_info(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id,
        ChatMember.user_id == current_user.id
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Нет доступа")
    
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    members = db.query(ChatMember).filter(ChatMember.chat_id == chat_id).all()
    
    return {
        "id": chat.id,
        "name": chat.name,
        "is_group": chat.is_group,
        "is_channel": bool(chat.is_channel),
        "is_favorites": bool(getattr(chat, "is_favorites", False)),
        "description": chat.description,
        "avatar_url": chat.avatar_url,
        "created_by": chat.created_by,
        "is_admin": chat.created_by == current_user.id or any(
            m.user_id == current_user.id and getattr(m, "is_admin", False) for m in members
        ),
        "is_public": bool(getattr(chat, "is_public", False)),
        "allowed_reactions": getattr(chat, "allowed_reactions", None) or "👍,❤️,😂,😮,😢,🔥",
        "members": [
            {
                "id": m.user.id,
                "username": m.user.username,
                "avatar_url": m.user.avatar_url if can_view_private_field(db, m.user, current_user, "avatar") else None,
                "is_online": manager.is_online(m.user.id) if can_view_private_field(db, m.user, current_user, "online") else False,
                "is_admin": bool(getattr(m, "is_admin", False)) or (chat.created_by == m.user.id)
            }
            for m in members
        ]
    }


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None
    allowed_reactions: Optional[str] = None
    add_user_ids: List[int] = []
    admin_user_ids: List[int] = []


@app.patch("/chats/{chat_id}")
async def update_group(
    chat_id: int,
    body: GroupUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat or (not chat.is_group and not getattr(chat, "is_channel", False)):
        raise HTTPException(status_code=404, detail="Чат не найден")
    
    if getattr(chat, "is_favorites", False):
        raise HTTPException(status_code=403, detail="В Избранное никого добавить нельзя")
    
    member = db.query(ChatMember).filter(
        ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id
    ).first()
    is_admin = (chat.created_by == current_user.id) or (member and getattr(member, "is_admin", False))
    if not is_admin:
        raise HTTPException(status_code=403, detail="Только администратор")
    
    if body.name and body.name.strip():
        chat.name = body.name.strip()
    if body.description is not None:
        chat.description = (body.description or "")[:500] or None
    if body.is_public is not None:
        chat.is_public = bool(body.is_public)
    if body.allowed_reactions is not None:
        chat.allowed_reactions = (body.allowed_reactions or "👍,❤️,😂,😮,😢,🔥")[:200]
    
    existing_ids = {
        m.user_id for m in db.query(ChatMember).filter(ChatMember.chat_id == chat_id).all()
    }
    for uid in body.add_user_ids:
        if uid not in existing_ids:
            target = db.query(User).filter(User.id == uid).first()
            if not target:
                raise HTTPException(status_code=404, detail="Пользователь не найден")
            assert_can_invite(db, current_user, target)
            db.add(ChatMember(chat_id=chat_id, user_id=uid, is_admin=False))
    
    for uid in (body.admin_user_ids or []):
        m = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == uid).first()
        if m:
            m.is_admin = True
    
    db.commit()
    db.refresh(chat)
    
    return {
        "chat_id": chat.id,
        "name": chat.name,
        "description": chat.description,
        "is_public": bool(getattr(chat, "is_public", False)),
        "allowed_reactions": getattr(chat, "allowed_reactions", None),
        "avatar_url": chat.avatar_url
    }


@app.delete("/chats/{chat_id}")
async def delete_group(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat or not chat.is_group:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    if chat.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Только создатель может удалить группу")
    db.query(Message).filter(Message.chat_id == chat_id).delete()
    db.query(ChatMember).filter(ChatMember.chat_id == chat_id).delete()
    db.delete(chat)
    db.commit()
    return {"ok": True}


@app.post("/chats/{chat_id}/avatar")
async def upload_group_avatar(
    chat_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    chat = db.query(Chat).filter(Chat.id == chat_id).first()
    if not chat or (not chat.is_group and not getattr(chat, "is_channel", False)):
        raise HTTPException(status_code=404, detail="Чат не найден")
    
    if chat.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Только создатель может менять фото")
    
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Только изображения")
    
    ext = "jpg"
    ct = file.content_type or ""
    if "png" in ct:
        ext = "png"
    elif "webp" in ct:
        ext = "webp"
    
    filename = f"group_{chat_id}_{uuid.uuid4().hex[:10]}.{ext}"
    filepath = os.path.join(GROUP_AVATAR_DIR, filename)
    
    content = await file.read()
    if len(content) > 3 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс 3 МБ)")
    
    async with aiofiles.open(filepath, "wb") as f:
        await f.write(content)
    
    if chat.avatar_url:
        old = chat.avatar_url.lstrip("/")
        if os.path.exists(old) and old.startswith("uploads/groups/"):
            try:
                os.remove(old)
            except Exception:
                pass
    
    chat.avatar_url = f"/uploads/groups/{filename}"
    db.commit()
    
    return {"avatar_url": chat.avatar_url}

# ==================== STORIES (VIP) ====================

@app.get("/stories")
async def list_stories(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    now = datetime.utcnow()
    stories = db.query(Story).filter(Story.expires_at > now).order_by(Story.created_at.desc()).all()
    
    # Группируем по пользователю
    by_user = {}
    for s in stories:
        uid = s.user_id
        if uid not in by_user:
            by_user[uid] = {
                "user_id": uid,
                "username": s.user.username,
                "avatar_url": s.user.avatar_url,
                "emoji_status": getattr(s.user, "emoji_status", None),
                "is_vip": bool(getattr(s.user, "is_vip", False)),
                "stories": []
            }
        reactions = db.query(StoryReaction).filter(StoryReaction.story_id == s.id).all()
        reaction_users = []
        for r in reactions:
            ru = db.query(User).filter(User.id == r.user_id).first()
            reaction_users.append({
                "user_id": r.user_id,
                "username": ru.username if ru else "?",
                "emoji": r.emoji
            })
        views = db.query(StoryView).filter(StoryView.story_id == s.id).all()
        view_users = []
        for v in views:
            vu = db.query(User).filter(User.id == v.user_id).first()
            view_users.append({
                "user_id": v.user_id,
                "username": vu.username if vu else "?"
            })
        by_user[uid]["stories"].append({
            "id": s.id,
            "content": s.content,
            "media_url": s.media_url,
            "font_style": getattr(s, "font_style", None) or "default",
            "sticker": getattr(s, "sticker", None),
            "text_x": getattr(s, "text_x", None) or 50,
            "text_y": getattr(s, "text_y", None) or 70,
            "created_at": s.created_at.isoformat(),
            "reactions": reaction_users,
            "views": view_users if s.user_id == current_user.id else [],
            "view_count": len(views),
            "reaction_count": len(reactions)
        })
    
    return list(by_user.values())


@app.post("/stories/{story_id}/view")
async def view_story(
    story_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story or story.expires_at < datetime.utcnow():
        raise HTTPException(status_code=404, detail="История не найдена")
    if story.user_id == current_user.id:
        return {"ok": True, "own": True}
    existing = db.query(StoryView).filter(
        StoryView.story_id == story_id,
        StoryView.user_id == current_user.id
    ).first()
    if not existing:
        db.add(StoryView(story_id=story_id, user_id=current_user.id))
        db.commit()
    return {"ok": True}


@app.get("/stories/{story_id}/insights")
async def story_insights(
    story_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="История не найдена")
    if story.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Только владелец видит статистику")
    reactions = db.query(StoryReaction).filter(StoryReaction.story_id == story_id).all()
    views = db.query(StoryView).filter(StoryView.story_id == story_id).all()
    react_list = []
    for r in reactions:
        u = db.query(User).filter(User.id == r.user_id).first()
        react_list.append({"user_id": r.user_id, "username": u.username if u else "?", "emoji": r.emoji})
    view_list = []
    for v in views:
        u = db.query(User).filter(User.id == v.user_id).first()
        view_list.append({"user_id": v.user_id, "username": u.username if u else "?"})
    return {"reactions": react_list, "views": view_list}


@app.post("/stories")
async def create_story(
    content: str = Form(""),
    font_style: str = Form("default"),
    sticker: str = Form(""),
    text_x: str = Form("50"),
    text_y: str = Form("70"),
    file: UploadFile = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not getattr(current_user, "is_vip", False):
        raise HTTPException(status_code=403, detail="Истории доступны только Cipherion VIP")
    
    text = (content or "").strip()[:500]
    media_url = None
    stick = (sticker or "").strip()[:16] or None
    
    if file and file.filename:
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Только изображения")
        ext = "jpg"
        ct = file.content_type or ""
        if "png" in ct:
            ext = "png"
        elif "webp" in ct:
            ext = "webp"
        filename = f"{current_user.id}_{uuid.uuid4().hex[:10]}.{ext}"
        filepath = os.path.join(STORY_DIR, filename)
        data = await file.read()
        if len(data) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Файл слишком большой")
        async with aiofiles.open(filepath, "wb") as f:
            await f.write(data)
        media_url = f"/uploads/stories/{filename}"
    
    if not text and not media_url and not stick:
        raise HTTPException(status_code=400, detail="Добавьте текст, фото или стикер")
    
    try:
        tx = max(0, min(100, int(float(text_x or 50))))
        ty = max(0, min(100, int(float(text_y or 70))))
    except Exception:
        tx, ty = 50, 70
    
    story = Story(
        user_id=current_user.id,
        content=text or None,
        media_url=media_url,
        font_style=(font_style or "default")[:40],
        sticker=stick,
        text_x=tx,
        text_y=ty,
        expires_at=datetime.utcnow() + timedelta(hours=24)
    )
    db.add(story)
    db.commit()
    db.refresh(story)
    
    return {
        "id": story.id,
        "content": story.content,
        "media_url": story.media_url,
        "font_style": story.font_style,
        "sticker": story.sticker,
        "text_x": story.text_x,
        "text_y": story.text_y,
        "created_at": story.created_at.isoformat(),
        "expires_at": story.expires_at.isoformat()
    }


@app.post("/stories/{story_id}/react")
async def react_story(
    story_id: int,
    emoji: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story or story.expires_at < datetime.utcnow():
        raise HTTPException(status_code=404, detail="История не найдена")
    em = (emoji or "").strip()[:16]
    if not em:
        raise HTTPException(status_code=400, detail="Выберите реакцию")
    existing = db.query(StoryReaction).filter(
        StoryReaction.story_id == story_id,
        StoryReaction.user_id == current_user.id
    ).first()
    if existing:
        existing.emoji = em
    else:
        db.add(StoryReaction(story_id=story_id, user_id=current_user.id, emoji=em))
    db.commit()
    return {"ok": True, "emoji": em}


@app.post("/stories/{story_id}/reply")
async def reply_story(
    story_id: int,
    content: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story or story.expires_at < datetime.utcnow():
        raise HTTPException(status_code=404, detail="История не найдена")
    text = (content or "").strip()[:1000]
    if not text:
        raise HTTPException(status_code=400, detail="Введите сообщение")
    db.add(StoryReply(story_id=story_id, user_id=current_user.id, content=text))
    # Также отправим в личный чат с автором истории (если не себе)
    if story.user_id != current_user.id:
        # найти/создать private chat
        my_chats = db.query(ChatMember.chat_id).filter(ChatMember.user_id == current_user.id).subquery()
        existing = db.query(ChatMember).filter(
            ChatMember.user_id == story.user_id,
            ChatMember.chat_id.in_(my_chats)
        ).join(Chat).filter(Chat.is_group == False, Chat.is_channel == False, Chat.is_favorites == False).first()
        if existing:
            chat_id = existing.chat_id
        else:
            chat = Chat(is_group=False)
            db.add(chat)
            db.commit()
            db.refresh(chat)
            db.add(ChatMember(chat_id=chat.id, user_id=current_user.id))
            db.add(ChatMember(chat_id=chat.id, user_id=story.user_id))
            chat_id = chat.id
        msg = Message(
            chat_id=chat_id,
            sender_id=current_user.id,
            content=encrypt_text(f"↩️ Ответ на историю: {text}"),
            message_type="text",
            is_encrypted=True
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)
        await manager.send_to_chat(chat_id, {
            "type": "new_message",
            **serialize_message(msg),
            "chat_id": chat_id
        })
    else:
        db.commit()
    return {"ok": True}


class PrivacyUpdate(BaseModel):
    privacy_phone: Optional[str] = None
    privacy_email: Optional[str] = None
    privacy_online: Optional[str] = None
    privacy_avatar: Optional[str] = None
    privacy_bio: Optional[str] = None
    privacy_invite: Optional[str] = None
    cloud_password: Optional[str] = None
    passcode: Optional[str] = None


@app.patch("/privacy")
async def update_privacy(
    body: PrivacyUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == current_user.id).first()
    allowed = {"all", "contacts", "nobody", "none"}
    for field in ("privacy_phone", "privacy_email", "privacy_online", "privacy_avatar", "privacy_bio", "privacy_invite"):
        val = getattr(body, field, None)
        if val is not None:
            if val not in allowed:
                raise HTTPException(status_code=400, detail=f"Неверное значение {field}")
            setattr(user, field, val)
    if body.cloud_password is not None:
        if body.cloud_password and len(body.cloud_password) < 8:
            raise HTTPException(status_code=400, detail="Облачный пароль должен содержать не менее 8 символов")
        user.cloud_password_hash = get_password_hash(body.cloud_password) if body.cloud_password else None
    if body.passcode is not None:
        if body.passcode and (not body.passcode.isdigit() or len(body.passcode) not in (4, 5, 6)):
            raise HTTPException(status_code=400, detail="Код-пароль должен состоять из 4–6 цифр")
        user.passcode_hash = get_password_hash(body.passcode) if body.passcode else None
    db.commit()
    await manager.broadcast_user_status(user.id, manager.is_online(user.id))
    return {"ok": True}


@app.get("/privacy")
async def get_privacy(current_user: User = Depends(get_current_user)):
    return {
        "privacy_phone": getattr(current_user, "privacy_phone", "contacts"),
        "privacy_email": getattr(current_user, "privacy_email", "contacts"),
        "privacy_online": getattr(current_user, "privacy_online", "all"),
        "privacy_avatar": getattr(current_user, "privacy_avatar", "all"),
        "privacy_bio": getattr(current_user, "privacy_bio", "all"),
        "privacy_invite": getattr(current_user, "privacy_invite", "all"),
        "has_cloud_password": bool(getattr(current_user, "cloud_password_hash", None)),
        "has_passcode": bool(getattr(current_user, "passcode_hash", None))
    }


@app.get("/blacklist")
async def get_blacklist(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Blacklist).filter(Blacklist.user_id == current_user.id).all()
    result = []
    for r in rows:
        u = db.query(User).filter(User.id == r.blocked_user_id).first()
        if u:
            result.append({"id": u.id, "username": u.username})
    return result


@app.post("/blacklist/{user_id}")
async def add_blacklist(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя заблокировать себя")
    exists = db.query(Blacklist).filter(
        Blacklist.user_id == current_user.id, Blacklist.blocked_user_id == user_id
    ).first()
    if not exists:
        db.add(Blacklist(user_id=current_user.id, blocked_user_id=user_id))
        db.commit()
    return {"ok": True}


@app.delete("/blacklist/{user_id}")
async def remove_blacklist(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Blacklist).filter(
        Blacklist.user_id == current_user.id, Blacklist.blocked_user_id == user_id
    ).delete()
    db.commit()
    return {"ok": True}


@app.get("/sessions")
async def list_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(DeviceSession).filter(DeviceSession.user_id == current_user.id).order_by(DeviceSession.last_active.desc()).all()
    if not rows:
        return [{"id": 0, "device_name": "Этот браузер", "last_active": datetime.utcnow().isoformat(), "current": True}]
    return [
        {
            "id": r.id,
            "device_name": r.device_name,
            "last_active": r.last_active.isoformat() if r.last_active else None,
            "current": False
        }
        for r in rows
    ]


# ==================== WEBSOCKET ====================

@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            await websocket.close(code=4001)
            return
    except JWTError:
        await websocket.close(code=4001)
        return
    
    db = SessionLocal()
    user = get_user_by_username(db, username)
    if not user:
        db.close()
        await websocket.close(code=4001)
        return
    
    user_id = user.id
    username_cached = user.username
    db.close()
    
    await manager.connect(user_id, websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            if message_data.get("type") in ("message", "sticker"):
                chat_id = message_data.get("chat_id")
                content = (message_data.get("content") or "").strip()
                msg_type = "sticker" if message_data.get("type") == "sticker" else "text"
                
                if not content or not chat_id:
                    continue
                
                if msg_type == "sticker" and len(content) > 16:
                    continue
                if msg_type == "text" and len(content) > 4000:
                    content = content[:4000]
                
                db = SessionLocal()
                
                member = db.query(ChatMember).filter(
                    ChatMember.chat_id == chat_id,
                    ChatMember.user_id == user_id
                ).first()
                
                if not member:
                    db.close()
                    continue
                
                # VIP-стикеры — только для подписчиков
                if msg_type == "sticker" and content in VIP_STICKER_SET:
                    user_row = db.query(User).filter(User.id == user_id).first()
                    if not user_row or not getattr(user_row, "is_vip", False):
                        db.close()
                        try:
                            await websocket.send_json({
                                "type": "error",
                                "detail": "Этот стикер доступен только Cipherion VIP"
                            })
                        except Exception:
                            pass
                        continue
                
                chat = db.query(Chat).filter(Chat.id == chat_id).first()
                if chat and getattr(chat, "is_channel", False) and chat.created_by != user_id:
                    db.close()
                    try:
                        await websocket.send_json({
                            "type": "error",
                            "detail": "В канале писать может только администратор"
                        })
                    except Exception:
                        pass
                    continue
                try:
                    assert_can_send_to_chat(db, chat, user_id)
                except HTTPException as exc:
                    db.close()
                    await websocket.send_json({"type": "error", "detail": exc.detail})
                    continue
                
                msg = Message(
                    chat_id=chat_id,
                    sender_id=user_id,
                    content=encrypt_text(content),
                    message_type=msg_type,
                    is_encrypted=True
                )
                db.add(msg)
                db.commit()
                db.refresh(msg)
                
                response = {
                    "type": "new_message",
                    "id": msg.id,
                    "chat_id": chat_id,
                    "sender_id": user_id,
                    "sender_name": username_cached,
                    "content": content,
                    "message_type": msg_type,
                    "media_url": None,
                    "is_encrypted": True,
                    "created_at": msg.created_at.isoformat()
                }
                
                db.close()
                
                await manager.send_to_chat(chat_id, response)
                
    except WebSocketDisconnect:
        await manager.disconnect(user_id, websocket)
    except Exception:
        await manager.disconnect(user_id, websocket)
