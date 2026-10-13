# Retained standalone adapter: deployment reference

**For testing on your Mac now, use [local setup](local-setup.md) and `npm run local`. None of the cloud accounts or deployment commands below is required. This guide is retained for a future explicitly requested deployment.**

The intended product uses Google sign-in and owner-approved access requests. Those flows are not implemented yet. This document covers the existing Supabase password adapter retained during the structural cleanup. The source now uses an application-owned Worker; Sites/ChatGPT hosting and login code have been removed. This cleanup does not deploy or change any previously hosted installation.

## What is in the download

`AICD-source.zip` contains application code, database migrations, tests, PDFium rendering/font assets, synthetic fixtures, documentation and a SHA-256 file manifest. Unzip it, enter the `aicd` directory and run `npm ci` with Node.js 22.13 or newer. Installed dependencies, local databases, uploaded client files and credentials are excluded. The live site's database and original uploads are separate from source code; this ZIP is not a backup of live shipment records.

## Accounts to connect

1. A Cloudflare account for the application, D1 database and private R2 document storage.
2. A Supabase project for invite-only email/password identity. Supabase handles password hashing and verification; AICD does not save passwords in its database.
3. Your Moonshot International API key when you want to enable Kimi. The default model is `kimi-k2.6`; an optional `MOONSHOT_MODEL` override must name a vision-capable model available to your account. No Kimi request is made while the key is absent.

You can develop locally without deploying a public endpoint. Real email/password actions require HTTPS, including during testing; the plain HTTP loopback preview cannot complete real login. Use an HTTPS staging deployment to test provider login and email delivery.

## Create the deployment configuration

Sign in to your own Cloudflare account using the official Wrangler flow, then provision a new database and bucket:

```sh
npx wrangler login
npx wrangler d1 create aicd-db
npx wrangler r2 bucket create aicd-documents
```

Copy `aicd.standalone.example.json` to `aicd.standalone.json`, set the database ID returned by Cloudflare, and confirm the resource names. That file contains infrastructure names only. Do not put keys or passwords in it.

```sh
npm ci
npm test
npm run typecheck
npm run build:standalone
```

The standalone build sets `AICD_AUTH_MODE=supabase` and excludes local single-user access. `npm run check:standalone` performs a Wrangler dry run without deployment. `npm run deploy:standalone` builds again and deploys to your Cloudflare account; it does not create those resources for you.

Apply migrations to the new database before using the application:

```sh
npx wrangler d1 migrations apply aicd-db --remote --config dist/server/wrangler.json
```

Use dedicated resources for this installation; do not overwrite another deployment’s database or bucket. The standalone installation is separate. Migrating existing workspaces requires an explicit data export and verified identity mapping; matching email addresses alone must not take over existing memberships.

## Configure secrets

For local development, copy `.dev.vars.example` to `.dev.vars` and enter values locally. The populated file is ignored by Git and excluded from source exports. Start with `npm run dev:standalone`; it binds to loopback.

For production, configure secrets in the Cloudflare dashboard, or use Wrangler's interactive prompts after building. Do not put the value on the command line:

```sh
npx wrangler secret put SUPABASE_URL --config dist/server/wrangler.json
npx wrangler secret put SUPABASE_ANON_KEY --config dist/server/wrangler.json
npx wrangler secret put AICD_OWNER_EMAIL --config dist/server/wrangler.json
npx wrangler secret put MOONSHOT_API_KEY --config dist/server/wrangler.json
npx wrangler secret put MOONSHOT_MODEL --config dist/server/wrangler.json
```

The Supabase anon/publishable key identifies the project; it is not a service-role/admin key. Do not supply a service-role key. The Kimi key is a billable secret and must remain server-side. Neither belongs in a `VITE_` or `NEXT_PUBLIC_` variable.

## Login safety and remaining setup

Invite-only access is enforced in the application as well as Supabase. Disable public signups in Supabase, require confirmed email addresses, set an appropriate password policy, configure production email delivery, and use HTTPS. Review `docs/authentication.md` for the invitation, recovery templates and owner setup flow once configured.

The adapter uses provider-verified identities, protected cookies, same-origin mutation checks and login throttling. Those controls reduce risk; they are not a security certification. Real provider login, email delivery, recovery, deployment and authorization must be checked in your configured environment before client use. MFA support is a future enhancement to the current password login flow.

## Kimi document processing

Kimi is the only document extractor. The browser uses PDFium to render authenticated PDF pages into images, without extracting text or running OCR; the server supplies the Kimi secret and sends those bounded page images. Text-based source files use a Kimi text request. The response contains factual header and commercial goods candidates with source evidence. Ordinary application code validates and reconciles those candidates before filling an editable web draft. Users have no AI provider settings. The application never gives the model authority to approve a declaration, assign customs decisions, send email or transmit to ECUS. See [Kimi vision extraction](kimi-vision.md) for the data flow and limitations.

Without a key, originals are preserved and wait for Kimi; there is no PDF.js or OCR fallback. Enabling the API sends confidential page images and text to Moonshot under the terms of your account. Setup requires a private server secret, never a browser environment variable. The implementation is tested with mocked provider responses; those tests do not establish live model accuracy. Keep the browser open during the current extraction workflow; there is no durable background worker for processing after the browser closes.

## References

- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Kimi API quickstart](https://platform.kimi.ai/docs/overview)
