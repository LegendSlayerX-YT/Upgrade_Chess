import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from psycopg2.extras import RealDictCursor

from db.connection import connect

ENERGY_REGEN_PER_HOUR = 1  # energy regenerated per hour of elapsed real time
ENERGY_MAX = 50  # hard cap; regen and grants never push energy above this

# Settle a row's energy: credit the energy accrued since `energy_updated_at`
# (ENERGY_REGEN_PER_HOUR per hour), clamp to ENERGY_MAX, and advance the
# timestamp to now(). Done in SQL so the calculation is atomic and uses a single
# clock (the database's). This is a SET-clause fragment for embedding in an
# UPDATE; the rate and cap are trusted integer constants, so inlining them
# carries no injection risk.
_SETTLE_ENERGY = (
    f"energy = LEAST({ENERGY_MAX}, energy + "
    "EXTRACT(EPOCH FROM (now() - energy_updated_at)) "
    f"/ 3600.0 * {ENERGY_REGEN_PER_HOUR}), "
    "energy_updated_at = now()"
)


@dataclass
class Currency:
    email: str
    white_tokens: int
    black_tokens: int
    energy: float  # stored as a float; only the integer part is shown to the UI
    # Settle time of `energy`. Populated only on the fetch path, where energy is
    # freshly settled to now() so its fraction maps cleanly to the next tick.
    energy_updated_at: Optional[datetime] = None

    def to_dict(self):
        return {
            "email": self.email,
            "whiteTokens": self.white_tokens,
            "blackTokens": self.black_tokens,
            # Energy is never negative (spends are gated on sufficiency), so a
            # plain truncation is the floor the UI should display.
            "energy": int(self.energy),
            "energyNextAt": self._next_integer_at(),
        }

    def _next_integer_at(self) -> Optional[str]:
        """ISO-8601 instant at which the displayed (floored) energy ticks up.

        Energy is settled to `energy_updated_at` on read, so the fraction left
        until the next whole point, divided by the regen rate, is the wait. We
        return an absolute instant so the client renders it correctly despite
        clock skew. None when no settle time is available (non-fetch paths)."""
        if self.energy_updated_at is None:
            return None
        # At the cap there is no next tick to wait for.
        if math.floor(self.energy) + 1 > ENERGY_MAX:
            return None
        remaining_units = (math.floor(self.energy) + 1) - self.energy
        next_at = self.energy_updated_at + timedelta(
            hours=remaining_units / ENERGY_REGEN_PER_HOUR
        )
        if next_at.tzinfo is None:
            next_at = next_at.replace(tzinfo=timezone.utc)
        return next_at.isoformat()


def _row_to_currency(row) -> Currency:
    return Currency(
        email=row["email"],
        white_tokens=row["white_tokens"],
        black_tokens=row["black_tokens"],
        energy=row["energy"],
        # Present only when the query selected it (the fetch path); other callers
        # leave it None so to_dict omits the next-tick estimate.
        energy_updated_at=row.get("energy_updated_at"),
    )


def fetch_currency(email: str) -> Optional[Currency]:
    """Settle the player's lazily-regenerating energy and return the result.

    Reading energy is a write: we credit the energy accrued since the last
    settle, persist the new float value, and advance the timestamp so the same
    elapsed time is never counted twice."""
    with connect() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                UPDATE players.currency_data
                SET {_SETTLE_ENERGY}
                WHERE email = %s
                RETURNING email, white_tokens, black_tokens, energy, energy_updated_at
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
                f"""
                UPDATE players.currency_data
                SET white_tokens = white_tokens + %s,
                    black_tokens = black_tokens + %s,
                    energy = LEAST({ENERGY_MAX}, energy + %s)
                WHERE email = %s
                RETURNING email, white_tokens, black_tokens, energy
                """,
                (white_tokens_delta, black_tokens_delta, energy_delta, email),
            )
            row = cur.fetchone()
    return _row_to_currency(row) if row else None


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
            # Settle both players' energy first so time accrued since their last
            # fetch counts toward the affordability check below.
            cur.execute(
                f"""
                UPDATE players.currency_data
                SET {_SETTLE_ENERGY}
                WHERE email IN (%s, %s)
                """,
                (email_a, email_b),
            )
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
