from typing import NamedTuple, Optional

from psycopg2.extras import RealDictCursor

from db.connection import connect
from db.currency import Currency, _row_to_currency

SLOT_TYPES = {
    "Ra": "r", "Nb": "n", "Bc": "b", "Q": "q", "K": "k",
    "Bf": "b", "Ng": "n", "Rh": "r",
    "Pa": "p", "Pb": "p", "Pc": "p", "Pd": "p",
    "Pe": "p", "Pf": "p", "Pg": "p", "Ph": "p",
}

UPGRADE_BASE_COST = {"p": 1, "n": 3, "b": 3, "r": 5, "q": 8}

MAX_LEVEL = 99


def upgrade_cost(piece_type: str, current_level: int) -> int:
    """Cost to upgrade from current_level to current_level + 1. Scales linearly."""
    return UPGRADE_BASE_COST[piece_type] * current_level


def downgrade_refund(piece_type: str, current_level: int) -> int:
    """Half (floor) of the cost paid to reach current_level from current_level - 1."""
    return upgrade_cost(piece_type, current_level - 1) // 2


class UpgradeResult(NamedTuple):
    currency: Currency
    new_level: int


def _empty_levels() -> dict:
    return {"w": {slot: 1 for slot in SLOT_TYPES}, "b": {slot: 1 for slot in SLOT_TYPES}}


def fetch_levels(email: str) -> dict:
    """Return {'w': {slot: level}, 'b': {slot: level}} with defaults of 1 for missing rows."""
    out = _empty_levels()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT color, slot, level FROM players.piece_levels WHERE email = %s",
                (email,),
            )
            for color, slot, level in cur.fetchall():
                if color in out and slot in out[color]:
                    out[color][slot] = level
    return out


def upgrade_piece(email: str, color: str, slot: str) -> Optional[UpgradeResult]:
    """Atomically deduct upgrade cost from currency and increment the slot's level.

    Returns None if the slot is not upgradable, the player has insufficient currency,
    or the slot is already at MAX_LEVEL.
    """
    if color not in ("w", "b"):
        return None
    piece_type = SLOT_TYPES.get(slot)
    if piece_type is None or piece_type == "k":
        return None
    token_column = "white_tokens" if color == "w" else "black_tokens"

    with connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT email, white_tokens, black_tokens, energy
                FROM players.currency_data
                WHERE email = %s
                FOR UPDATE
                """,
                (email,),
            )
            currency_row = cur.fetchone()
            balance = currency_row[token_column] if currency_row else 0

            cur.execute(
                "SELECT level FROM players.piece_levels WHERE email = %s AND color = %s AND slot = %s FOR UPDATE",
                (email, color, slot),
            )
            level_row = cur.fetchone()
            current_level = level_row["level"] if level_row else 1
            if current_level >= MAX_LEVEL:
                return None
            cost = upgrade_cost(piece_type, current_level)
            if balance < cost:
                return None
            new_level = current_level + 1

            cur.execute(
                f"""
                UPDATE players.currency_data
                SET {token_column} = {token_column} - %s
                WHERE email = %s
                RETURNING email, white_tokens, black_tokens, energy
                """,
                (cost, email),
            )
            currency_row = cur.fetchone()

            cur.execute(
                """
                INSERT INTO players.piece_levels (email, color, slot, level)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (email, color, slot)
                DO UPDATE SET level = EXCLUDED.level
                """,
                (email, color, slot, new_level),
            )

    return UpgradeResult(currency=_row_to_currency(currency_row), new_level=new_level)


def downgrade_piece(email: str, color: str, slot: str) -> Optional[UpgradeResult]:
    """Atomically decrement the slot's level and refund half the upgrade cost.

    Returns None if the slot is not downgradable or the slot is already at level 1.
    """
    if color not in ("w", "b"):
        return None
    piece_type = SLOT_TYPES.get(slot)
    if piece_type is None or piece_type == "k":
        return None
    token_column = "white_tokens" if color == "w" else "black_tokens"

    with connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT email, white_tokens, black_tokens, energy
                FROM players.currency_data
                WHERE email = %s
                FOR UPDATE
                """,
                (email,),
            )
            currency_row = cur.fetchone()
            if currency_row is None:
                return None

            cur.execute(
                "SELECT level FROM players.piece_levels WHERE email = %s AND color = %s AND slot = %s FOR UPDATE",
                (email, color, slot),
            )
            level_row = cur.fetchone()
            current_level = level_row["level"] if level_row else 1
            if current_level <= 1:
                return None
            new_level = current_level - 1
            refund = downgrade_refund(piece_type, current_level)

            cur.execute(
                f"""
                UPDATE players.currency_data
                SET {token_column} = {token_column} + %s
                WHERE email = %s
                RETURNING email, white_tokens, black_tokens, energy
                """,
                (refund, email),
            )
            currency_row = cur.fetchone()

            cur.execute(
                """
                INSERT INTO players.piece_levels (email, color, slot, level)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (email, color, slot)
                DO UPDATE SET level = EXCLUDED.level
                """,
                (email, color, slot, new_level),
            )

    return UpgradeResult(currency=_row_to_currency(currency_row), new_level=new_level)
