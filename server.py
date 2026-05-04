import os
import secrets
import threading

import chess
from dotenv import load_dotenv
from flask import Flask, render_template
from flask_socketio import SocketIO, emit, join_room, leave_room
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

load_dotenv()

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
_google_request = google_requests.Request()

@app.route("/")
def index():
    return render_template("index.html", google_client_id=GOOGLE_CLIENT_ID)

PIECE_BASE = {
    "p": {"hp": 10, "dmg": 10},
    "n": {"hp": 10, "dmg": 10},
    "b": {"hp": 10, "dmg": 10},
    "r": {"hp": 10, "dmg": 10},
    "q": {"hp": 10, "dmg": 10},
    "k": {"hp": 10, "dmg": 1000000},
}

PIECE_LEVEL_MULT = {"p": 1, "n": 3, "b": 3, "r": 4, "q": 7, "k": 1}

SLOT_TO_START_SQUARE = {
    "Ra": "a1", "Nb": "b1", "Bc": "c1", "Q": "d1", "K": "e1",
    "Bf": "f1", "Ng": "g1", "Rh": "h1",
    "Pa": "a2", "Pb": "b2", "Pc": "c2", "Pd": "d2",
    "Pe": "e2", "Pf": "f2", "Pg": "g2", "Ph": "h2",
}
SLOT_TYPES = {
    "Ra": "r", "Nb": "n", "Bc": "b", "Q": "q", "K": "k",
    "Bf": "b", "Ng": "n", "Rh": "r",
    "Pa": "p", "Pb": "p", "Pc": "p", "Pd": "p",
    "Pe": "p", "Pf": "p", "Pg": "p", "Ph": "p",
}

PROMO_LETTER_TO_PIECE = {
    "q": chess.QUEEN, "r": chess.ROOK, "b": chess.BISHOP, "n": chess.KNIGHT,
}

waiting_sid = None
games = {}
sid_to_game = {}
pending_levels = {}
connected_sids = set()
sid_to_user = {}
state_lock = threading.RLock()

def display_name_for(sid):
    user = sid_to_user.get(sid)
    return user["name"] if user else "Guest"

def picture_for(sid):
    user = sid_to_user.get(sid)
    return (user or {}).get("picture")

def clamp_level(n):
    try:
        v = int(float(n))
    except (TypeError, ValueError):
        return 1
    if v < 1:
        return 1
    if v > 99:
        return 99
    return v

HP_TO_DMG_INC_RATIO = 1.5

def piece_stats(piece_type, level):
    base = PIECE_BASE[piece_type]
    mult = PIECE_LEVEL_MULT[piece_type]
    inc_dmg = base["dmg"] * mult
    inc_hp = int(inc_dmg * HP_TO_DMG_INC_RATIO)
    return {
        "hp": base["hp"] + (level - 1) * inc_hp,
        "dmg": base["dmg"] + (level - 1) * inc_dmg,
    }

def build_pieces(white_levels, black_levels):
    pieces = {}
    for slot, w_square in SLOT_TO_START_SQUARE.items():
        piece_type = SLOT_TYPES[slot]
        b_square = w_square[0] + ("8" if w_square[1] == "1" else "7")

        if piece_type == "k":
            w_level = 1
            b_level = 1
        else:
            w_level = clamp_level((white_levels or {}).get(slot, 1))
            b_level = clamp_level((black_levels or {}).get(slot, 1))
        w_stats = piece_stats(piece_type, w_level)
        b_stats = piece_stats(piece_type, b_level)

        pieces[w_square] = {
            "id": "w" + slot, "type": piece_type, "color": "w",
            "level": w_level, "hp": w_stats["hp"], "dmg": w_stats["dmg"],
        }
        pieces[b_square] = {
            "id": "b" + slot, "type": piece_type, "color": "b",
            "level": b_level, "hp": b_stats["hp"], "dmg": b_stats["dmg"],
        }
    return pieces

def can_attack_king(board, candidate, target_sq):
    target = board.piece_at(target_sq)
    if not target or target.piece_type != chess.KING:
        return False
    board.set_piece_at(target_sq, chess.Piece(chess.QUEEN, target.color))
    legal = candidate in board.legal_moves
    board.set_piece_at(target_sq, target)
    return legal

def resolve_combat(attacker, defender):
    a_hp, d_hp = attacker["hp"], defender["hp"]
    a_dmg, d_dmg = attacker["dmg"], defender["dmg"]
    log = []
    safety = 0
    while a_hp > 0 and d_hp > 0 and safety < 1000:
        d_hp -= a_dmg
        log.append({"by": "attacker", "atk_hp": a_hp, "def_hp": max(d_hp, 0)})
        if d_hp <= 0:
            break
        a_hp -= d_dmg
        log.append({"by": "defender", "atk_hp": max(a_hp, 0), "def_hp": d_hp})
        safety += 1
    return {
        "attacker_survived": a_hp > 0,
        "defender_survived": d_hp > 0,
        "attacker_hp": max(a_hp, 0),
        "defender_hp": max(d_hp, 0),
        "log": log,
    }

def apply_move_to_pieces(pieces, move_info, combat_result=None):
    nxt = dict(pieces)
    mover = nxt.get(move_info["from"])
    if not mover:
        return nxt

    if move_info["is_capture"] and combat_result:
        if move_info["is_en_passant"]:
            ep_rank = "5" if move_info["color"] == "w" else "4"
            defender_sq = move_info["to"][0] + ep_rank
        else:
            defender_sq = move_info["to"]

        del nxt[move_info["from"]]
        if combat_result["attacker_survived"]:
            nxt.pop(defender_sq, None)
            survivor = dict(mover)
            survivor["hp"] = combat_result["attacker_hp"]
            if move_info["promotion"]:
                new_type = move_info["promotion"]
                stats = piece_stats(new_type, survivor["level"])
                survivor["type"] = new_type
                survivor["hp"] = stats["hp"]
                survivor["dmg"] = stats["dmg"]
            nxt[move_info["to"]] = survivor
        else:
            defender = pieces.get(defender_sq)
            if defender:
                survivor = dict(defender)
                survivor["hp"] = combat_result["defender_hp"]
                nxt[defender_sq] = survivor
        return nxt

    del nxt[move_info["from"]]

    if move_info["is_castle"]:
        rank = "1" if move_info["color"] == "w" else "8"
        rook_from = ("h" if move_info["is_kingside"] else "a") + rank
        rook_to = ("f" if move_info["is_kingside"] else "d") + rank
        rook = nxt.get(rook_from)
        if rook:
            del nxt[rook_from]
            nxt[rook_to] = rook

    if move_info["promotion"]:
        new_type = move_info["promotion"]
        stats = piece_stats(new_type, mover["level"])
        promoted = dict(mover)
        promoted["type"] = new_type
        promoted["hp"] = stats["hp"]
        promoted["dmg"] = stats["dmg"]
        nxt[move_info["to"]] = promoted
    else:
        nxt[move_info["to"]] = mover
    return nxt

def make_game_id():
    return secrets.token_hex(4)

def start_game(white_sid, black_sid):
    game_id = make_game_id()
    board = chess.Board()
    white_side = (pending_levels.get(white_sid) or {}).get("w", {})
    black_side = (pending_levels.get(black_sid) or {}).get("b", {})
    pending_levels.pop(white_sid, None)
    pending_levels.pop(black_sid, None)
    pieces = build_pieces(white_side, black_side)
    games[game_id] = {
        "id": game_id,
        "board": board,
        "pieces": pieces,
        "white": white_sid,
        "black": black_sid,
        "draw_offer_by": None,
        "state": "active",
        "rematch_requests": set(),
        "pending_capture": None,
    }
    sid_to_game[white_sid] = game_id
    sid_to_game[black_sid] = game_id
    socketio.server.enter_room(white_sid, game_id, namespace="/")
    socketio.server.enter_room(black_sid, game_id, namespace="/")
    white_name = display_name_for(white_sid)
    black_name = display_name_for(black_sid)
    white_pic = picture_for(white_sid)
    black_pic = picture_for(black_sid)
    games[game_id]["names"] = {"white": white_name, "black": black_name}
    socketio.emit(
        "paired",
        {
            "gameId": game_id, "color": "white", "fen": board.fen(), "pieces": pieces,
            "you": white_name, "opponent": black_name,
            "yourPicture": white_pic, "opponentPicture": black_pic,
        },
        to=white_sid,
    )
    socketio.emit(
        "paired",
        {
            "gameId": game_id, "color": "black", "fen": board.fen(), "pieces": pieces,
            "you": black_name, "opponent": white_name,
            "yourPicture": black_pic, "opponentPicture": white_pic,
        },
        to=black_sid,
    )

def pair(sid):
    global waiting_sid
    if waiting_sid == sid:
        return
    if waiting_sid and waiting_sid in connected_sids:
        opponent = waiting_sid
        waiting_sid = None
        white_is_opponent = secrets.randbelow(2) == 0
        if white_is_opponent:
            start_game(opponent, sid)
        else:
            start_game(sid, opponent)
    else:
        waiting_sid = sid
        socketio.emit("waiting", to=sid)

def end_game(game_id, payload):
    game = games.get(game_id)
    if not game or game["state"] != "active":
        return
    game["state"] = "ended"
    game["rematch_requests"] = set()
    socketio.emit("gameOver", payload, to=game_id)

def leave_ended_game(sid):
    game_id = sid_to_game.get(sid)
    if not game_id:
        return
    game = games.get(game_id)
    if not game or game["state"] != "ended":
        return
    sid_to_game.pop(sid, None)
    socketio.server.leave_room(sid, game_id, namespace="/")
    opponent_sid = game["black"] if sid == game["white"] else game["white"]
    if sid_to_game.get(opponent_sid) == game_id:
        socketio.emit("rematchUnavailable", to=opponent_sid)
    else:
        games.pop(game_id, None)

@socketio.on("connect")
def on_connect():
    from flask import request
    connected_sids.add(request.sid)

@socketio.on("authenticate")
def on_authenticate(payload):
    from flask import request
    sid = request.sid
    credential = (payload or {}).get("credential") if isinstance(payload, dict) else None
    if not credential:
        emit("authError", {"reason": "missing credential"})
        return
    try:
        info = id_token.verify_oauth2_token(
            credential, _google_request, GOOGLE_CLIENT_ID
        )
    except ValueError as e:
        emit("authError", {"reason": f"invalid token: {e}"})
        return
    name = info.get("name") or info.get("email") or "Player"
    with state_lock:
        sid_to_user[sid] = {
            "sub": info.get("sub"),
            "name": name,
            "email": info.get("email"),
            "picture": info.get("picture"),
        }
    emit("authenticated", {"name": name})

@socketio.on("findGame")
def on_find_game(payload):
    from flask import request
    sid = request.sid
    with state_lock:
        if sid not in sid_to_user:
            emit("authError", {"reason": "login required"})
            return
        if isinstance(payload, dict):
            levels_by_color = payload.get("levelsByColor")
            legacy_levels = payload.get("levels")
            if isinstance(levels_by_color, dict):
                cleaned = {"w": {}, "b": {}}
                for side in ("w", "b"):
                    src = levels_by_color.get(side) or {}
                    for slot in SLOT_TYPES:
                        cleaned[side][slot] = clamp_level(src.get(slot, 1))
                pending_levels[sid] = cleaned
            elif isinstance(legacy_levels, dict):
                same = {slot: clamp_level(legacy_levels.get(slot, 1)) for slot in SLOT_TYPES}
                pending_levels[sid] = {"w": dict(same), "b": dict(same)}
        leave_ended_game(sid)
        pair(sid)

def commit_move(game, candidate, move_info, san, player_color, combat_result=None):
    game_id = game["id"]
    board = game["board"]

    san_used = san
    attacker_piece = game["pieces"].get(move_info["from"])

    if move_info["is_capture"] and attacker_piece and combat_result is None:
        if move_info["is_en_passant"]:
            ep_rank = "5" if move_info["color"] == "w" else "4"
            defender_sq_alg = move_info["to"][0] + ep_rank
        else:
            defender_sq_alg = move_info["to"]
        defender_piece = game["pieces"].get(defender_sq_alg)
        if defender_piece:
            combat_result = resolve_combat(attacker_piece, defender_piece)

    attacker_died = bool(combat_result and not combat_result["attacker_survived"])
    is_king_attack = bool(move_info.get("is_king_attack"))
    king_died_attacker = attacker_died and attacker_piece and attacker_piece["type"] == "k"
    defender_king_died = (
        is_king_attack
        and combat_result is not None
        and not combat_result["defender_survived"]
    )

    if is_king_attack:
        from_sq = chess.parse_square(move_info["from"])
        to_sq = chess.parse_square(move_info["to"])
        attacker_chess_piece = board.piece_at(from_sq)
        if combat_result and combat_result["attacker_survived"]:
            board.remove_piece_at(from_sq)
            if move_info["promotion"] and attacker_chess_piece:
                promo_chess_type = PROMO_LETTER_TO_PIECE[move_info["promotion"]]
                board.set_piece_at(to_sq, chess.Piece(promo_chess_type, attacker_chess_piece.color))
            elif attacker_chess_piece:
                board.set_piece_at(to_sq, attacker_chess_piece)
        else:
            board.remove_piece_at(from_sq)
        board.turn = not board.turn
        board.ep_square = None
        board.halfmove_clock = 0
        if move_info["color"] == "b":
            board.fullmove_number += 1
        board.clear_stack()
        san_used = f"{move_info['from']}x{move_info['to']}†"
    elif attacker_died:
        from_sq = chess.parse_square(move_info["from"])
        board.remove_piece_at(from_sq)
        board.turn = not board.turn
        board.ep_square = None
        board.halfmove_clock = 0
        if move_info["color"] == "b":
            board.fullmove_number += 1
        board.clear_stack()
        san_used = f"{move_info['from']}x{move_info['to']}†"
    else:
        board.push(candidate)

    game["pieces"] = apply_move_to_pieces(game["pieces"], move_info, combat_result)

    if game["draw_offer_by"]:
        game["draw_offer_by"] = None
        socketio.emit("drawOfferCleared", to=game_id)

    socketio.emit(
        "moveMade",
        {
            "from": move_info["from"],
            "to": move_info["to"],
            "promotion": move_info["promotion"],
            "san": san_used,
            "fen": board.fen(),
            "turn": "w" if board.turn == chess.WHITE else "b",
            "pieces": game["pieces"],
            "combat": combat_result,
        },
        to=game_id,
    )

    if king_died_attacker:
        winner = "white" if attacker_piece["color"] == "b" else "black"
        end_game(game_id, {"type": "kingDeath", "winner": winner})
        return

    if defender_king_died:
        end_game(game_id, {"type": "kingDeath", "winner": player_color})
        return

    if board.is_game_over(claim_draw=True):
        if board.is_checkmate():
            outcome = {"type": "checkmate", "winner": player_color}
        elif board.is_stalemate():
            outcome = {"type": "stalemate"}
        elif board.is_repetition(3) or board.can_claim_threefold_repetition():
            outcome = {"type": "threefold"}
        elif board.is_insufficient_material():
            outcome = {"type": "insufficient"}
        elif board.can_claim_draw():
            outcome = {"type": "draw"}
        else:
            outcome = {"type": "over"}
        end_game(game_id, outcome)

@socketio.on("move")
def on_move(payload):
    from flask import request
    sid = request.sid
    with state_lock:
        game_id = sid_to_game.get(sid)
        game = games.get(game_id) if game_id else None
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
    from flask import request
    sid = request.sid
    with state_lock:
        game_id = sid_to_game.get(sid)
        game = games.get(game_id) if game_id else None
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
    from flask import request
    sid = request.sid
    with state_lock:
        game_id = sid_to_game.get(sid)
        game = games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        color = "white" if sid == game["white"] else "black"
        if not game["draw_offer_by"] or game["draw_offer_by"] == color:
            return
        game["draw_offer_by"] = None
        end_game(game_id, {"type": "agreement"})

@socketio.on("declineDraw")
def on_decline_draw():
    from flask import request
    sid = request.sid
    with state_lock:
        game_id = sid_to_game.get(sid)
        game = games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        color = "white" if sid == game["white"] else "black"
        if not game["draw_offer_by"] or game["draw_offer_by"] == color:
            return
        game["draw_offer_by"] = None
        socketio.emit("drawDeclined", to=game_id)

@socketio.on("duelStrike")
def on_duel_strike():
    from flask import request
    sid = request.sid
    with state_lock:
        game_id = sid_to_game.get(sid)
        game = games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        pending = game.get("pending_capture")
        if not pending:
            return

        if pending["turn"] == "attacker":
            if pending["attacker_sid"] != sid:
                return
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
    from flask import request
    sid = request.sid
    with state_lock:
        game_id = sid_to_game.get(sid)
        game = games.get(game_id) if game_id else None
        if not game or game["state"] != "active":
            return
        loser = "white" if sid == game["white"] else "black"
        winner = "black" if loser == "white" else "white"
        end_game(game_id, {"type": "resign", "winner": winner})

@socketio.on("requestRematch")
def on_request_rematch():
    from flask import request
    sid = request.sid
    with state_lock:
        game_id = sid_to_game.get(sid)
        game = games.get(game_id) if game_id else None
        if not game or game["state"] != "ended":
            return

        opponent_sid = game["black"] if sid == game["white"] else game["white"]
        opponent_still_in = (
            sid_to_game.get(opponent_sid) == game_id
            and opponent_sid in connected_sids
        )
        if not opponent_still_in:
            emit("rematchUnavailable")
            return

        game["rematch_requests"].add(sid)
        if opponent_sid in game["rematch_requests"]:
            new_white = game["black"]
            new_black = game["white"]
            sid_to_game.pop(game["white"], None)
            sid_to_game.pop(game["black"], None)
            socketio.server.leave_room(new_white, game_id, namespace="/")
            socketio.server.leave_room(new_black, game_id, namespace="/")
            games.pop(game_id, None)
            start_game(new_white, new_black)
        else:
            emit("rematchPending")
            socketio.emit("rematchRequested", to=opponent_sid)

@socketio.on("cancelRematch")
def on_cancel_rematch():
    from flask import request
    with state_lock:
        leave_ended_game(request.sid)

@socketio.on("disconnect")
def on_disconnect():
    from flask import request
    global waiting_sid
    sid = request.sid
    with state_lock:
        connected_sids.discard(sid)
        if waiting_sid == sid:
            waiting_sid = None
        pending_levels.pop(sid, None)
        sid_to_user.pop(sid, None)

        game_id = sid_to_game.get(sid)
        if not game_id:
            return
        game = games.get(game_id)
        if not game:
            return

        if game["state"] == "active":
            winner = "black" if sid == game["white"] else "white"
            end_game(game_id, {"type": "disconnect", "winner": winner})

        sid_to_game.pop(sid, None)
        opponent_sid = game["black"] if sid == game["white"] else game["white"]
        if sid_to_game.get(opponent_sid) == game_id:
            socketio.emit("rematchUnavailable", to=opponent_sid)
        else:
            games.pop(game_id, None)

if __name__ == "__main__":
    port = int(os.environ.get("PORT"))
    print(f"ChessRPG server listening on http://localhost:{port}")
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)
