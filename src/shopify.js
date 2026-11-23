'use strict';

const crypto = require('crypto');

const API_VERSION = '2024-10';

function isValidShop(shop) {
  return typeof shop === 'string'
    && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
}

/**
 * Verify Shopify's HMAC on the OAuth callback.
 * Shopify signs the raw query string (minus hmac/signature), sorted by key.
 */
function verifyOAuthHmac(rawQuery, secret) {
  if (!secret) return false;

  const parts = String(rawQuery || '')
    .split('&')
    .filter(Boolean)
    .filter((p) => !/^hmac=/.test(p) && !/^signature=/.test(p))
    .sort();

  const digest = crypto
    .createHmac('sha256', secret)
    .update(parts.join('&'))
    .digest('hex');

  const given = (new URLSearchParams(rawQuery).get('hmac') || '').toLowerCase();
  if (digest.length !== given.length) return false;
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(given));
}

function authUrl(shop, state) {
  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    scope: process.env.SCOPES || 'read_products,write_script_tags',
    redirect_uri: `${process.env.APP_URL}/auth/callback`,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

async function exchangeCode(shop, code) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json(); // { access_token, scope }
}

async function adminApi(shop, token, path, options = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/${path}`, {
    ...options,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify API ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function getShopInfo(shop, token) {
  const data = await adminApi(shop, token, 'shop.json');
  return data.shop;
}

async function getVariant(shop, token, variantId) {
  const data = await adminApi(shop, token, `variants/${variantId}.json`);
  return data.variant;
}

async function getProduct(shop, token, productId) {
  const data = await adminApi(shop, token, `products/${productId}.json`);
  return data.product;
}

/**
 * Inject the Buy Now script into the storefront (idempotent).
 */
async function registerScriptTag(shop, token) {
  const src = `${process.env.APP_URL}/buy-now.js?shop=${encodeURIComponent(shop)}`;
  const existing = await adminApi(shop, token, 'script_tags.json');
  if ((existing.script_tags || []).some((t) => t.src === src)) return;
  await adminApi(shop, token, 'script_tags.json', {
    method: 'POST',
    body: JSON.stringify({ script_tag: { event: 'onload', src } }),
  });
}

module.exports = {
  isValidShop,
  verifyOAuthHmac,
  authUrl,
  exchangeCode,
  adminApi,
  getShopInfo,
  getVariant,
  getProduct,
  registerScriptTag,
};
