'use strict';

const Stripe = require('stripe');

let stripeClient = null;

function client() {
  if (!stripeClient) {
    stripeClient = new Stripe(
      process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder',
      { apiVersion: '2024-06-20' }
    );
  }
  return stripeClient;
}

/** Stripe Connect (Standard accounts) authorization URL. */
function connectUrl(shop, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.STRIPE_CONNECT_CLIENT_ID || '',
    scope: 'read_write',
    state,
    redirect_uri: `${process.env.APP_URL}/stripe/callback`,
  });
  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
}

async function exchangeConnectCode(code) {
  return client().oauth.token({
    grant_type: 'authorization_code',
    code,
  });
}

async function deauthorize(stripeUserId) {
  return client().oauth.deauthorize({
    client_id: process.env.STRIPE_CONNECT_CLIENT_ID,
    stripe_user_id: stripeUserId,
  });
}

/**
 * Create a Stripe Checkout Session as a DIRECT charge on the connected
 * account, with the order number as the line-item title.
 */
async function createCheckout({
  stripeAccount,
  currency,
  amountCents,
  orderNumber,
  productTitle,
  successUrl,
  cancelUrl,
  metadata,
}) {
  return client().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: String(currency).toLowerCase(),
            unit_amount: amountCents,
            product_data: {
              name: `#${orderNumber}`,
              description: productTitle
                ? String(productTitle).slice(0, 400)
                : undefined,
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: metadata || {},
    },
    { stripeAccount }
  );
}

function verifyWebhook(payload, signature, secret) {
  return client().webhooks.constructEvent(payload, signature, secret);
}

module.exports = {
  client,
  connectUrl,
  exchangeConnectCode,
  deauthorize,
  createCheckout,
  verifyWebhook,
};
