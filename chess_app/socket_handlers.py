import chess
from flask import request
from flask_socketio import emit

import db
from chess_app import state
from chess_app.auth import read_session_cookie, verify_google_credential
from chess_app.chess_logic import PROMO_LETTER_TO_PIECE, SLOT_TYPES, can_attack_king
from chess_app.game_engine import commit_move
from chess_app.rooms import (
    add_to_waiting,
    broadcast_waiting_list,
    end_game,
    leave_ended_game,
    pair_with,
    remove_from_waiting,
    start_game,
    waiting_list_payload,
)

socketio = state.socketio


@socketio.on("connect")
def on_connect():
    sid = request.sid
    state.connected_sids.add(sid)
    user = read_session_cookie()
    if user:
        with state.state_lock:
            state.sid_to_user[sid] = user
        emit("authenticated", {"name": user["name"], "picture": user.get("picture")})


@socketio.on("authenticate")
def on_authenticate(payload):
    sid = request.sid
    credential = (payload or {}).get("credential") if isinstance(payload, dict) else None
    user, error = verify_google_credential(credential)
    if error:
        emit("authError", {"reason": error})
        return
    with state.state_lock:
        state.sid_to_user[sid] = user
    emit("authenticated", {"name": user["name"], "picture": user.get("picture")})


@socketio.on("fetchCurrency")
def on_fetch_currency():
    sid = request.sid
    with state.state_lock:
        user = state.sid_to_user.get(sid)
    if not user or not user.get("email"):
        emit("currencyData", {"email": None, "found": False})
        return
    email = user.get("email")
    try:
        currency = db.fetch_currency(email)
    except Exception as e:
        emit("currencyError", {"reason": str(e)})
        return
    if currency is None:
        emit("currencyData", {"email": email, "found": False})
        return
    payload = currency.to_dict()
    payload["found"] = True
    emit("currencyData", payload)


@socketio.on("findGame")
def on_find_game(*_):
    sid = request.sid
    with state.state_lock:
        if sid not in state.sid_to_user:
            emit("authError", {"reason": "login required"})
            return
        leave_ended_game(sid)
        emit("waitingList", {"players": waiting_list_payload(self_sid=sid)})


@socketio.on("createWaitingGame")
def on_create_waiting_game():
    sid = request.sid
    with state.state_lock:
        if sid not in state.sid_to_user:
            emit("authError", {"reason": "login required"})
            return
        if state.sid_to_game.get(sid):
            return
        add_to_waiting(sid)
        emit("waiting")
    broadcast_waiting_list()


@socketio.on("joinWaitingGame")
def on_join_waiting_game(payload):
    sid = request.sid
    with state.state_lock:
        if sid not in state.sid_to_user:
            emit("authError", {"reason": "login required"})
            return
        partner_sid = (payload or {}).get("sid") if isinstance(payload, dict) else None
        if not partner_sid:
            emit("joinFailed", {"reason": "missing partner"})
            return
        leave_ended_game(sid)
        remove_from_waiting(sid)
        if not pair_with(sid, partner_sid):
            emit("joinFailed", {"reason": "Player is no longer available."})
            emit("waitingList", {"players": waiting_list_payload(self_sid=sid)})
            return
    broadcast_waiting_list()


@socketio.on("cancelWaiting")
def on_cancel_waiting():
    sid = request.sid
    changed = False
    with state.state_lock:
        changed = remove_from_waiting(sid)
        emit("waitingCancelled")
    if changed:
        broadcast_waiting_list()


@socketio.on("fetchLevels")
def on_fetch_levels():
    sid = request.sid
    with state.state_lock:
        user = state.sid_to_user.get(sid)
    if not user or not user.get("email"):
        emit("levelsError", {"reason": "login required"})
        return
    try:
        levels = db.fetch_levels(user["email"])
    except Exception as e:
        emit("levelsError", {"reason": str(e)})
        return
    emit("levelsData", {"levels": levels, "costs": db.UPGRADE_BASE_COST})


@socketio.on("upgradePiece")
def on_upgrade_piece(payload):
    sid = request.sid
    with state.state_lock:
        user = state.sid_to_user.get(sid)
    if not user or not user.get("email"):
        emit("upgradeError", {"reason": "login required"})
        return
    if not isinstance(payload, dict):
        emit("upgradeError", {"reason": "invalid payload"})
        return
    color = payload.get("color")
    slot = payload.get("slot")
    if color not in ("w", "b") or slot not in SLOT_TYPES or SLOT_TYPES[slot] == "k":
        emit("upgradeError", {"reason": "invalid slot"})
        return
    try:
        result = db.upgrade_piece(user["email"], color, slot)
    except Exception as e:
        emit("upgradeError", {"reason": str(e)})
        return
    if result is None:
        emit("upgradeError", {"reason": "insufficient currency or max level", "color": color, "slot": slot})
        return
    currency_payload = result.currency.to_dict()
    currency_payload["found"] = True
    emit("upgraded", {"color": color, "slot": slot, "level": result.new_level})
    emit("currencyData", currency_payload)


@socketio.on("downgradePiece")
def on_downgrade_piece(payload):
    sid = request.sid
    with state.state_lock:
        user = state.sid_to_user.get(sid)
    if not user or not user.get("email"):
        emit("upgradeError", {"reason": "login required"})
        return
    if not isinstance(payload, dict):
        emit("upgradeError", {"reason": "invalid payload"})
        return
    color = payload.get("color")
    slot = payload.get("slot")
    if color not in ("w", "b") or slot not in SLOT_TYPES or SLOT_TYPES[slot] == "k":
        emit("upgradeError", {"reason": "invalid slot"})
        return
    try:
        result = db.downgrade_piece(user["email"], color, slot)
    except Exception as e:
        emit("upgradeError", {"reason": str(e)})
        return
    if result is None:
        emit("upgradeError", {"reason": "already at level 1", "color": color, "slot": slot})
        return
    currency_payload = result.currency.to_dict()
    currency_payload["found"] = True
    emit("upgraded", {"color": color, "slot": slot, "level": result.new_level})
    emit("currencyData", currency_payload)


@socketio.on("move")
def on_move(payload):
    sid = request.sid
    with state.state_lock:
        game_id = state.sid_to_game.get(sid)
        game = state.games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        if game.get("pending_capture"):
            emit("illegalMove", {"reason": "capture pending"})
            return
        board = game["board"]
        turn_color = "white" if board.turn == chess.WHITE else "black"
        player_color = "white" if sid == game["white"] else "black"
        if turn_color != player_color:
            emit("illegalMove", {"reason": "not your turn"})
            return

        try:
            from_alg = payload["from"]
            to_alg = payload["to"]
            promo_letter = (payload.get("promotion") or "q").lower()
            from_sq = chess.parse_square(from_alg)
            to_sq = chess.parse_square(to_alg)
        except (KeyError, ValueError, TypeError):
            emit("illegalMove", {"reason": "illegal"})
            return

        promo_piece = PROMO_LETTER_TO_PIECE.get(promo_letter, chess.QUEEN)
        candidate = chess.Move(from_sq, to_sq, promotion=promo_piece)
        is_king_attack = False
        if candidate not in board.legal_moves:
            plain = chess.Move(from_sq, to_sq)
            if plain in board.legal_moves:
                candidate = plain
            elif can_attack_king(board, candidate, to_sq):
                is_king_attack = True
            elif can_attack_king(board, plain, to_sq):
                candidate = plain
                is_king_attack = True
            else:
                emit("illegalMove", {"reason": "illegal"})
                return

        if is_king_attack:
            is_en_passant = False
            is_capture = True
            is_castle = False
            is_kingside = False
            san = f"{from_alg}x{to_alg}"
        else:
            is_en_passant = board.is_en_passant(candidate)
            is_capture = board.is_capture(candidate)
            is_castle = board.is_castling(candidate)
            is_kingside = board.is_kingside_castling(candidate)
            san = board.san(candidate)
        mover_color = "w" if board.turn == chess.WHITE else "b"
        promotion_letter = chess.piece_symbol(candidate.promotion) if candidate.promotion else None

        move_info = {
            "from": from_alg,
            "to": to_alg,
            "color": mover_color,
            "is_en_passant": is_en_passant,
            "is_capture": is_capture,
            "is_castle": is_castle,
            "is_kingside": is_kingside,
            "is_king_attack": is_king_attack,
            "promotion": promotion_letter,
        }

        if is_capture:
            attacker_piece = game["pieces"].get(from_alg)
            if is_en_passant:
                ep_rank = "5" if mover_color == "w" else "4"
                defender_sq_alg = to_alg[0] + ep_rank
            else:
                defender_sq_alg = to_alg
            defender_piece = game["pieces"].get(defender_sq_alg)

            if not attacker_piece or not defender_piece:
                commit_move(game, candidate, move_info, san, player_color)
                return

            defender_color = "b" if mover_color == "w" else "w"
            defender_sid = game["black"] if defender_color == "b" else game["white"]
            game["pending_capture"] = {
                "attacker_sid": sid,
                "defender_sid": defender_sid,
                "candidate": candidate,
                "move_info": move_info,
                "san": san,
                "player_color": player_color,
                "attacker_color": mover_color,
                "defender_color": defender_color,
                "defender_square": defender_sq_alg,
                "attacker_hp": attacker_piece["hp"],
                "defender_hp": defender_piece["hp"],
                "attacker_dmg": attacker_piece["dmg"],
                "defender_dmg": defender_piece["dmg"],
                "turn": "attacker",
            }
            socketio.emit(
                "captureWindow",
                {
                    "from": from_alg,
                    "to": to_alg,
                    "promotion": promotion_letter,
                    "attackerColor": mover_color,
                    "defenderColor": defender_color,
                    "defenderSquare": defender_sq_alg,
                    "attackerHp": attacker_piece["hp"],
                    "defenderHp": defender_piece["hp"],
                    "attackerDmg": attacker_piece["dmg"],
                    "defenderDmg": defender_piece["dmg"],
                    "turn": "attacker",
                },
                to=game_id,
            )
            return

        commit_move(game, candidate, move_info, san, player_color)


@socketio.on("offerDraw")
def on_offer_draw():
    sid = request.sid
    with state.state_lock:
        game_id = state.sid_to_game.get(sid)
        game = state.games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        color = "white" if sid == game["white"] else "black"
        if game["draw_offer_by"] == color:
            return
        if game["draw_offer_by"] and game["draw_offer_by"] != color:
            game["draw_offer_by"] = None
            end_game(game_id, {"type": "agreement"})
            return
        game["draw_offer_by"] = color
        opponent_sid = game["black"] if color == "white" else game["white"]
        socketio.emit("drawOffered", {"by": color}, to=opponent_sid)
        emit("drawOfferSent")


@socketio.on("acceptDraw")
def on_accept_draw():
    sid = request.sid
    with state.state_lock:
        game_id = state.sid_to_game.get(sid)
        game = state.games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        color = "white" if sid == game["white"] else "black"
        if not game["draw_offer_by"] or game["draw_offer_by"] == color:
            return
        game["draw_offer_by"] = None
        end_game(game_id, {"type": "agreement"})


@socketio.on("declineDraw")
def on_decline_draw():
    sid = request.sid
    with state.state_lock:
        game_id = state.sid_to_game.get(sid)
        game = state.games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        color = "white" if sid == game["white"] else "black"
        if not game["draw_offer_by"] or game["draw_offer_by"] == color:
            return
        game["draw_offer_by"] = None
        socketio.emit("drawDeclined", to=game_id)


@socketio.on("duelStrike")
def on_duel_strike():
    sid = request.sid
    with state.state_lock:
        game_id = state.sid_to_game.get(sid)
        game = state.games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        pending = game.get("pending_capture")
        if not pending:
            return

        if pending["turn"] == "attacker":
            if pending["attacker_sid"] != sid:
                return
            if pending["move_info"].get("is_en_passant"):
                pending["defender_hp"] = 0
            else:
                pending["defender_hp"] = max(pending["defender_hp"] - pending["attacker_dmg"], 0)
        else:
            if pending["defender_sid"] != sid:
                return
            pending["attacker_hp"] = max(pending["attacker_hp"] - pending["defender_dmg"], 0)

        attacker_alive = pending["attacker_hp"] > 0
        defender_alive = pending["defender_hp"] > 0

        if not attacker_alive or not defender_alive:
            combat_result = {
                "attacker_survived": attacker_alive,
                "defender_survived": defender_alive,
                "attacker_hp": pending["attacker_hp"],
                "defender_hp": pending["defender_hp"],
                "log": [],
            }
            game["pending_capture"] = None
            commit_move(
                game,
                pending["candidate"],
                pending["move_info"],
                pending["san"],
                pending["player_color"],
                combat_result=combat_result,
            )
            return

        pending["turn"] = "defender" if pending["turn"] == "attacker" else "attacker"
        socketio.emit(
            "duelUpdate",
            {
                "attackerHp": pending["attacker_hp"],
                "defenderHp": pending["defender_hp"],
                "turn": pending["turn"],
            },
            to=game_id,
        )


@socketio.on("resign")
def on_resign():
    sid = request.sid
    with state.state_lock:
        game_id = state.sid_to_game.get(sid)
        game = state.games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        loser = "white" if sid == game["white"] else "black"
        winner = "black" if loser == "white" else "white"
        end_game(game_id, {"type": "resign", "winner": winner})


@socketio.on("requestRematch")
def on_request_rematch():
    sid = request.sid
    with state.state_lock:
        game_id = state.sid_to_game.get(sid)
        game = state.games.get(game_id) if game_id else None
        if not game or game["state"] != "ended":
            return

        opponent_sid = game["black"] if sid == game["white"] else game["white"]
        opponent_still_in = (
            state.sid_to_game.get(opponent_sid) == game_id
            and opponent_sid in state.connected_sids
        )
        if not opponent_still_in:
            emit("rematchUnavailable")
            return

        game["rematch_requests"].add(sid)
        if opponent_sid in game["rematch_requests"]:
            new_white = game["black"]
            new_black = game["white"]
            saved = game.get("levels_by_sid") or {}
            for s in (new_white, new_black):
                if s in saved:
                    state.pending_levels[s] = saved[s]
            state.sid_to_game.pop(game["white"], None)
            state.sid_to_game.pop(game["black"], None)
            socketio.server.leave_room(new_white, game_id, namespace="/")
            socketio.server.leave_room(new_black, game_id, namespace="/")
            state.games.pop(game_id, None)
            start_game(new_white, new_black)
        else:
            emit("rematchPending")
            socketio.emit("rematchRequested", to=opponent_sid)


@socketio.on("cancelRematch")
def on_cancel_rematch():
    with state.state_lock:
        leave_ended_game(request.sid)


@socketio.on("signOut")
def on_sign_out():
    sid = request.sid
    with state.state_lock:
        state.sid_to_user.pop(sid, None)
    emit("signedOut", {})


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    waiting_changed = False
    with state.state_lock:
        state.connected_sids.discard(sid)
        waiting_changed = remove_from_waiting(sid)
        state.pending_levels.pop(sid, None)
        state.sid_to_user.pop(sid, None)

        game_id = state.sid_to_game.get(sid)
        game = state.games.get(game_id) if game_id else None
        if game:
            if game["state"] == "active":
                winner = "black" if sid == game["white"] else "white"
                end_game(game_id, {"type": "disconnect", "winner": winner})

            state.sid_to_game.pop(sid, None)
            opponent_sid = game["black"] if sid == game["white"] else game["white"]
            if state.sid_to_game.get(opponent_sid) == game_id:
                socketio.emit("rematchUnavailable", to=opponent_sid)
            else:
                state.games.pop(game_id, None)

    if waiting_changed:
        broadcast_waiting_list()
