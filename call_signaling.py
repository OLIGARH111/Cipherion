"""Relay WebRTC call signaling over existing ConnectionManager."""
from typing import Any, Dict

CALL_TYPES = {
    "call_invite",
    "call_accept",
    "call_reject",
    "call_end",
    "call_offer",
    "call_answer",
    "call_ice",
    "call_busy",
}


async def handle_call_signal(
    manager,
    user_id: int,
    username: str,
    message_data: Dict[str, Any],
) -> bool:
    """If message is call signaling, relay to target user. Returns True if handled."""
    msg_type = message_data.get("type")
    if msg_type not in CALL_TYPES:
        return False

    target = message_data.get("to_user_id")
    try:
        target_id = int(target)
    except (TypeError, ValueError):
        return True  # swallow invalid

    if target_id == user_id:
        return True

    payload = dict(message_data)
    payload["from_user_id"] = user_id
    if "from_username" not in payload or not payload.get("from_username"):
        payload["from_username"] = username

    await manager.send_personal(target_id, payload)
    return True
