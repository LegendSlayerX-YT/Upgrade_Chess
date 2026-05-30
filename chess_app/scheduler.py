"""Background scheduler for the daily energy grant.

Runs as a single Socket.IO background task (the app is deployed with one
gunicorn worker, so exactly one instance of this loop exists). Every day at
DAILY_GRANT_HOUR local time it credits DAILY_ENERGY_GRANT energy to every
player in the database — online or offline — and pushes the refreshed balance
to anyone currently connected so their UI updates live.
"""

from datetime import datetime, timedelta

import db
from chess_app import state

DAILY_ENERGY_GRANT = 20
DAILY_GRANT_HOUR = 15  # 3:00 PM, server local time
_RETRY_DELAY_SECONDS = 60


def _seconds_until_next_grant(now):
    target = now.replace(hour=DAILY_GRANT_HOUR, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _broadcast_energy_to_online():
    with state.state_lock:
        connected = list(state.sid_to_user.items())
    for sid, user in connected:
        email = (user or {}).get("email")
        if not email:
            continue
        try:
            currency = db.fetch_currency(email)
        except Exception:
            continue
        if currency is None:
            continue
        payload = currency.to_dict()
        payload["found"] = True
        state.socketio.emit("currencyData", payload, to=sid)


def _grant_loop():
    while True:
        state.socketio.sleep(_seconds_until_next_grant(datetime.now()))
        try:
            updated = db.grant_energy_to_all(DAILY_ENERGY_GRANT)
        except Exception as exc:
            print(f"[scheduler] daily energy grant failed: {exc}")
            state.socketio.sleep(_RETRY_DELAY_SECONDS)
            continue
        print(f"[scheduler] granted {DAILY_ENERGY_GRANT} energy to {updated} players")
        _broadcast_energy_to_online()
        # Move clear of 15:00:00 so the next loop schedules tomorrow, not today.
        state.socketio.sleep(1)


def start_scheduler():
    state.socketio.start_background_task(_grant_loop)
