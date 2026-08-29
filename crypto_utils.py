"""
Шифрование сообщений AES-128 (Fernet = AES-CBC + HMAC).
Ключ выводится из SECRET_KEY сервера — данные в БД хранятся только в зашифрованном виде.
"""
import base64
import hashlib
from cryptography.fernet import Fernet, InvalidToken

_fernet = None


def init_crypto(secret_key: str):
    global _fernet
    # Стабильный 32-байтовый ключ из секрета приложения
    derived = hashlib.sha256(secret_key.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(derived)
    _fernet = Fernet(key)


def encrypt_text(plain: str) -> str:
    if plain is None:
        return ""
    if not _fernet:
        return plain
    token = _fernet.encrypt(plain.encode("utf-8"))
    return "enc:" + token.decode("utf-8")


def decrypt_text(stored: str) -> str:
    if not stored:
        return ""
    if not stored.startswith("enc:"):
        return stored  # старые незашифрованные
    if not _fernet:
        return stored
    try:
        raw = stored[4:].encode("utf-8")
        return _fernet.decrypt(raw).decode("utf-8")
    except (InvalidToken, Exception):
        return "[не удалось расшифровать]"


def is_encrypted_value(stored: str) -> bool:
    return bool(stored and stored.startswith("enc:"))
