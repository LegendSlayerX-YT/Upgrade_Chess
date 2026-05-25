from flask import jsonify, make_response, render_template, request

from chess_app import state
from chess_app.auth import verify_google_credential


@state.app.route("/")
def index():
    return render_template("index.html", google_client_id=state.GOOGLE_CLIENT_ID)


@state.app.post("/auth/google")
def http_auth_google():
    payload = request.get_json(silent=True) or {}
    user, error = verify_google_credential(payload.get("credential"))
    if error:
        status = 400 if error == "missing credential" else 401
        return jsonify({"error": error}), status
    token = state.session_serializer.dumps(user)
    resp = make_response(jsonify({"ok": True, "user": {"name": user["name"], "picture": user["picture"]}}))
    resp.set_cookie(
        state.SESSION_COOKIE_NAME, token,
        max_age=state.SESSION_COOKIE_MAX_AGE,
        httponly=True, samesite="Lax",
    )
    return resp


@state.app.post("/auth/logout")
def http_auth_logout():
    resp = make_response(jsonify({"ok": True}))
    resp.delete_cookie(state.SESSION_COOKIE_NAME)
    return resp
