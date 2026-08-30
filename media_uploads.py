"""Media upload routes for voice messages, video notes, and transcription."""
from fastapi import Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
import os
import uuid
import aiofiles

from database import get_db
from models import User, Chat, ChatMember, Message


def register_media_uploads(
    app,
    manager,
    get_current_user,
    assert_can_send_to_chat,
    VOICE_DIR,
    IMAGE_DIR,
    VIDEO_NOTE_DIR,
    GROUP_AVATAR_DIR,
    serialize_message_fn=None,
    encrypt_text=None,
):
    def _serialize(msg, sender_name=""):
        if serialize_message_fn:
            try:
                data = serialize_message_fn(msg, "delivered")
                data["chat_id"] = msg.chat_id
                return data
            except Exception:
                pass
        return {
            "id": msg.id,
            "chat_id": msg.chat_id,
            "sender_id": msg.sender_id,
            "sender_name": sender_name,
            "content": msg.content or "",
            "message_type": msg.message_type,
            "media_url": msg.media_url,
            "is_encrypted": False,
            "is_pinned": bool(getattr(msg, "is_pinned", False)),
            "transcript": getattr(msg, "transcript", None),
            "created_at": msg.created_at.isoformat() if msg.created_at else None,
            "read_status": "delivered",
        }

    async def _check_chat_access(db, chat_id, user):
        member = (
            db.query(ChatMember)
            .filter(ChatMember.chat_id == chat_id, ChatMember.user_id == user.id)
            .first()
        )
        if not member:
            raise HTTPException(status_code=403, detail="Нет доступа к этому чату")
        chat = db.query(Chat).filter(Chat.id == chat_id).first()
        if not chat:
            raise HTTPException(status_code=404, detail="Чат не найден")
        assert_can_send_to_chat(db, chat, user.id)
        if getattr(chat, "is_channel", False) and chat.created_by != user.id:
            raise HTTPException(
                status_code=403, detail="В канале писать может только администратор"
            )
        return chat

    @app.post("/upload/voice")
    async def upload_voice(
        chat_id: int = Form(...),
        duration: str = Form("0"),
        file: UploadFile = File(...),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        await _check_chat_access(db, chat_id, current_user)
        content = await file.read()
        if not content or len(content) < 50:
            raise HTTPException(status_code=400, detail="Пустой или слишком короткий файл")
        if len(content) > 12 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Файл слишком большой (макс 12 МБ)")

        ct = (file.content_type or "").lower()
        filename_in = (file.filename or "voice.webm").lower()
        if "ogg" in ct or filename_in.endswith(".ogg"):
            ext = "ogg"
        elif "mp4" in ct or "m4a" in ct or filename_in.endswith(".m4a"):
            ext = "m4a"
        elif "mpeg" in ct or "mp3" in ct or filename_in.endswith(".mp3"):
            ext = "mp3"
        elif "wav" in ct or filename_in.endswith(".wav"):
            ext = "wav"
        else:
            ext = "webm"

        os.makedirs(VOICE_DIR, exist_ok=True)
        fname = f"{current_user.id}_{uuid.uuid4().hex[:14]}.{ext}"
        path = os.path.join(VOICE_DIR, fname)
        async with aiofiles.open(path, "wb") as f:
            await f.write(content)

        media_url = f"/uploads/voices/{fname}"
        dur = str(duration or "0")[:20]
        msg = Message(
            chat_id=chat_id,
            sender_id=current_user.id,
            content=dur,
            message_type="voice",
            media_url=media_url,
            is_encrypted=False,
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)

        payload = _serialize(msg, current_user.username)
        payload["type"] = "new_message"
        await manager.send_to_chat(chat_id, payload)
        return payload

    @app.post("/upload/video_note")
    async def upload_video_note(
        chat_id: int = Form(...),
        duration: str = Form("1"),
        file: UploadFile = File(...),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        await _check_chat_access(db, chat_id, current_user)
        content = await file.read()
        if not content or len(content) < 100:
            raise HTTPException(status_code=400, detail="Пустой или слишком короткий файл")
        if len(content) > 25 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Файл слишком большой (макс 25 МБ)")

        os.makedirs(VIDEO_NOTE_DIR, exist_ok=True)
        fname = f"{current_user.id}_{uuid.uuid4().hex[:14]}.webm"
        path = os.path.join(VIDEO_NOTE_DIR, fname)
        async with aiofiles.open(path, "wb") as f:
            await f.write(content)

        media_url = f"/uploads/video_notes/{fname}"
        dur = str(duration or "1")[:20]
        msg = Message(
            chat_id=chat_id,
            sender_id=current_user.id,
            content=dur,
            message_type="video_note",
            media_url=media_url,
            is_encrypted=False,
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)

        payload = _serialize(msg, current_user.username)
        payload["type"] = "new_message"
        await manager.send_to_chat(chat_id, payload)
        return payload

    @app.post("/upload/image")
    async def upload_image(
        chat_id: int = Form(...),
        file: UploadFile = File(...),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        await _check_chat_access(db, chat_id, current_user)
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Только изображения")
        content = await file.read()
        if len(content) > 8 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Файл слишком большой (макс 8 МБ)")

        ct = file.content_type or ""
        if "png" in ct:
            ext = "png"
        elif "webp" in ct:
            ext = "webp"
        elif "gif" in ct:
            ext = "gif"
        else:
            ext = "jpg"

        os.makedirs(IMAGE_DIR, exist_ok=True)
        fname = f"{current_user.id}_{uuid.uuid4().hex[:14]}.{ext}"
        path = os.path.join(IMAGE_DIR, fname)
        async with aiofiles.open(path, "wb") as f:
            await f.write(content)

        media_url = f"/uploads/images/{fname}"
        msg = Message(
            chat_id=chat_id,
            sender_id=current_user.id,
            content="",
            message_type="image",
            media_url=media_url,
            is_encrypted=False,
        )
        db.add(msg)
        db.commit()
        db.refresh(msg)

        payload = _serialize(msg, current_user.username)
        payload["type"] = "new_message"
        await manager.send_to_chat(chat_id, payload)
        return payload

    @app.post("/messages/{message_id}/transcribe")
    async def transcribe_voice(
        message_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        """VIP voice transcription. Uses OpenAI Whisper if OPENAI_API_KEY is set, else demo text."""
        user = db.query(User).filter(User.id == current_user.id).first()
        if not user or not getattr(user, "is_vip", False):
            raise HTTPException(status_code=403, detail="Расшифровка доступна только Cipherion VIP")

        msg = db.query(Message).filter(Message.id == message_id).first()
        if not msg:
            raise HTTPException(status_code=404, detail="Сообщение не найдено")
        if msg.message_type != "voice":
            raise HTTPException(status_code=400, detail="Можно расшифровать только голосовое")

        member = (
            db.query(ChatMember)
            .filter(ChatMember.chat_id == msg.chat_id, ChatMember.user_id == current_user.id)
            .first()
        )
        if not member:
            raise HTTPException(status_code=403, detail="Нет доступа")

        if msg.transcript:
            return {"ok": True, "transcript": msg.transcript, "cached": True}

        transcript = None
        api_key = os.getenv("OPENAI_API_KEY") or os.getenv("WHISPER_API_KEY")
        media_path = None
        if msg.media_url:
            # /uploads/voices/filename
            rel = msg.media_url.lstrip("/")
            if os.path.isfile(rel):
                media_path = rel

        if api_key and media_path:
            try:
                import urllib.request
                import json as _json

                boundary = "----CipherionBoundary" + uuid.uuid4().hex[:8]
                with open(media_path, "rb") as f:
                    audio_bytes = f.read()
                fname = os.path.basename(media_path)
                body = (
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="model"\r\n\r\n'
                    f"whisper-1\r\n"
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="language"\r\n\r\n'
                    f"ru\r\n"
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="file"; filename="{fname}"\r\n'
                    f"Content-Type: application/octet-stream\r\n\r\n"
                ).encode() + audio_bytes + f"\r\n--{boundary}--\r\n".encode()

                req = urllib.request.Request(
                    "https://api.openai.com/v1/audio/transcriptions",
                    data=body,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": f"multipart/form-data; boundary={boundary}",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = _json.loads(resp.read().decode())
                    transcript = (data.get("text") or "").strip()
            except Exception as exc:
                transcript = None

        if not transcript:
            dur = msg.content or "?"
            transcript = (
                f"🎤 Голосовое сообщение (~{dur} сек). "
                f"Текст распознан в демо-режиме. "
                f"Для точной расшифровки задайте OPENAI_API_KEY на сервере."
            )

        msg.transcript = transcript[:2000]
        db.commit()
        db.refresh(msg)

        try:
            await manager.send_to_chat(
                msg.chat_id,
                {
                    "type": "voice_transcribed",
                    "chat_id": msg.chat_id,
                    "message_id": msg.id,
                    "transcript": msg.transcript,
                },
            )
        except Exception:
            pass

        return {"ok": True, "transcript": msg.transcript, "cached": False}
