# Deploy in ~5 minutes (Railway)

## 1. Create the Railway project

1. Go to **https://railway.com/new**
2. Choose **Deploy from GitHub repo**
3. Authorize Railway for GitHub if asked, then pick **MegaGream/velora-pay**
   (if the repo isn't listed, click *Configure GitHub App* and grant access to the repo)

## 2. Add the database

In the project: **New → Database → Add PostgreSQL**

## 3. Set the variables

Open the app service → **Variables** tab → **Raw Editor** → paste:

```
SHOPIFY_API_KEY=a93fe37b1bec5e59f665db9de99fb1ac
SHOPIFY_API_SECRET=<paste the shpss_... secret from your local .env>
SCOPES=read_products,write_script_tags
APP_URL=https://REPLACE-WITH-YOUR-DOMAIN
DATABASE_URL=${{Postgres.DATABASE_URL}}
STRIPE_SECRET_KEY=
STRIPE_CONNECT_CLIENT_ID=
STRIPE_WEBHOOK_SECRET=
PORT=3000
```

Save. Railway redeploys automatically.

## 4. Generate the domain

Service → **Settings → Networking → Generate Domain** → copy it.

Update `APP_URL` to `https://<that-domain>` (no trailing slash) and save.

## 5. Point the Shopify app at it

In the Shopify Dev Dashboard app settings:

- **App URL**: `https://<that-domain>/`
- **Allowed redirection URL(s)**: `https://<that-domain>/auth/callback`

## 6. Install on the store

Open in a browser where you're logged into the store admin:

```
https://<that-domain>/auth?shop=xxpcnu-pk.myshopify.com
```

Approve. Then open:

```
https://<that-domain>/admin?shop=xxpcnu-pk.myshopify.com
```

Click **Connect Stripe** (needs the Stripe variables set first).

## 7. Stripe (needed for payments)

1. Stripe Dashboard → **Connect → Settings** → copy the **client ID** (`ca_...`)
2. Add redirect URI `https://<that-domain>/stripe/callback`
3. **Connect → Webhooks** → add `https://<that-domain>/webhooks/stripe` with event
   `checkout.session.completed` → copy the signing secret (`whsec_...`)
4. Put all three values in Railway variables and redeploy.

## Notes

- Order numbers start at **#67493** and increment per payment link.
- The payment link title is the order number; the price is read from Shopify.
- ⚠️ This app routes "Buy Now" to Stripe instead of Shopify checkout — see the warnings in README.md.
