-- Velora Pay schema (also executed automatically by src/db.js on boot)

CREATE TABLE IF NOT EXISTS shops (
  id                SERIAL PRIMARY KEY,
  shop_domain       TEXT UNIQUE NOT NULL,
  access_token      TEXT,
  scope             TEXT,
  stripe_user_id    TEXT,
  installed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id                SERIAL PRIMARY KEY,
  order_number      BIGINT UNIQUE NOT NULL,
  shop_domain       TEXT NOT NULL,
  product_title     TEXT,
  variant_id        TEXT,
  amount_cents      BIGINT NOT NULL,
  currency          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  stripe_account    TEXT,
  stripe_session_id TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at           TIMESTAMPTZ
);

-- Order numbers start at #67493 and increment by one for every payment link.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 67493;
