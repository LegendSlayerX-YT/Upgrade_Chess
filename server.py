import os

from chess_app import app, socketio
from chess_app import assets  # noqa: F401  registers versioned asset routes
from chess_app import http_routes  # noqa: F401  registers Flask routes
from chess_app import socket_handlers  # noqa: F401  registers Socket.IO handlers
from chess_app.scheduler import start_scheduler

start_scheduler()  # daily 3:00 PM energy grant

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"ChessRPG server listening on http://localhost:{port}")
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)
