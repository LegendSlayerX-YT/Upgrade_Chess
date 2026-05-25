import secrets

import chess

import db
from chess_app import state
from chess_app.auth import display_name_for, picture_for
from chess_app.chess_logic import WIN_REWARD_TOKENS, build_pieces


def make_game_id():
    return secrets.token_hex(4)


def waiting_list_payload(self_sid=None):
    return [
        {
            "sid": sid,
            "name": info.get("name") or "Player",
            "picture": info.get("picture"),
            "is_self": sid == self_sid,
        }
        for sid, info in state.waiting_players.items()
    ]


def broadcast_waiting_list():
    for sid in list(state.connected_sids):
        if sid in state.sid_to_game:
            continue
        state.socketio.emit(
            "waitingListUpdate",
            {"players": waiting_list_payload(self_sid=sid)},
            to=sid,
        )


def remove_from_waiting(sid):
    if sid in state.waiting_players:
        state.waiting_players.pop(sid, None)
        return True
    return False


def add_to_waiting(sid):
    user = state.sid_to_user.get(sid) or {}
    state.waiting_players[sid] = {
        "name": user.get("name") or "Player",
        "picture": user.get("picture"),
    }


def levels_for_sid(sid):
    user = state.sid_to_user.get(sid)
    email = (user or {}).get("email")
    if email:
        try:
            return db.fetch_levels(email)
        except Exception:
            pass
    return {"w": {}, "b": {}}


def start_game(white_sid, black_sid):
    game_id = make_game_id()
    board = chess.Board()
    saved_levels = {
        white_sid: levels_for_sid(white_sid),
        black_sid: levels_for_sid(black_sid),
    }
    white_side = saved_levels[white_sid].get("w", {})
    black_side = saved_levels[black_sid].get("b", {})
    state.pending_levels.pop(white_sid, None)
    state.pending_levels.pop(black_sid, None)
    pieces = build_pieces(white_side, black_side)
    state.games[game_id] = {
        "id": game_id,
        "board": board,
        "pieces": pieces,
        "white": white_sid,
        "black": black_sid,
        "draw_offer_by": None,
        "state": "active",
        "rematch_requests": set(),
        "pending_capture": None,
        "levels_by_sid": saved_levels,
    }
    state.sid_to_game[white_sid] = game_id
    state.sid_to_game[black_sid] = game_id
    state.socketio.server.enter_room(white_sid, game_id, namespace="/")
    state.socketio.server.enter_room(black_sid, game_id, namespace="/")
    white_name = display_name_for(white_sid)
    black_name = display_name_for(black_sid)
    white_pic = picture_for(white_sid)
    black_pic = picture_for(black_sid)
    state.games[game_id]["names"] = {"white": white_name, "black": black_name}
    state.socketio.emit(
        "paired",
        {
            "gameId": game_id, "color": "white", "fen": board.fen(), "pieces": pieces,
            "you": white_name, "opponent": black_name,
            "yourPicture": white_pic, "opponentPicture": black_pic,
        },
        to=white_sid,
    )
    state.socketio.emit(
        "paired",
        {
            "gameId": game_id, "color": "black", "fen": board.fen(), "pieces": pieces,
            "you": black_name, "opponent": white_name,
            "yourPicture": black_pic, "opponentPicture": white_pic,
        },
        to=black_sid,
    )


def pair_with(sid, partner_sid):
    """Pair two specific sids into a game. Returns True if paired."""
    if sid == partner_sid:
        return False
    if partner_sid not in state.waiting_players or partner_sid not in state.connected_sids:
        return False
    state.waiting_players.pop(partner_sid, None)
    state.waiting_players.pop(sid, None)
    white_is_partner = secrets.randbelow(2) == 0
    if white_is_partner:
        start_game(partner_sid, sid)
    else:
        start_game(sid, partner_sid)
    return True


def award_win_reward(game, winner):
    if winner not in ("white", "black"):
        return
    winner_sid = game["white"] if winner == "white" else game["black"]
    user = state.sid_to_user.get(winner_sid)
    email = (user or {}).get("email")
    if not email:
        return
    color = "w" if winner == "white" else "b"
    currency = db.award_tokens(email, color, WIN_REWARD_TOKENS)
    payload = currency.to_dict()
    payload["found"] = True
    state.socketio.emit("currencyData", payload, to=winner_sid)


def end_game(game_id, payload):
    game = state.games.get(game_id)
    if not game or game["state"] != "active":
        return
    game["state"] = "ended"
    game["rematch_requests"] = set()
    award_win_reward(game, payload.get("winner"))
    state.socketio.emit("gameOver", payload, to=game_id)


def leave_ended_game(sid):
    game_id = state.sid_to_game.get(sid)
    if not game_id:
        return
    game = state.games.get(game_id)
    if not game or game["state"] != "ended":
        return
    state.sid_to_game.pop(sid, None)
    state.socketio.server.leave_room(sid, game_id, namespace="/")
    opponent_sid = game["black"] if sid == game["white"] else game["white"]
    if state.sid_to_game.get(opponent_sid) == game_id:
        state.socketio.emit("rematchUnavailable", to=opponent_sid)
    else:
        state.games.pop(game_id, None)
