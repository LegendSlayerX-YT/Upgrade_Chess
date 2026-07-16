import chess

from chess_app import state
from chess_app.chess_logic import (
    PAWN_FRONT_ABILITY_COOLDOWN_TURNS,
    PROMO_LETTER_TO_PIECE,
    apply_move_to_pieces,
    resolve_combat,
)
from chess_app.rooms import end_game


def _advance_turn_state(game, mover_color):
    board = game["board"]
    board.turn = not board.turn
    board.ep_square = None
    board.halfmove_clock = 0
    if mover_color == "b":
        board.fullmove_number += 1
        game["turn_cycle"] = game.get("turn_cycle", 0) + 1
    board.clear_stack()


def _emit_move_made(game, payload):
    state.socketio.emit("moveMade", payload, to=game["id"])


def _finish_game_if_needed(game, player_color):
    board = game["board"]
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
        end_game(game["id"], outcome)
        return True
    return False


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

    defender_piece_pre = None
    if move_info["is_capture"]:
        if move_info["is_en_passant"]:
            ep_rank = "5" if move_info["color"] == "w" else "4"
            defender_sq_pre = move_info["to"][0] + ep_rank
        else:
            defender_sq_pre = move_info["to"]
        defender_piece_pre = game["pieces"].get(defender_sq_pre)
    defender_king_died = (
        combat_result is not None
        and not combat_result["defender_survived"]
        and defender_piece_pre is not None
        and defender_piece_pre["type"] == "k"
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
        _advance_turn_state(game, move_info["color"])
        san_used = f"{move_info['from']}x{move_info['to']}†"
    elif move_info.get("is_stationary_capture"):
        from_sq = chess.parse_square(move_info["from"])
        to_sq = chess.parse_square(move_info["to"])
        if combat_result and combat_result["attacker_survived"]:
            board.remove_piece_at(to_sq)
        else:
            board.remove_piece_at(from_sq)
        _advance_turn_state(game, move_info["color"])
    elif attacker_died:
        from_sq = chess.parse_square(move_info["from"])
        board.remove_piece_at(from_sq)
        _advance_turn_state(game, move_info["color"])
        san_used = f"{move_info['from']}x{move_info['to']}†"
    else:
        board.push(candidate)
        if move_info["color"] == "b":
            game["turn_cycle"] = game.get("turn_cycle", 0) + 1

    game["pieces"] = apply_move_to_pieces(game["pieces"], move_info, combat_result)

    if game["draw_offer_by"]:
        game["draw_offer_by"] = None
        state.socketio.emit("drawOfferCleared", to=game_id)

    _emit_move_made(
        game,
        {
            "from": move_info["from"],
            "to": move_info["to"],
            "promotion": move_info["promotion"],
            "san": san_used,
            "fen": board.fen(),
            "turn": "w" if board.turn == chess.WHITE else "b",
            "pieces": game["pieces"],
            "combat": combat_result,
            "is_en_passant": move_info.get("is_en_passant", False),
            "is_stationary_capture": move_info.get("is_stationary_capture", False),
            "turnCycle": game.get("turn_cycle", 0),
            "ability_used": False,
        },
    )

    if king_died_attacker:
        winner = "white" if attacker_piece["color"] == "b" else "black"
        end_game(game_id, {"type": "kingDeath", "winner": winner})
        return

    if defender_king_died:
        end_game(game_id, {"type": "kingDeath", "winner": player_color})
        return

    _finish_game_if_needed(game, player_color)


def commit_pawn_front_ability(game, from_alg, to_alg, player_color):
    board = game["board"]
    attacker = game["pieces"].get(from_alg)
    defender = game["pieces"].get(to_alg)
    if not attacker or not defender:
        return

    damage = min(attacker["dmg"], defender["hp"])
    defender_survived = defender["hp"] > damage
    pieces = dict(game["pieces"])

    attacker_after = dict(attacker)
    attacker_after["ability_ready_on_cycle"] = game.get("turn_cycle", 0) + PAWN_FRONT_ABILITY_COOLDOWN_TURNS
    pieces[from_alg] = attacker_after

    if defender_survived:
        defender_after = dict(defender)
        defender_after["hp"] = defender["hp"] - damage
        pieces[to_alg] = defender_after
    else:
        pieces.pop(to_alg, None)
        board.remove_piece_at(chess.parse_square(to_alg))

    _advance_turn_state(game, attacker["color"])
    game["pieces"] = pieces

    if game["draw_offer_by"]:
        game["draw_offer_by"] = None
        state.socketio.emit("drawOfferCleared", to=game["id"])

    _emit_move_made(
        game,
        {
            "from": from_alg,
            "to": to_alg,
            "promotion": None,
            "san": f"{from_alg}!{to_alg}",
            "fen": board.fen(),
            "turn": "w" if board.turn == chess.WHITE else "b",
            "pieces": game["pieces"],
            "combat": None,
            "is_en_passant": False,
            "is_stationary_capture": False,
            "turnCycle": game.get("turn_cycle", 0),
            "ability_used": True,
            "ability_damage": damage,
            "ability_killed": not defender_survived,
        },
    )

    if not defender_survived and defender["type"] == "k":
        end_game(game["id"], {"type": "kingDeath", "winner": player_color})
        return

    _finish_game_if_needed(game, player_color)
