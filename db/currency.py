from dataclasses import dataclass
from typing import Optional

from psycopg2.extras import RealDictCursor

from db.connection import connect


@dataclass
class Currency:
    email: str
    white_tokens: int
    black_tokens: int
    energy: int

    def to_dict(self):
        return {
            "email": self.email,
            "whiteTokens": self.white_tokens,
            "blackTokens": self.black_tokens,
            "energy": self.energy,
        }


def _row_to_currency(row) -> Currency:
    return Currency(
        email=row["email"],
        white_tokens=row["white_tokens"],
        black_tokens=row["black_tokens"],
        energy=row["energy"],
    )


def fetch_currency(email: str) -> Optional[Currency]:
    with connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT email, white_tokens, black_tokens, energy
                FROM players.currency_data
                WHERE email = %s
                """,
                (email,),
            )
            row = cur.fetchone()
    return _row_to_currency(row) if row else None


def change_currency(
    email: str,
    white_tokens_delta: int,
    black_tokens_delta: int,
    energy_delta: int,
) -> Optional[Currency]:
    with connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE players.currency_data
                SET white_tokens = white_tokens + %s,
                    black_tokens = black_tokens + %s,
                    energy = energy + %s
                WHERE email = %s
                RETURNING email, white_tokens, black_tokens, energy
                """,
                (white_tokens_delta, black_tokens_delta, energy_delta, email),
            )
            row = cur.fetchone()
    return _row_to_currency(row) if row else None


def grant_energy_to_all(amount: int) -> int:
    """Add `amount` energy to every player (online or offline). Returns the
    number of rows updated."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE players.currency_data SET energy = energy + %s",
                (amount,),
            )
            return cur.rowcount


def spend_energy_from_pair(
    email_a: str,
    email_b: str,
    amount: int,
) -> Optional[dict]:
    """Atomically deduct `amount` energy from both players. Charges both or
    neither: if either lacks enough energy (or has no currency row), nothing is
    deducted. Returns a dict mapping email -> updated Currency on success, or
    None if the pair could not be charged."""
    with connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE players.currency_data
                SET energy = energy - %s
                WHERE email IN (%s, %s) AND energy >= %s
                RETURNING email, white_tokens, black_tokens, energy
                """,
                (amount, email_a, email_b, amount),
            )
            charged = {row["email"]: _row_to_currency(row) for row in cur.fetchall()}
            if set(charged) != {email_a, email_b}:
                conn.rollback()
                return None
    return charged


def award_tokens(email: str, color: str, amount: int) -> Currency:
    """Upsert currency row and credit `amount` to the given color's token pool."""
    if color not in ("w", "b"):
        raise ValueError("color must be 'w' or 'b'")
    white_delta = amount if color == "w" else 0
    black_delta = amount if color == "b" else 0
    with connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO players.currency_data (email, white_tokens, black_tokens, energy)
                VALUES (%s, %s, %s, 0)
                ON CONFLICT (email) DO UPDATE
                SET white_tokens = players.currency_data.white_tokens + EXCLUDED.white_tokens,
                    black_tokens = players.currency_data.black_tokens + EXCLUDED.black_tokens
                RETURNING email, white_tokens, black_tokens, energy
                """,
                (email, white_delta, black_delta),
            )
            row = cur.fetchone()
    return _row_to_currency(row)
