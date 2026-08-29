from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship, declarative_base
from datetime import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    handle = Column(String(50), unique=True, index=True, nullable=True)
    password_hash = Column(String(128), nullable=False)
    avatar_url = Column(String(255), nullable=True)
    phone = Column(String(30), nullable=True)
    phone_verified = Column(Boolean, default=False)
    email = Column(String(120), nullable=True)
    bio = Column(String(300), nullable=True)
    birthday = Column(String(20), nullable=True)
    is_vip = Column(Boolean, default=False)
    emoji_status = Column(String(16), nullable=True)
    is_online = Column(Boolean, default=False)
    last_seen = Column(DateTime, default=datetime.utcnow)
    
    # Privacy: all | contacts | nobody | none (прочерк)
    privacy_phone = Column(String(20), default="contacts")
    privacy_email = Column(String(20), default="contacts")
    privacy_online = Column(String(20), default="all")
    privacy_avatar = Column(String(20), default="all")
    privacy_bio = Column(String(20), default="all")
    privacy_invite = Column(String(20), default="all")
    
    cloud_password_hash = Column(String(128), nullable=True)
    passcode_hash = Column(String(128), nullable=True)
    
    messages = relationship("Message", back_populates="sender")
    memberships = relationship("ChatMember", back_populates="user")
    stories = relationship("Story", back_populates="user")


class Chat(Base):
    __tablename__ = "chats"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=True)
    is_group = Column(Boolean, default=False)
    is_channel = Column(Boolean, default=False)
    is_favorites = Column(Boolean, default=False)
    is_public = Column(Boolean, default=False)
    description = Column(String(500), nullable=True)
    avatar_url = Column(String(255), nullable=True)
    allowed_reactions = Column(String(200), default="👍,❤️,😂,😮,😢,🔥")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    messages = relationship("Message", back_populates="chat")
    members = relationship("ChatMember", back_populates="chat")


class ChatMember(Base):
    __tablename__ = "chat_members"
    
    id = Column(Integer, primary_key=True)
    chat_id = Column(Integer, ForeignKey("chats.id"))
    user_id = Column(Integer, ForeignKey("users.id"))
    last_read_message_id = Column(Integer, nullable=True, default=0)
    is_admin = Column(Boolean, default=False)
    
    chat = relationship("Chat", back_populates="members")
    user = relationship("User", back_populates="memberships")


class Message(Base):
    __tablename__ = "messages"
    
    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(Integer, ForeignKey("chats.id"))
    sender_id = Column(Integer, ForeignKey("users.id"))
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default="text")
    media_url = Column(String(255), nullable=True)
    is_encrypted = Column(Boolean, default=True)
    transcript = Column(Text, nullable=True)
    is_pinned = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    chat = relationship("Chat", back_populates="messages")
    sender = relationship("User", back_populates="messages")


class Story(Base):
    __tablename__ = "stories"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(String(500), nullable=True)
    media_url = Column(String(255), nullable=True)
    font_style = Column(String(40), nullable=True)
    sticker = Column(String(16), nullable=True)
    text_x = Column(Integer, default=50)
    text_y = Column(Integer, default=70)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    
    user = relationship("User", back_populates="stories")


class StoryView(Base):
    __tablename__ = "story_views"
    
    id = Column(Integer, primary_key=True)
    story_id = Column(Integer, ForeignKey("stories.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class StoryReaction(Base):
    __tablename__ = "story_reactions"
    
    id = Column(Integer, primary_key=True)
    story_id = Column(Integer, ForeignKey("stories.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    emoji = Column(String(16), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class StoryReply(Base):
    __tablename__ = "story_replies"
    
    id = Column(Integer, primary_key=True)
    story_id = Column(Integer, ForeignKey("stories.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Blacklist(Base):
    __tablename__ = "blacklist"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    blocked_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class DeviceSession(Base):
    __tablename__ = "device_sessions"
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    device_name = Column(String(120), nullable=True)
    token_hint = Column(String(20), nullable=True)
    last_active = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
