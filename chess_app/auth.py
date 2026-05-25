from flask import request
from google.oauth2 import id_token
from itsdangerous import BadSignature

from chess_app import state


def read_session_cookie():
    raw = request.cookies.get(state.SESSION_COOKIE_NAME)
    if not raw:
        return None
    try:
        return state.session_serializer.loads(raw)
    except BadSignature:
        return None


def verify_google_credential(credential):
    """Returns (user_dict, error_str). On success error_str is None."""
    if not credential:
        return None, "missing credential"
    try:
        info = id_token.verify_oauth2_token(
            credential, state.google_request, state.GOOGLE_CLIENT_ID
        )
    except ValueError as e:
        return None, f"invalid token: {e}"
    return {
        "sub": info.get("sub"),
        "name": info.get("name") or info.get("email") or "Player",
        "email": info.get("email"),
        "picture": info.get("picture"),
    }, None


def display_name_for(sid):
    user = state.sid_to_user.get(sid)
    return user["name"] if user else "Guest"


def picture_for(sid):
    user = state.sid_to_user.get(sid)
    return (user or {}).get("picture")
