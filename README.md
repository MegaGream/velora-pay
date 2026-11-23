# Velora Pay

Shopify app that replaces the storefront **Add to Cart** with a **Buy Now** button.
Clicking it creates a **Stripe payment link** (Checkout Session) on the merchant's
connected Stripe account, with:

- the **product price** read server-side from Shopify (never trusted from the browser)
- a unique **order number** starting at **#67493**, incrementing by one per payment link
- the order number used as the **payment link title** (line-item name)

Built for a public Shopify app (OAuth, multiple merchants) with **Stripe Connect**
(each merchant connects their own Stripe account — direct charges).

---

## Architecture

```
Shopper clicks Buy Now
        │  POST /api/create-payment {shop, variantId, quantity}
        ▼
Node app (Railway)
  ├─ loads shop token from Postgres
  ├─ GET /admin/api/.../variants/{id}.json   → price
  ├─ GET /admin/api/.../products/{id}.json   → title
  ├─ SELECT nextval('order_number_seq')      → #67493, #67494, …
  ├─ Stripe Checkout Session (direct charge on connected account)
  └─ INSERT order row (status = pending)
        │  { url }
        ▼
Shopper pays on Stripe hosted checkout
        │  checkout.session.completed webhook
        ▼
Order marked paid in Postgres
```

---

## 1. Shopify Partner app

1. Create a [Shopify Partner account](https://partners.shopify.com) → **Apps → Create app → Create app manually**.
2. Name it (e.g. *Velora Pay*), set:
   - **App URL**: `https://YOUR-RAILWAY-DOMAIN/`
   - **Allowed redirection URL(s)**: `https://YOUR-RAILWAY-DOMAIN/auth/callback`
3. **API access scopes**: `read_products, write_script_tags`
4. Copy the **Client ID** and **Client secret**.
5. Distribution: **Custom distribution** (single store) or **Public distribution** (App Store — requires review).

> The app registers a ScriptTag on install; no theme edit is required.

## 2. Stripe Connect

1. In your Stripe Dashboard → **Connect → Settings**, enable Connect and copy the **client ID** (`ca_...`).
2. Add the redirect URI `https://YOUR-RAILWAY-DOMAIN/stripe/callback`.
3. Under **Connect → Webhooks**, add endpoint `https://YOUR-RAILWAY-DOMAIN/webhooks/stripe`
   with event `checkout.session.completed`; copy the signing secret (`whsec_...`).

## 3. Railway

1. Push this folder to a GitHub repo.
2. Railway → **New Project → Deploy from GitHub** (or `railway up` with the Railway CLI).
3. Add a **PostgreSQL** database to the project.
4. Set environment variables:

| Variable | Value |
|---|---|
| `SHOPIFY_API_KEY` | Partner app Client ID |
| `SHOPIFY_API_SECRET` | Partner app Client secret |
| `SCOPES` | `read_products,write_script_tags` |
| `APP_URL` | `https://YOUR-RAILWAY-DOMAIN` (no trailing slash) |
| `DATABASE_URL` | Railway provides it when you reference `${{Postgres.DATABASE_URL}}` |
| `STRIPE_SECRET_KEY` | platform Stripe secret key |
| `STRIPE_CONNECT_CLIENT_ID` | `ca_...` |
| `STRIPE_WEBHOOK_SECRET` | Connect webhook signing secret |

5. Generate a public domain (Railway → Settings → Networking → Generate Domain) and put it in `APP_URL`.
6. Go back to the Shopify Partner app settings and set the App URL / redirect URL to the Railway domain.

## 4. Install on a store

Open:

```
https://YOUR-RAILWAY-DOMAIN/auth?shop=your-store.myshopify.com
```

Approve the install, then open:

```
https://YOUR-RAILWAY-DOMAIN/admin?shop=your-store.myshopify.com
```

Click **Connect Stripe**, approve, and you're live. The storefront script is injected
automatically and the Add to Cart button becomes **Buy Now**.

---

## Testing locally

```bash
cp .env.example .env      # fill values
npm install
npm start                 # http://localhost:3000
```

For Shopify OAuth locally you need a public tunnel (e.g. `cloudflared tunnel` or `ngrok`)
and set `APP_URL` to the tunnel URL.

## How the order number works

A Postgres sequence seeded at `67493`:

```sql
CREATE SEQUENCE order_number_seq START WITH 67493;
SELECT nextval('order_number_seq');  -- 67493, 67494, 67495, …
```

Every payment link consumes one number, so numbers are unique but **not gap-free**
(abandoned checkouts still consume a number).

## Known limitations / warnings

- **Shopify checkout bypass.** Sending shoppers to Stripe instead of Shopify's checkout
  violates Shopify's terms for normal sales (their checkout is required unless your store
  qualifies for checkout extensibility). This can get the store suspended. Use at your own risk.
- **Taxes, shipping and discounts are not calculated.** The payment link is a single line
  item at the product price. Add Stripe Tax / shipping rates if needed.
- **No Shopify order is created.** Orders live in this app's Postgres table. If you need
  them in Shopify, add an Admin API `POST /orders.json` call after payment.
- **Inventory is not reserved** while the shopper pays.
- **Refunds** happen in the Stripe Dashboard of the connected account.
- For App Store distribution, Shopify requires the app to pass review (billing API,
  GDPR endpoints, webhooks, etc.) — this scaffold is a starting point, not a reviewed app.
