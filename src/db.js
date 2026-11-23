'use strict';

const { Pool } = require('pg');

const isLocal =
  !process.env.DATABASE_URL
  || /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});

const SCHEMA = `
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

CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 67493;
`;

async function initDb() {
  await pool.query(SCHEMA);
}

async function getShop(shopDomain) {
  const { rows } = await pool.query(
    'SELECT * FROM shops WHERE shop_domain = $1',
    [shopDomain]
  );
  return rows[0] || null;
}

async function upsertShop(shopDomain, { accessToken, scope }) {
  const { rows } = await pool.query(
    `INSERT INTO shops (shop_domain, access_token, scope)
     VALUES ($1, $2, $3)
     ON CONFLICT (shop_domain)
     DO UPDATE SET access_token = EXCLUDED.access_token,
                   scope = EXCLUDED.scope,
                   updated_at = NOW()
     RETURNING *`,
    [shopDomain, accessToken, scope]
  );
  return rows[0];
}

async function setStripeAccount(shopDomain, stripeUserId) {
  const { rows } = await pool.query(
    `UPDATE shops
        SET stripe_user_id = $2, updated_at = NOW()
      WHERE shop_domain = $1
      RETURNING *`,
    [shopDomain, stripeUserId || null]
  );
  return rows[0] || null;
}

async function deleteShop(shopDomain) {
  await pool.query('DELETE FROM shops WHERE shop_domain = $1', [shopDomain]);
}

async function nextOrderNumber() {
  const { rows } = await pool.query("SELECT nextval('order_number_seq') AS n");
  return Number(rows[0].n);
}

async function createOrder(o) {
  const { rows } = await pool.query(
    `INSERT INTO orders
       (order_number, shop_domain, product_title, variant_id,
        amount_cents, currency, stripe_account, stripe_session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      o.orderNumber,
      o.shopDomain,
      o.productTitle || null,
      o.variantId || null,
      o.amountCents,
      o.currency,
      o.stripeAccount || null,
      o.stripeSessionId || null,
    ]
  );
  return rows[0];
}

async function markOrderPaid(sessionId, stripeAccount) {
  const { rows } = await pool.query(
    `UPDATE orders
        SET status = 'paid', paid_at = NOW()
      WHERE stripe_session_id = $1
        AND ($2::text IS NULL OR stripe_account = $2)
      RETURNING *`,
    [sessionId, stripeAccount || null]
  );
  return rows[0] || null;
}

module.exports = {
  pool,
  initDb,
  getShop,
  upsertShop,
  setStripeAccount,
  deleteShop,
  nextOrderNumber,
  createOrder,
  markOrderPaid,
};
