CREATE SCHEMA IF NOT EXISTS players;

CREATE TABLE IF NOT EXISTS players.currency_data (
    email             TEXT             PRIMARY KEY,
    white_tokens      INTEGER          NOT NULL DEFAULT 0,
    black_tokens      INTEGER          NOT NULL DEFAULT 0,
    -- Energy regenerates lazily (1 per hour). Stored as a float so partial
    -- hours accrue precisely; only the integer part is shown in the UI.
    energy            DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- When `energy` was last settled. On retrieval we credit the energy
    -- accrued since this instant and advance it to now().
    energy_updated_at TIMESTAMPTZ      NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'players.currency_data'::regclass
          AND contype = 'p'
    ) THEN
        ALTER TABLE players.currency_data ADD PRIMARY KEY (email);
    END IF;
END$$;

-- Migrate pre-existing currency_data rows to the lazy-regen model.
ALTER TABLE players.currency_data
    ADD COLUMN IF NOT EXISTS energy_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF (
        SELECT data_type
        FROM information_schema.columns
        WHERE table_schema = 'players'
          AND table_name = 'currency_data'
          AND column_name = 'energy'
    ) = 'integer' THEN
        ALTER TABLE players.currency_data
            ALTER COLUMN energy TYPE DOUBLE PRECISION;
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS players.piece_levels (
    email  TEXT    NOT NULL,
    color  CHAR(1) NOT NULL CHECK (color IN ('w', 'b')),
    slot   TEXT    NOT NULL,
    level  INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
    PRIMARY KEY (email, color, slot)
);
