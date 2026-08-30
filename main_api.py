"""Cipherion API routes — restored companion module for main.py"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status, UploadFile, File, Form, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from jose import JWTError, jwt
from typing import Dict, List, Optional
from pydantic import BaseModel
import json
import os
import uuid
import aiofiles

from database import get_db, SessionLocal
from models import User, Chat, ChatMember, Message, Story, StoryReaction, StoryReply, StoryView, Blacklist, DeviceSession


def mount(app, manager, get_current_user, get_user_from_token, get_user_by_username,
          authenticate_user, create_access_token, get_password_hash, verify_password,
          private_profile_payload, can_view_private_field, assert_can_send_to_chat,
          assert_can_invite, is_blocked_between, users_are_contacts,
          SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES,
          VOICE_DIR, AVATAR_DIR, IMAGE_DIR, GROUP_AVATAR_DIR, STORY_DIR, VIDEO_NOTE_DIR,
          VIP_STICKER_SET, phone_codes, encrypt_text, decrypt_text):

    def serialize_message(m: Message, read_status: str = "sent") -> dict:
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
        if msg.sender_id != current_user_id:
            return "none"
        others = db.query(ChatMember).filter(
            ChatMember.chat_id == msg.chat_id,
            ChatMember.user_id != current_user_id
        ).all()
        if not others:
            return "read"
        for o in others:
            last = o.last_read_message_id or 0
            if last >= msg.id:
                return "read"
        return "delivered"

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

    class ProfileUpdate(BaseModel):
        phone: Optional[str] = None
        email: Optional[str] = None
        bio: Optional[str] = None
        birthday: Optional[str] = None
        emoji_status: Optional[str] = None
        handle: Optional[str] = None

    @app.patch("/me")
    async def update_me(body: ProfileUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
            "id": user.id, "username": user.username, "handle": user.handle,
            "avatar_url": user.avatar_url, "phone": user.phone, "email": user.email,
            "bio": user.bio, "birthday": user.birthday,
            "is_vip": bool(user.is_vip), "emoji_status": user.emoji_status
        }

    @app.post("/vip/activate")
    async def activate_vip(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        user = db.query(User).filter(User.id == current_user.id).first()
        user.is_vip = True
        db.commit()
        return {"is_vip": True, "message": "Cipherion VIP активирован"}

    @app.post("/vip/deactivate")
    async def deactivate_vip(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        user = db.query(User).filter(User.id == current_user.id).first()
        user.is_vip = False
        db.commit()
        return {"is_vip": False, "message": "VIP отключён"}

    @app.get("/users")
    async def get_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        users = db.query(User).filter(User.id != current_user.id).all()
        return [private_profile_payload(db, u, current_user) for u in users]

    @app.get("/users/{user_id}/profile")
    async def get_user_profile(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        return private_profile_payload(db, user, current_user)

    @app.post("/upload/avatar")
    async def upload_avatar(file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Только изображения")
        ext = "jpg"
        ct = file.content_type or ""
        if "png" in ct: ext = "png"
        elif "webp" in ct: ext = "webp"
        elif "gif" in ct: ext = "gif"
        filename = f"{current_user.id}_{uuid.uuid4().hex[:12]}.{ext}"
        filepath = os.path.join(AVATAR_DIR, filename)
        content = await file.read()
        if len(content) > 3 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Файл слишком большой (макс 3 МБ)")
        async with aiofiles.open(filepath, "wb") as f:
            await f.write(content)
        if current_user.avatar_url:
            old_path = current_user.avatar_url.lstrip("/")
            if os.path.exists(old_path) and old_path.startswith("uploads/avatars/"):
                try: os.remove(old_path)
                except Exception: pass
        avatar_url = f"/uploads/avatars/{filename}"
        user = db.query(User).filter(User.id == current_user.id).first()
        user.avatar_url = avatar_url
        db.commit()
        return {"avatar_url": avatar_url}

    @app.get("/uploads/{category}/{filename}")
    async def get_upload(category: str, filename: str, request: Request, db: Session = Depends(get_db)):
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
            raise HTTPException(status_code=404, detail="Файл не найден")
        return FileResponse(path, headers={"Cache-Control": "private, no-store"})

    @app.get("/chats")
    async def get_chats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        memberships = db.query(ChatMember).filter(ChatMember.user_id == current_user.id).all()
        result = []
        for m in memberships:
            chat = m.chat
            last_msg = db.query(Message).filter(Message.chat_id == chat.id).order_by(Message.created_at.desc()).first()
            chat_name = chat.name
            if getattr(chat, "is_favorites", False):
                chat_name = "⭐ Избранное"
            elif not chat.is_group and not getattr(chat, "is_channel", False):
                other = db.query(ChatMember).filter(ChatMember.chat_id == chat.id, ChatMember.user_id != current_user.id).first()
                if other:
                    chat_name = other.user.username
            last_text = None
            if last_msg:
                if last_msg.message_type == "voice": last_text = "🎤 Голосовое сообщение"
                elif last_msg.message_type == "image": last_text = "📷 Фото"
                elif last_msg.message_type == "video_note": last_text = "🔵 Видеосообщение"
                elif last_msg.message_type == "sticker": last_text = decrypt_text(last_msg.content) if last_msg.content else "Стикер"
                else: last_text = decrypt_text(last_msg.content) if last_msg.content else None
            other_avatar = None
            if not chat.is_group and not getattr(chat, "is_channel", False):
                other = db.query(ChatMember).filter(ChatMember.chat_id == chat.id, ChatMember.user_id != current_user.id).first()
                if other and can_view_private_field(db, other.user, current_user, "avatar"):
                    other_avatar = other.user.avatar_url
            is_channel = bool(getattr(chat, "is_channel", False))
            is_favorites = bool(getattr(chat, "is_favorites", False))
            result.append({
                "id": chat.id, "name": chat_name or "Чат",
                "is_group": chat.is_group, "is_channel": is_channel, "is_favorites": is_favorites,
                "avatar_url": chat.avatar_url if (chat.is_group or is_channel) else other_avatar,
                "created_by": chat.created_by, "description": getattr(chat, "description", None),
                "last_message": last_text,
                "last_message_time": last_msg.created_at.isoformat() if last_msg else None
            })
        result.sort(key=lambda x: x["last_message_time"] or "", reverse=True)
        return result

    @app.post("/chats/private/{user_id}")
    async def create_private_chat(user_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        if user_id == current_user.id:
            raise HTTPException(status_code=400, detail="Нельзя создать чат с собой")
        target = db.query(User).filter(User.id == user_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        if is_blocked_between(db, current_user.id, target.id):
            raise HTTPException(status_code=403, detail="Нельзя начать чат с заблокированным пользователем")
        my_chats = db.query(ChatMember.chat_id).filter(ChatMember.user_id == current_user.id).subquery()
        existing = db.query(ChatMember).filter(
            ChatMember.user_id == user_id, ChatMember.chat_id.in_(my_chats)
        ).join(Chat).filter(Chat.is_group == False).first()
        if existing:
            return {"chat_id": existing.chat_id}
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
    async def create_group_chat(body: GroupCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
        for uid in set(body.user_ids + [current_user.id]):
            db.add(ChatMember(chat_id=chat.id, user_id=uid))
        db.commit()
        return {"chat_id": chat.id, "name": body.name}

    class ChannelCreate(BaseModel):
        name: str
        description: Optional[str] = None

    @app.post("/chats/favorites")
    async def get_or_create_favorites(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        existing = db.query(Chat).filter(Chat.is_favorites == True, Chat.created_by == current_user.id).first()
        if existing:
            member = db.query(ChatMember).filter(ChatMember.chat_id == existing.id, ChatMember.user_id == current_user.id).first()
            if not member:
                db.add(ChatMember(chat_id=existing.id, user_id=current_user.id))
                db.commit()
            return {"chat_id": existing.id, "name": "⭐ Избранное", "is_favorites": True}
        chat = Chat(name="⭐ Избранное", is_group=False, is_channel=False, is_favorites=True,
                    created_by=current_user.id, description="Сохранённые сообщения. Только для вас.")
        db.add(chat)
        db.commit()
        db.refresh(chat)
        db.add(ChatMember(chat_id=chat.id, user_id=current_user.id))
        db.commit()
        return {"chat_id": chat.id, "name": "⭐ Избранное", "is_favorites": True}

    @app.post("/chats/channel")
    async def create_channel(body: ChannelCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        if not body.name.strip():
            raise HTTPException(status_code=400, detail="Название канала обязательно")
        chat = Chat(name=body.name.strip(), is_group=False, is_channel=True,
                    description=(body.description or "").strip()[:500] or None, created_by=current_user.id)
        db.add(chat)
        db.commit()
        db.refresh(chat)
        db.add(ChatMember(chat_id=chat.id, user_id=current_user.id))
        db.commit()
        return {"chat_id": chat.id, "name": chat.name, "is_channel": True, "description": chat.description}

    @app.post("/messages")
    async def send_message(chat_id: int = Form(...), content: str = Form(...),
                           current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        text = (content or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="Сообщение не может быть пустым")
        text = text[:4000]
        member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
        if not member:
            raise HTTPException(status_code=403, detail="Нет доступа к этому чату")
        chat = db.query(Chat).filter(Chat.id == chat_id).first()
        if not chat:
            raise HTTPException(status_code=404, detail="Чат не найден")
        assert_can_send_to_chat(db, chat, current_user.id)
        if chat.is_channel and chat.created_by != current_user.id:
            raise HTTPException(status_code=403, detail="В канале писать может только администратор")
        msg = Message(chat_id=chat_id, sender_id=current_user.id, content=encrypt_text(text),
                      message_type="text", is_encrypted=True)
        db.add(msg)
        db.commit()
        db.refresh(msg)
        response = serialize_message(msg, "delivered")
        await manager.send_to_chat(chat_id, {"type": "new_message", **response})
        return response

    @app.get("/chats/{chat_id}/messages")
    async def get_messages(chat_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
        if not member:
            raise HTTPException(status_code=403, detail="Нет доступа")
        messages = db.query(Message).filter(Message.chat_id == chat_id, Message.is_deleted == False).order_by(Message.created_at.asc()).limit(300).all()
        result = []
        for m in messages:
            st = compute_read_status(db, m, current_user.id)
            item = serialize_message(m, st)
            if m.sender and can_view_private_field(db, m.sender, current_user, "avatar"):
                item["sender_avatar"] = m.sender.avatar_url
            result.append(item)
        return result

    @app.post("/messages/{message_id}/delete")
    async def delete_message(message_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        msg = db.query(Message).filter(Message.id == message_id).first()
        if not msg:
            raise HTTPException(status_code=404, detail="Сообщение не найдено")
        member = db.query(ChatMember).filter(ChatMember.chat_id == msg.chat_id, ChatMember.user_id == current_user.id).first()
        if not member:
            raise HTTPException(status_code=403, detail="Нет доступа")
        chat = db.query(Chat).filter(Chat.id == msg.chat_id).first()
        is_admin = chat and (chat.created_by == current_user.id or getattr(member, "is_admin", False))
        if msg.sender_id != current_user.id and not is_admin:
            raise HTTPException(status_code=403, detail="Можно удалить только своё сообщение")
        msg.is_deleted = True
        msg.content = encrypt_text("")
        db.commit()
        await manager.send_to_chat(msg.chat_id, {"type": "message_deleted", "chat_id": msg.chat_id, "message_id": msg.id})
        return {"ok": True}

    @app.post("/messages/{message_id}/pin")
    async def pin_message(message_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        msg = db.query(Message).filter(Message.id == message_id).first()
        if not msg:
            raise HTTPException(status_code=404, detail="Сообщение не найдено")
        member = db.query(ChatMember).filter(ChatMember.chat_id == msg.chat_id, ChatMember.user_id == current_user.id).first()
        if not member:
            raise HTTPException(status_code=403, detail="Нет доступа")
        msg.is_pinned = not bool(msg.is_pinned)
        db.commit()
        await manager.send_to_chat(msg.chat_id, {"type": "message_pinned", "chat_id": msg.chat_id, "message_id": msg.id, "is_pinned": msg.is_pinned})
        return {"ok": True, "is_pinned": msg.is_pinned}

    @app.post("/chats/{chat_id}/read")
    async def mark_chat_read(chat_id: int, last_message_id: int = Form(...),
                             current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id).first()
        if not member:
            raise HTTPException(status_code=403, detail="Нет доступа")
        prev = member.last_read_message_id or 0
        if last_message_id > prev:
            member.last_read_message_id = last_message_id
            db.commit()
        await manager.send_to_chat(chat_id, {
            "type": "messages_read", "chat_id": chat_id,
            "user_id": current_user.id, "last_message_id": last_message_id
        }, exclude_user=current_user.id)
        return {"ok": True, "last_read_message_id": member.last_read_message_id}

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
                    member = db.query(ChatMember).filter(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id).first()
                    if not member:
                        db.close()
                        continue
                    if msg_type == "sticker" and content in VIP_STICKER_SET:
                        user_row = db.query(User).filter(User.id == user_id).first()
                        if not user_row or not getattr(user_row, "is_vip", False):
                            db.close()
                            try:
                                await websocket.send_json({"type": "error", "detail": "Этот стикер доступен только Cipherion VIP"})
                            except Exception:
                                pass
                            continue
                    chat = db.query(Chat).filter(Chat.id == chat_id).first()
                    if chat and getattr(chat, "is_channel", False) and chat.created_by != user_id:
                        db.close()
                        try:
                            await websocket.send_json({"type": "error", "detail": "В канале писать может только администратор"})
                        except Exception:
                            pass
                        continue
                    try:
                        assert_can_send_to_chat(db, chat, user_id)
                    except HTTPException as exc:
                        db.close()
                        await websocket.send_json({"type": "error", "detail": exc.detail})
                        continue
                    msg = Message(chat_id=chat_id, sender_id=user_id, content=encrypt_text(content),
                                  message_type=msg_type, is_encrypted=True)
                    db.add(msg)
                    db.commit()
                    db.refresh(msg)
                    response = {
                        "type": "new_message", "id": msg.id, "chat_id": chat_id,
                        "sender_id": user_id, "sender_name": username_cached,
                        "content": content, "message_type": msg_type,
                        "media_url": None, "is_encrypted": True,
                        "created_at": msg.created_at.isoformat()
                    }
                    db.close()
                    await manager.send_to_chat(chat_id, response)
        except WebSocketDisconnect:
            await manager.disconnect(user_id, websocket)
        except Exception:
            await manager.disconnect(user_id, websocket)
