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
        return True

    if target_id == user_id:
        return True

    payload = dict(message_data)
    payload["from_user_id"] = user_id
    if not payload.get("from_username"):
        payload["from_username"] = username

    delivered = await manager.send_personal(target_id, payload)

    # Tell caller that invite could not be delivered (peer offline)
    if msg_type == "call_invite" and not delivered:
        try:
            await manager.send_personal(
                user_id,
                {
                    "type": "call_offline",
                    "to_user_id": target_id,
                    "call_id": message_data.get("call_id"),
                    "detail": "Пользователь не в сети",
                },
            )
        except Exception:
            pass

    return True
