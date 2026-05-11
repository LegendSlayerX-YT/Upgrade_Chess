import os
from dataclasses import dataclass
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor


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


def _connect():
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "upgrade_chess_db"),
        user=os.environ.get("DB_USER"),
        password=os.environ.get("DB_PASSWORD"),
    )


def fetch_currency(email: str) -> Optional[Currency]:
    with _connect() as conn:
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
    if not row:
        return None
    return Currency(
        email=row["email"],
        white_tokens=row["white_tokens"],
        black_tokens=row["black_tokens"],
        energy=row["energy"],
    )


def change_currency(
    email: str,
    white_tokens_delta: int,
    black_tokens_delta: int,
    energy_delta: int,
) -> Optional[Currency]:
    with _connect() as conn:
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
    if not row:
        return None
    return Currency(
        email=row["email"],
        white_tokens=row["white_tokens"],
        black_tokens=row["black_tokens"],
        energy=row["energy"],
    )
