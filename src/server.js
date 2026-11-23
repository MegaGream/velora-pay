'use strict';

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');

const db = require('./db');
const shopify = require('./shopify');
const stripe = require('./stripe');

const app = express();
const APP_URL = (process.env.APP_URL || '').replace(/\/+$/, '');
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '')
    .split(';')
    .forEach((part) => {
      const i = part.indexOf('=');
      if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1));
    });
  return out;
}

function setCookie(res, name, value, maxAge = 600) {
  const secure = APP_URL.startsWith('https') ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

// Simple in-memory rate limit for the public payment endpoint.
const hits = new Map();
function rateLimited(ip, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  hits.set(ip, entry);
  return entry.count > limit;
}

// ---------------------------------------------------------------------------
// security headers
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ---------------------------------------------------------------------------
// health / landing / legal
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'velora-pay' });
});

app.get('/', (req, res) => {
  const shop = req.query.shop;
  if (shop && shopify.isValidShop(shop)) {
    return res.redirect(`/admin?shop=${encodeURIComponent(shop)}`);
  }
  res.type('html').send(
    '<!doctype html><html><head><meta charset="utf-8"><title>Velora Pay</title></head>' +
    '<body style="font-family:system-ui;padding:40px;max-width:720px;margin:auto">' +
    '<h1>Velora Pay</h1>' +
    '<p>Replaces your storefront&#39;s Add to Cart with a Stripe payment link. ' +
    'Each order gets a unique order number starting at #67493, used as the payment title.</p>' +
    '<p><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></p>' +
    '</body></html>'
  );
});

app.get('/privacy', (req, res) => {
  res.type('html').send(
    '<h1>Privacy</h1><p>We store the minimum data required to operate the app: the shop domain, ' +
    'an API access token, the connected Stripe account ID and order records. ' +
    'No customer card data is stored; payments are handled by Stripe.</p>'
  );
});

app.get('/terms', (req, res) => {
  res.type('html').send(
    '<h1>Terms</h1><p>Provided as-is. Merchants are responsible for compliance with Shopify ' +
    'and Stripe terms, taxes, refunds and consumer law.</p>'
  );
});

// ---------------------------------------------------------------------------
// Shopify OAuth
// ---------------------------------------------------------------------------

app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shopify.isValidShop(shop)) return badRequest(res, 'Invalid shop domain');
  const state = randomState();
  setCookie(res, 'oauth_state', state);
  res.redirect(shopify.authUrl(shop, state));
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { shop, code, state } = req.query;
    if (!shopify.isValidShop(shop)) return badRequest(res, 'Invalid shop domain');
    if (!code) return badRequest(res, 'Missing code');
    if (!shopify.verifyOAuthHmac(req.originalUrl.split('?')[1] || '', process.env.SHOPIFY_API_SECRET)) {
      return res.status(400).send('HMAC verification failed');
    }
    const cookieState = parseCookies(req).oauth_state;
    if (!state || !cookieState || cookieState !== state) {
      return res.status(400).send('State mismatch');
    }

    const token = await shopify.exchangeCode(shop, code);
    await db.upsertShop(shop, {
      accessToken: token.access_token,
      scope: token.scope,
    });

    // Inject the storefront script (best effort).
    await shopify
      .registerScriptTag(shop, token.access_token)
      .catch((err) => console.error('registerScriptTag:', err.message));

    res.redirect(`/admin?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    console.error('auth callback:', err);
    res.status(500).send('Install failed: ' + err.message);
  }
});

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

app.get('/admin', (req, res) => {
  const shop = req.query.shop;
  if (!shopify.isValidShop(shop)) return badRequest(res, 'Invalid shop domain');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/admin/data', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shopify.isValidShop(shop)) return badRequest(res, 'Invalid shop domain');
    const row = await db.getShop(shop);
    res.json({
      shop,
      installed: Boolean(row && row.access_token),
      stripeConnected: Boolean(row && row.stripe_user_id),
      stripeAccount: row ? row.stripe_user_id : null,
      scopes: row ? row.scope : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Stripe Connect
// ---------------------------------------------------------------------------

app.get('/stripe/connect', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shopify.isValidShop(shop)) return badRequest(res, 'Invalid shop domain');
    const row = await db.getShop(shop);
    if (!row || !row.access_token) return res.status(404).send('Shop not installed');

    const state = `${shop}:${randomState()}`;
    setCookie(res, 'stripe_state', state);
    res.redirect(stripe.connectUrl(shop, state));
  } catch (err) {
    res.status(500).send('Stripe connect failed: ' + err.message);
  }
});

app.get('/stripe/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.status(400).send('Stripe connection cancelled: ' + error);
    if (!code) return badRequest(res, 'Missing code');

    const expected = parseCookies(req).stripe_state;
    if (!state || !expected || expected !== state) {
      return res.status(400).send('State mismatch');
    }

    const shop = String(state).split(':')[0];
    if (!shopify.isValidShop(shop)) return badRequest(res, 'Invalid shop');

    const token = await stripe.exchangeConnectCode(code);
    await db.setStripeAccount(shop, token.stripe_user_id);

    res.redirect(`/admin?shop=${encodeURIComponent(shop)}&stripe=connected`);
  } catch (err) {
    console.error('stripe callback:', err);
    res.status(500).send('Stripe connection failed: ' + err.message);
  }
});

app.post('/stripe/disconnect', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const shop = req.body.shop;
    if (!shopify.isValidShop(shop)) return badRequest(res, 'Invalid shop domain');
    const row = await db.getShop(shop);
    if (row && row.stripe_user_id) {
      await stripe.deauthorize(row.stripe_user_id).catch(() => {});
      await db.setStripeAccount(shop, null);
    }
    res.redirect(`/admin?shop=${encodeURIComponent(shop)}`);
  } catch (err) {
    res.status(500).send('Disconnect failed: ' + err.message);
  }
});

// ---------------------------------------------------------------------------
// storefront API: create the Stripe payment link
// ---------------------------------------------------------------------------

app.options('/api/create-payment', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.post('/api/create-payment', express.json(), async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { shop, variantId, quantity } = req.body || {};
    if (!shopify.isValidShop(shop)) return badRequest(res, 'Invalid shop domain');
    if (!variantId) return badRequest(res, 'variantId is required');
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Too many requests' });

    const row = await db.getShop(shop);
    if (!row || !row.access_token) return res.status(404).json({ error: 'Shop not installed' });
    if (!row.stripe_user_id) return res.status(409).json({ error: 'Stripe account not connected' });

    const variant = await shopify.getVariant(shop, row.access_token, variantId);
    const product = await shopify.getProduct(shop, row.access_token, variant.product_id);
    const shopInfo = await shopify.getShopInfo(shop, row.access_token);

    const unitAmount = Math.round(parseFloat(variant.price) * 100);
    const currency = (shopInfo.currency || 'USD').toUpperCase();
    const qty = Math.min(Math.max(parseInt(quantity || '1', 10) || 1, 1), 99);

    if (!Number.isFinite(unitAmount) || unitAmount < 50) {
      return badRequest(res, 'Invalid product price');
    }

    const amountCents = unitAmount * qty;
    const orderNumber = await db.nextOrderNumber();

    const session = await stripe.createCheckout({
      stripeAccount: row.stripe_user_id,
      currency,
      amountCents,
      orderNumber,
      productTitle: `${product.title}${qty > 1 ? ` x${qty}` : ''}`,
      successUrl: `${APP_URL}/paid?order=${orderNumber}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `https://${shop}`,
      metadata: {
        order_number: String(orderNumber),
        shop,
        variant_id: String(variant.id),
        product_id: String(product.id),
      },
    });

    await db.createOrder({
      orderNumber,
      shopDomain: shop,
      productTitle: product.title,
      variantId: String(variant.id),
      amountCents,
      currency,
      stripeAccount: row.stripe_user_id,
      stripeSessionId: session.id,
    });

    res.json({ url: session.url, orderNumber });
  } catch (err) {
    console.error('create-payment:', err);
    res.status(500).json({ error: 'Could not create payment link' });
  }
});

// ---------------------------------------------------------------------------
// webhooks
// ---------------------------------------------------------------------------

app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.verifyWebhook(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('stripe webhook signature:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const order = await db.markOrderPaid(session.id, event.account || null);
      if (order) {
        console.log(`order #${order.order_number} paid on ${order.shop_domain}`);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('stripe webhook handler:', err);
    res.status(500).send('Webhook handler failed');
  }
});

// ---------------------------------------------------------------------------
// storefront script + receipt page
// ---------------------------------------------------------------------------

app.get('/buy-now.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, '..', 'public', 'buy-now.js'));
});

app.get('/paid', (req, res) => {
  const order = String(req.query.order || '').replace(/[^0-9]/g, '');
  res.type('html').send(
    '<!doctype html><html><head><meta charset="utf-8"><title>Payment received</title></head>' +
    '<body style="font-family:system-ui;padding:40px;max-width:640px;margin:auto;text-align:center">' +
    '<h1>Payment received</h1>' +
    `<p>Thank you. Your order number is <strong>#${order || '—'}</strong>.</p>` +
    '<p>You can close this page.</p></body></html>'
  );
});

// ---------------------------------------------------------------------------
// 404 / errors / boot
// ---------------------------------------------------------------------------

app.use((req, res) => res.status(404).send('Not found'));

app.use((err, req, res, next) => {
  console.error('unhandled:', err);
  res.status(500).send('Server error');
});

(async () => {
  try {
    await db.initDb();
    console.log('database ready');
  } catch (err) {
    console.error('database init failed:', err.message);
  }
  app.listen(PORT, () => console.log(`Velora Pay listening on port ${PORT}`));
})();
