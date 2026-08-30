"""Chat info / profile endpoint."""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models import User, Chat, ChatMember, Message


def register_chat_info(
    app,
    get_current_user,
    can_view_private_field,
    private_profile_payload,
):
    @app.get("/chats/{chat_id}/info")
    async def chat_info(
        chat_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        member = (
            db.query(ChatMember)
            .filter(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id)
            .first()
        )
        if not member:
            raise HTTPException(status_code=403, detail="Нет доступа")

        chat = db.query(Chat).filter(Chat.id == chat_id).first()
        if not chat:
            raise HTTPException(status_code=404, detail="Чат не найден")

        is_group = bool(chat.is_group)
        is_channel = bool(getattr(chat, "is_channel", False))
        is_favorites = bool(getattr(chat, "is_favorites", False))
        is_admin = bool(
            chat.created_by == current_user.id or getattr(member, "is_admin", False)
        )

        members = (
            db.query(ChatMember).filter(ChatMember.chat_id == chat_id).all()
        )
        member_list = []
        for m in members:
            u = m.user
            if not u:
                continue
            av = u.avatar_url if can_view_private_field(db, u, current_user, "avatar") else None
            member_list.append(
                {
                    "id": u.id,
                    "username": u.username,
                    "handle": getattr(u, "handle", None),
                    "avatar_url": av,
                    "is_admin": bool(getattr(m, "is_admin", False) or chat.created_by == u.id),
                    "is_online": bool(getattr(u, "is_online", False)),
                }
            )

        other_user = None
        if not is_group and not is_channel and not is_favorites:
            other = (
                db.query(ChatMember)
                .filter(ChatMember.chat_id == chat_id, ChatMember.user_id != current_user.id)
                .first()
            )
            if other and other.user:
                other_user = private_profile_payload(db, other.user, current_user)

        msg_count = (
            db.query(Message)
            .filter(Message.chat_id == chat_id, Message.is_deleted == False)
            .count()
        )

        name = chat.name
        if is_favorites:
            name = "⭐ Избранное"
        elif other_user:
            name = other_user.get("username") or name

        return {
            "id": chat.id,
            "name": name or "Чат",
            "description": getattr(chat, "description", None),
            "avatar_url": chat.avatar_url if (is_group or is_channel) else (other_user or {}).get("avatar_url"),
            "is_group": is_group,
            "is_channel": is_channel,
            "is_favorites": is_favorites,
            "is_admin": is_admin,
            "created_by": chat.created_by,
            "member_count": len(member_list),
            "message_count": msg_count,
            "members": member_list,
            "other_user": other_user,
            "allowed_reactions": getattr(chat, "allowed_reactions", None),
        }
