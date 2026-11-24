# Tarmac Time

A one-page site for [Tarmac Time](https://tarmactime.com), a letter, sent every other week, for pilots and aviation professionals in business aviation.

The page is static HTML and CSS. GitHub Pages serves it from the root of `main`. Joining the list posts to a Cloudflare Worker, which creates the beehiiv subscription. The API key and publication id are Worker secrets and are not in this repository.

## Worker URL

The form reads one constant at the top of `join.js`:

```javascript
var SIGNUP_ENDPOINT = "https://tarmactime-signup.YOUR-SUBDOMAIN.workers.dev/";
```

After `wrangler deploy`, replace `YOUR-SUBDOMAIN` with the workers.dev subdomain it prints.

## GitHub Pages

In the repository on GitHub, open Settings, then Pages.

- Source: Deploy from a branch
- Branch: `main`
- Folder: `/` (root)

`CNAME` sets the custom domain to `tarmactime.com`. After the DNS records below exist, turn on Enforce HTTPS.

## Worker

From the `worker` directory:

```bash
npx wrangler deploy
npx wrangler secret put BEEHIIV_API_KEY
npx wrangler secret put BEEHIIV_PUBLICATION_ID
```

The worker name in `worker/wrangler.toml` is `tarmactime-signup`. When the publication id prompt appears, enter:

```text
pub_90708af4-4ca0-4fe3-a057-1d9707d0aa06
```

`BEEHIIV_API_KEY` is a beehiiv key that can create subscriptions. Do not commit either value.

The worker sends `reactivate_existing: false`, `send_welcome_email: true`, `utm_source: tarmactime.com`, and `referring_site: https://tarmactime.com`. A first name is sent as `custom_fields: [{ name: "first_name", value }]`. A filled honeypot is ignored. Visitors see a short generic error, not beehiiv’s own message.

Browsers may call the worker only from `https://tarmactime.com` and `https://www.tarmactime.com`.

## DNS

These records belong at the DNS host. Nothing in this repository changes DNS.

Apex `A` records, all four:

- `185.199.108.153`
- `185.199.109.153`
- `185.199.110.153`
- `185.199.111.153`

`www` is a `CNAME` to `andrew-jb6.github.io`.

## Latest issue

`https://tarmactime.com/latest` is a short address for the newest published issue. GitHub Pages serves `latest/index.html`, which sends people to the Cloudflare Worker at `/latest`. The worker looks up the newest confirmed beehiiv post that is already live on the web and redirects there. If that lookup fails, it sends people to `https://tarmactime.beehiiv.com/`.

## Test

```bash
node --test worker/test/*.js
```

The tests mock `fetch`. They do not call beehiiv and do not subscribe an address.

## What’s on the page

Each issue carries three things:

- Business Aviation Update
- Pilot Jobs, sorted by low, middle, and high time
- Beyond the Cockpit
