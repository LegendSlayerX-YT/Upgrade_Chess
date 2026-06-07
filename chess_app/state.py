import os
import secrets
import threading

from dotenv import load_dotenv
from flask import Flask
from flask_socketio import SocketIO
from google.auth.transport import requests as google_requests
from itsdangerous import URLSafeSerializer

load_dotenv()

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))

app = Flask(
    __name__,
    template_folder=os.path.join(_ROOT, "templates"),
    static_folder=os.path.join(_ROOT, "static"),
)


class PrefixMiddleware:
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app
    def __call__(self, environ, start_response):
        prefix = environ.get("HTTP_X_FORWARDED_PREFIX", "")
        if prefix:
            environ["SCRIPT_NAME"] = prefix
            path = environ["PATH_INFO"]
            if path.startswith(prefix):
                environ["PATH_INFO"] = path[len(prefix):]
        return self.wsgi_app(environ, start_response)


app.wsgi_app = PrefixMiddleware(app.wsgi_app)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

SESSION_COOKIE_NAME = "uc_session"
SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days
session_serializer = URLSafeSerializer(app.secret_key, salt="uc-auth-cookie")
google_request = google_requests.Request()

waiting_players = {}  # sid -> {"name": str, "picture": str|None}
games = {}
sid_to_game = {}
connected_sids = set()
sid_to_user = {}
state_lock = threading.RLock()
