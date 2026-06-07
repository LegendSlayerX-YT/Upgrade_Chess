import secrets

import chess

import db
from chess_app import state
from chess_app.auth import display_name_for, picture_for
from chess_app.chess_logic import (
    FAIR_GAME_WIN_REWARD_TOKENS,
    GAME_ENERGY_COST,
    WIN_REWARD_TOKENS,
    build_pieces,
)


def make_game_id():
    return secrets.token_hex(4)


def player_identity_for_sid(sid):
    user = state.sid_to_user.get(sid) or {}
    return user.get("sub") or user.get("email")


def same_person(a_sid, b_sid):
    if not a_sid or not b_sid:
        return False
    if a_sid == b_sid:
        return True
    a_identity = player_identity_for_sid(a_sid)
    b_identity = player_identity_for_sid(b_sid)
    return bool(a_identity and b_identity and a_identity == b_identity)


def waiting_list_payload(self_sid=None):
    return [
        {
            "sid": sid,
            "name": info.get("name") or "Player",
            "picture": info.get("picture"),
            "fairGame": bool(info.get("fair_game")),
            "winRewardTokens": win_reward_amount(bool(info.get("fair_game"))),
            "is_self": same_person(sid, self_sid),
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


def add_to_waiting(sid, fair_game=False):
    user = state.sid_to_user.get(sid) or {}
    state.waiting_players[sid] = {
        "name": user.get("name") or "Player",
        "picture": user.get("picture"),
        "fair_game": bool(fair_game),
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


def email_for_sid(sid):
    return (state.sid_to_user.get(sid) or {}).get("email")


def empty_levels_snapshot():
    return {"w": {}, "b": {}}


def copy_levels_snapshot(levels):
    snapshot = empty_levels_snapshot()
    if not isinstance(levels, dict):
        return snapshot
    for side in ("w", "b"):
        side_levels = levels.get(side)
        if isinstance(side_levels, dict):
            snapshot[side] = dict(side_levels)
    return snapshot


def win_reward_amount(fair_game=False):
    if fair_game:
        return FAIR_GAME_WIN_REWARD_TOKENS
    return WIN_REWARD_TOKENS


def charge_for_game(white_sid, black_sid):
    """Deduct the per-game energy cost from both players, charging both or
    neither. On success, emits the refreshed currency to each player and
    returns True. On failure (not signed in, or insufficient energy), tells
    both players why and returns False without starting a game."""
    white_email = email_for_sid(white_sid)
    black_email = email_for_sid(black_sid)
    if not white_email or not black_email:
        for sid in (white_sid, black_sid):
            state.socketio.emit("joinFailed", {"reason": "Sign in to play."}, to=sid)
        return False
    try:
        charged = db.spend_energy_from_pair(white_email, black_email, GAME_ENERGY_COST)
    except Exception:
        for sid in (white_sid, black_sid):
            state.socketio.emit("joinFailed", {"reason": "Could not start game. Try again."}, to=sid)
        return False
    if charged is None:
        for sid in (white_sid, black_sid):
            state.socketio.emit(
                "joinFailed",
                {"reason": f"Both players need at least {GAME_ENERGY_COST} energy to play."},
                to=sid,
            )
        return False
    for sid, email in ((white_sid, white_email), (black_sid, black_email)):
        currency = charged.get(email)
        if currency:
            payload = currency.to_dict()
            payload["found"] = True
            state.socketio.emit("currencyData", payload, to=sid)
    return True


def start_game(white_sid, black_sid, fair_game=False, levels_by_sid=None):
    if same_person(white_sid, black_sid):
        seen = set()
        for sid in (white_sid, black_sid):
            if sid in seen:
                continue
            seen.add(sid)
            state.socketio.emit(
                "joinFailed",
                {"reason": "You cannot play against yourself."},
                to=sid,
            )
        return False
    if not charge_for_game(white_sid, black_sid):
        return False
    game_id = make_game_id()
    board = chess.Board()
    if levels_by_sid is not None:
        saved_levels = {
            white_sid: copy_levels_snapshot(levels_by_sid.get(white_sid)),
            black_sid: copy_levels_snapshot(levels_by_sid.get(black_sid)),
        }
    elif fair_game:
        saved_levels = {
            white_sid: empty_levels_snapshot(),
            black_sid: empty_levels_snapshot(),
        }
    else:
        saved_levels = {
            white_sid: levels_for_sid(white_sid),
            black_sid: levels_for_sid(black_sid),
        }
    white_side = saved_levels[white_sid].get("w", {})
    black_side = saved_levels[black_sid].get("b", {})
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
        "fair_game": bool(fair_game),
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
            "fairGame": bool(fair_game),
            "winRewardTokens": win_reward_amount(bool(fair_game)),
        },
        to=white_sid,
    )
    state.socketio.emit(
        "paired",
        {
            "gameId": game_id, "color": "black", "fen": board.fen(), "pieces": pieces,
            "you": black_name, "opponent": white_name,
            "yourPicture": black_pic, "opponentPicture": white_pic,
            "fairGame": bool(fair_game),
            "winRewardTokens": win_reward_amount(bool(fair_game)),
        },
        to=black_sid,
    )
    return True


def pair_with(sid, partner_sid):
    """Pair two specific sids into a game. Returns one of:
    'paired'      - a game started,
    'self'        - the partner is the same signed-in person,
    'unavailable' - the partner is no longer waiting/connected,
    'failed'      - the game could not start (e.g. insufficient energy); the
                    reason has already been sent to the players."""
    if same_person(sid, partner_sid):
        return "self"
    partner_info = state.waiting_players.get(partner_sid)
    if not partner_info or partner_sid not in state.connected_sids:
        return "unavailable"
    white_is_partner = secrets.randbelow(2) == 0
    white_sid, black_sid = (partner_sid, sid) if white_is_partner else (sid, partner_sid)
    fair_game = bool(partner_info.get("fair_game"))
    if not start_game(white_sid, black_sid, fair_game=fair_game):
        return "failed"
    state.waiting_players.pop(partner_sid, None)
    state.waiting_players.pop(sid, None)
    return "paired"


def win_reward_for_game(game):
    return win_reward_amount(bool(game.get("fair_game")))


def award_win_reward(game, winner):
    if winner not in ("white", "black"):
        return
    winner_sid = game["white"] if winner == "white" else game["black"]
    user = state.sid_to_user.get(winner_sid)
    email = (user or {}).get("email")
    if not email:
        return
    color = "w" if winner == "white" else "b"
    currency = db.award_tokens(email, color, win_reward_for_game(game))
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
