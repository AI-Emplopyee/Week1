# AICD with email/password and Kimi

The downloadable source belongs to you and can run in your own Cloudflare account. The current private `chatgpt.site` preview uses its hosting platform's ChatGPT sign-in layer. Adding a password form inside that preview would not remove the outer sign-in requirement. Standalone mode uses Supabase Auth and does not trust ChatGPT identity headers.

## What is in the download

`AICD-source.zip` contains application code, database migrations, tests, bundled OCR/font assets, synthetic fixtures, documentation and a SHA-256 file manifest. Unzip it, enter the `aicd` directory and run `npm ci` with Node.js 22.13 or newer. Installed dependencies, local databases, uploaded client files and credentials are excluded. The live site's database and original uploads are separate from source code; this ZIP is not a backup of live shipment records.

## Accounts to connect

1. A Cloudflare account for the application, D1 database and private R2 document storage.
2. A Supabase project for invite-only email/password identity. Supabase handles password hashing and verification; AICD does not save passwords in its database.
3. Your Moonshot international API key, plus the exact model ID available to your account, when you want to enable Kimi. No Kimi request is made while these are absent.

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

The standalone build sets `AICD_AUTH_MODE=supabase` and disables the local simulated ChatGPT identity. `npm run check:standalone` performs a Wrangler dry run without deployment. `npm run deploy:standalone` builds again and deploys to your Cloudflare account; it does not create those resources for you.

Apply migrations to the new database before using the application:

```sh
npx wrangler d1 migrations apply aicd-db --remote --config dist/server/wrangler.json
```

Do not point these commands at the existing Sites database or bucket. The standalone installation is separate. Migrating existing workspaces requires an explicit data export and verified identity mapping; matching email addresses alone must not take over existing memberships.

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

The first Kimi integration proposes factual header fields from text only; it does not extract goods rows or interpret images. A reviewer chooses a document and pages and confirms sending that text to Moonshot international. The server supplies the secret, limits the request and validates the returned proposals against exact source quotes. Local OCR still runs locally. Every AI proposal requires review. The application never gives the model authority to approve a declaration, assign customs decisions, send email or transmit to ECUS.

Enabling the API does not establish that Moonshot's processing/retention terms meet every client's requirements. Review the terms relevant to your account before choosing to send confidential shipment text. No real shipment has been sent to Kimi during development, and a successful mock test does not establish live model accuracy.

## References

- [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Kimi API quickstart](https://platform.kimi.ai/docs/overview)
