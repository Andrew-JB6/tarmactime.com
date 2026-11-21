# Tarmac Time

A one-page site for [Tarmac Time](https://tarmactime.com), a weekly letter for pilots and aviation professionals in business aviation.

The page is static HTML and CSS. Joining the list happens on this site only. The form posts to `/api/subscribe`, and that Vercel function creates the subscription with beehiiv’s API. The API key stays on the server.

## Run locally

From this directory:

```bash
python3 -m http.server 41731
```

Then open http://127.0.0.1:41731

That serves the page. The signup function runs on Vercel, or locally with the Vercel CLI (`vercel dev`) once the environment variables below are set.

## Signup environment

Set both variables in the Vercel project. Do not commit the API key.

```
BEEHIIV_PUBLICATION_ID=pub_90708af4-4ca0-4fe3-a057-1d9707d0aa06
BEEHIIV_API_KEY=
```

`BEEHIIV_API_KEY` is a beehiiv API key with permission to create subscriptions. The function reads it only from the environment and sends it as `Authorization: Bearer …` to `POST https://api.beehiiv.com/v2/publications/{BEEHIIV_PUBLICATION_ID}/subscriptions`.

The request body uses beehiiv’s current field names: `email`, `reactivate_existing: false`, `send_welcome_email: true`, `utm_source: tarmactime.com`, `referring_site: https://tarmactime.com`, and, when a first name is given, `custom_fields: [{ name: "first_name", value }]`. The publication already has a `first_name` custom field. Unknown field names are ignored by beehiiv; this function does not pass beehiiv’s error text back to the visitor.

## Test

```bash
node --test
```

The test mocks `fetch`. It does not call beehiiv.

## Deploy

Connect the repository in Vercel and leave the framework preset on “Other”. Static files are served from the project root. `api/subscribe.js` is the serverless function. `vercel.json` sets cache and security headers.

Do not change DNS from the site files. Point tarmactime.com at the project in Vercel’s domain settings when you want the public domain to move.

## What’s on the page

Each week the letter carries three things:

- Business Aviation Update
- Pilot Jobs, sorted by low, middle, and high time
- Beyond the Cockpit
