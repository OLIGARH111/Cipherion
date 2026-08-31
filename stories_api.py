"""Stories API for Cipherion"""
from datetime import datetime, timedelta
from typing import Optional
import os
import uuid

from fastapi import Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
import aiofiles

from database import get_db
from models import User, Story, StoryView, StoryReaction, StoryReply


def register_stories(app, get_current_user, STORY_DIR: str):
    def story_payload(s: Story, viewer: User, db: Session) -> dict:
        views = db.query(StoryView).filter(StoryView.story_id == s.id).count()
        reactions = db.query(StoryReaction).filter(StoryReaction.story_id == s.id).all()
        react_list = []
        for r in reactions:
            u = db.query(User).filter(User.id == r.user_id).first()
            react_list.append({
                "user_id": r.user_id,
                "username": u.username if u else "",
                "emoji": r.emoji,
            })
        return {
            "id": s.id,
            "user_id": s.user_id,
            "content": s.content,
            "media_url": s.media_url,
            "font_style": s.font_style,
            "sticker": s.sticker,
            "text_x": s.text_x or 50,
            "text_y": s.text_y or 70,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "view_count": views,
            "reaction_count": len(react_list),
            "reactions": react_list,
        }

    @app.get("/stories")
    async def list_stories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        now = datetime.utcnow()
        stories = (
            db.query(Story)
            .filter(Story.expires_at > now)
            .order_by(Story.created_at.desc())
            .limit(200)
            .all()
        )
        groups = {}
        for s in stories:
            uid = s.user_id
            if uid not in groups:
                u = db.query(User).filter(User.id == uid).first()
                groups[uid] = {
                    "user_id": uid,
                    "username": u.username if u else "",
                    "avatar_url": u.avatar_url if u else None,
                    "stories": [],
                }
            groups[uid]["stories"].append(story_payload(s, current_user, db))
        # own stories first, then others by latest
        result = list(groups.values())
        result.sort(
            key=lambda g: (
                0 if g["user_id"] == current_user.id else 1,
                -(max((s.get("created_at") or "") for s in g["stories"]) if g["stories"] else ""),
            )
        )
        return result

    @app.post("/stories")
    async def create_story(
        content: Optional[str] = Form(None),
        font_style: Optional[str] = Form("default"),
        sticker: Optional[str] = Form(None),
        text_x: Optional[str] = Form("50"),
        text_y: Optional[str] = Form("70"),
        file: Optional[UploadFile] = File(None),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        user = db.query(User).filter(User.id == current_user.id).first()
        if not user or not getattr(user, "is_vip", False):
            raise HTTPException(status_code=403, detail="Истории доступны только Cipherion VIP")
        text = (content or "").strip()[:500] or None
        media_url = None
        if file and file.filename:
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
            name = f"{current_user.id}_{uuid.uuid4().hex[:12]}.{ext}"
            path = os.path.join(STORY_DIR, name)
            data = await file.read()
            if len(data) > 5 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="Файл слишком большой")
            async with aiofiles.open(path, "wb") as f:
                await f.write(data)
            media_url = f"/uploads/stories/{name}"
        if not text and not media_url and not (sticker or "").strip():
            raise HTTPException(status_code=400, detail="Добавьте текст, фото или стикер")
        try:
            tx = int(float(text_x or 50))
            ty = int(float(text_y or 70))
        except Exception:
            tx, ty = 50, 70
        s = Story(
            user_id=current_user.id,
            content=text,
            media_url=media_url,
            font_style=(font_style or "default")[:40],
            sticker=(sticker or "").strip()[:16] or None,
            text_x=max(0, min(100, tx)),
            text_y=max(0, min(100, ty)),
            expires_at=datetime.utcnow() + timedelta(hours=24),
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        return story_payload(s, current_user, db)

    @app.post("/stories/{story_id}/view")
    async def view_story(story_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        s = db.query(Story).filter(Story.id == story_id, Story.expires_at > datetime.utcnow()).first()
        if not s:
            raise HTTPException(status_code=404, detail="История не найдена")
        if s.user_id == current_user.id:
            return {"ok": True}
        exists = db.query(StoryView).filter(StoryView.story_id == story_id, StoryView.user_id == current_user.id).first()
        if not exists:
            db.add(StoryView(story_id=story_id, user_id=current_user.id))
            db.commit()
        return {"ok": True}

    @app.post("/stories/{story_id}/react")
    async def react_story(
        story_id: int,
        emoji: str = Form(...),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        s = db.query(Story).filter(Story.id == story_id, Story.expires_at > datetime.utcnow()).first()
        if not s:
            raise HTTPException(status_code=404, detail="История не найдена")
        em = (emoji or "")[:16]
        if not em:
            raise HTTPException(status_code=400, detail="Нужен emoji")
        old = db.query(StoryReaction).filter(
            StoryReaction.story_id == story_id, StoryReaction.user_id == current_user.id
        ).first()
        if old:
            old.emoji = em
        else:
            db.add(StoryReaction(story_id=story_id, user_id=current_user.id, emoji=em))
        db.commit()
        return {"ok": True}

    @app.post("/stories/{story_id}/reply")
    async def reply_story(
        story_id: int,
        content: str = Form(...),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        s = db.query(Story).filter(Story.id == story_id, Story.expires_at > datetime.utcnow()).first()
        if not s:
            raise HTTPException(status_code=404, detail="История не найдена")
        text = (content or "").strip()[:500]
        if not text:
            raise HTTPException(status_code=400, detail="Пустой ответ")
        db.add(StoryReply(story_id=story_id, user_id=current_user.id, content=text))
        db.commit()
        return {"ok": True}

    @app.get("/stories/{story_id}/insights")
    async def story_insights(story_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        s = db.query(Story).filter(Story.id == story_id).first()
        if not s:
            raise HTTPException(status_code=404, detail="Не найдено")
        if s.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Только владелец")
        views = db.query(StoryView).filter(StoryView.story_id == story_id).all()
        reacts = db.query(StoryReaction).filter(StoryReaction.story_id == story_id).all()
        vlist = []
        for v in views:
            u = db.query(User).filter(User.id == v.user_id).first()
            vlist.append({"user_id": v.user_id, "username": u.username if u else ""})
        rlist = []
        for r in reacts:
            u = db.query(User).filter(User.id == r.user_id).first()
            rlist.append({"user_id": r.user_id, "username": u.username if u else "", "emoji": r.emoji})
        return {"views": vlist, "reactions": rlist}
