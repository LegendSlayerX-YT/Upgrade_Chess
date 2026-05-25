CREATE SCHEMA IF NOT EXISTS players;

CREATE TABLE IF NOT EXISTS players.currency_data (
    email         TEXT    PRIMARY KEY,
    white_tokens  INTEGER NOT NULL DEFAULT 0,
    black_tokens  INTEGER NOT NULL DEFAULT 0,
    energy        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS players.piece_levels (
    email  TEXT    NOT NULL,
    color  CHAR(1) NOT NULL CHECK (color IN ('w', 'b')),
    slot   TEXT    NOT NULL,
    level  INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
    PRIMARY KEY (email, color, slot)
);
