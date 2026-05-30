import chess

import db

PIECE_BASE = {
    "p": {"hp": 10, "dmg": 10},
    "n": {"hp": 10, "dmg": 10},
    "b": {"hp": 10, "dmg": 10},
    "r": {"hp": 10, "dmg": 10},
    "q": {"hp": 10, "dmg": 10},
    "k": {"hp": 10, "dmg": 1000000},
}

PIECE_LEVEL_MULT = {"p": 1, "n": 2, "b": 2, "r": 3, "q": 4, "k": 1}

SLOT_TO_START_SQUARE = {
    "Ra": "a1", "Nb": "b1", "Bc": "c1", "Q": "d1", "K": "e1",
    "Bf": "f1", "Ng": "g1", "Rh": "h1",
    "Pa": "a2", "Pb": "b2", "Pc": "c2", "Pd": "d2",
    "Pe": "e2", "Pf": "f2", "Pg": "g2", "Ph": "h2",
}
SLOT_TYPES = db.SLOT_TYPES

WIN_REWARD_TOKENS = 10

# Energy each player must pay to start a game (matchmaking or rematch).
GAME_ENERGY_COST = 5

HP_TO_DMG_INC_RATIO = 1.5

PROMO_LETTER_TO_PIECE = {
    "q": chess.QUEEN, "r": chess.ROOK, "b": chess.BISHOP, "n": chess.KNIGHT,
}


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
