> Local testing now uses `npm run local`: no account setup is required. This guide describes the retained password adapter. The selected product direction is Google sign-in plus owner approval; that new flow remains to be implemented. See [local setup](local-setup.md).

# Invite-only email and password authentication

The standalone deployment uses Supabase Auth to verify passwords and email addresses. AICD forwards credentials over HTTPS and does not store passwords, implement password hashing, or expose Supabase session tokens to browser JavaScript. Workspace membership and document access remain in AICD's Cloudflare D1 database.

This adapter has automated tests with synthetic identities and mocked provider responses. A real Supabase project, email delivery, invitation, recovery and deployed login have not been tested or configured in this source package.

## Keep the deployment modes explicit

| Setting | Behavior |
| --- | --- |
| `AICD_AUTH_MODE=supabase` | Standalone email/password authentication; ChatGPT identity headers are ignored. Missing provider configuration denies access. |
| Absent, `unconfigured`, or obsolete `sites` | Access is denied; there is no hosting-gateway or simulated-login fallback. |
| `AICD_AUTH_MODE=local` | Accepted only by the development-only loopback launcher and its internal request proof; unavailable in production. See the local setup guide. |
| Any other value | Authentication fails closed. |

The standalone build explicitly selects Supabase mode. A generic build stays unconfigured and denies data access. Local single-user access exists only through the dedicated development launcher. Google identity, AICD approval, Gmail mailbox permission and the later ECUS connection will remain separate authorization steps.

## Configure the provider and runtime

1. Create a dedicated Supabase project. Enable email/password authentication, disable **Allow new users to sign up**, enable **Confirm Email**, and disable anonymous sign-in. There is no AICD signup endpoint. Supabase explains these controls in its [general configuration guide](https://supabase.com/docs/guides/auth/general-configuration).
2. Configure production SMTP and a sender you control. Configure the exact HTTPS application origin as the Supabase Site URL. Use the email templates below. Public signup must stay disabled even though AICD also checks its private membership list.
3. Set an appropriate provider password policy; the AICD setup form requires 12–128 characters. Keep the default one-hour access-token lifetime or a shorter tested value. Supabase owns refresh-token rotation and session limits; see [password security](https://supabase.com/docs/guides/auth/password-security) and [session settings](https://supabase.com/docs/guides/auth/sessions).
4. Set these server-side Worker values using the secret prompts described in [standalone setup](standalone-setup.md): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `AICD_OWNER_EMAIL`. `SUPABASE_URL` must be an HTTPS project origin with no path. `SUPABASE_ANON_KEY` accepts the project publishable key (`sb_publishable_…`) or legacy `anon` JWT. Service-role and secret API keys are rejected. The owner email is an explicit bootstrap identity, not a domain-wide invitation.
5. Apply both D1 migrations before authentication is used. `0001_classy_wrecking_crew.sql` adds atomic rate counters and short-lived password-recovery proofs. It does not alter existing memberships.

No keys belong in `VITE_…`, `NEXT_PUBLIC_…`, tracked source, chat messages, or the infrastructure JSON. Local values belong in ignored `.dev.vars`. A local browser must use HTTPS for real login: the server does not relax Secure cookies for HTTP development. Ordinary HTTP preview can display the interface but cannot establish an email session.

## Invitation and recovery templates

Set the Supabase **Invite user** email template to contain a link such as:

```html
<a href="{{ .SiteURL }}/auth/callback#token_hash={{ .TokenHash }}&amp;type=invite">Set up your AICD account</a>
```

Set the **Reset password** template to contain:

```html
<a href="{{ .SiteURL }}/auth/callback#token_hash={{ .TokenHash }}&amp;type=recovery">Reset your AICD password</a>
```

Use these custom links instead of the default confirmation URL. Supabase supports constructing links with [TokenHash in email templates](https://supabase.com/docs/guides/auth/auth-email-templates). The fragment stays out of the HTTP request URL. AICD removes it from the address bar, applies a no-referrer policy and waits for the user to confirm before submitting the token to `/api/auth/verify`. Loading the page alone does not consume a one-time link, which avoids consumption by ordinary email link scanners.

Treat the complete link as a credential. Do not include it in screenshots, analytics, support logs or third-party link trackers.

## First owner and invited teammates

For a new, empty D1 database, invite the configured owner email from the Supabase dashboard. Open that account's invitation, confirm the link and set the password. The first workspace request creates the owner workspace only after the provider has verified that exact email address.

The retained standalone adapter requires an owner-granted application membership and a separate Supabase invitation to the same address. The owner-only `/api/team` endpoint remains, but its old Settings controls have been removed. The selected Google/owner-approval interface is not implemented yet. Granting application membership does not send email or create a provider account. An account needs both provider verification and application membership. A verified address can claim an owner-created pending membership whose `user_id` is empty. Existing linked memberships cannot be claimed by another provider identity.

Forgotten-password requests produce a generic response. A recovery link does not bypass the workspace allowlist. After a valid invite or recovery link, AICD records a ten-minute, one-use proof tied to the exact session token and user. The password endpoint requires that proof. A normal signed-in session cannot call it without a fresh invitation or recovery verification. If a proof expires, is consumed, or the password update fails, request a new link.

## Existing Sites data requires an explicit migration

Email equality never transfers an existing linked identity. Supabase actor IDs are stored as `supabase:<provider-user-uuid>`; Sites actor IDs are different. An owner matching `AICD_OWNER_EMAIL` also cannot bootstrap a replacement workspace over an existing database.

Before migrating existing records, export and back up D1 plus the corresponding private R2 originals. Review a mapping of each existing member identity to a verified account in the intended Supabase project. Apply an explicit, scoped migration of `workspace_members.user_id` and, for owners, `workspaces.owner_id`; preserve workspace IDs, state JSON, document object keys and historical audit entries. Verify the number of changed rows and access for each mapped account. The source package does not automatically export live records or perform this identity migration.

## Session and request controls

All workspace reads, writes and downloads authenticate on the server. Standalone requests validate the access token against Supabase `/user`, require a confirmed email and check membership. Browser cookies are `__Host-` scoped, `HttpOnly`, `Secure`, `SameSite=Lax`, with `Path=/` and no Domain attribute. The access cookie follows the provider expiry; the refresh cookie has a sliding 30-day browser lifetime. Provider session policy remains authoritative. This server-only API arrangement intentionally differs from a browser Supabase SDK flow; see [Supabase's server-side guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide).

Authentication POSTs require same-origin HTTPS, JSON bodies limited to 8 KiB and bounded fields. Tokens and passwords are not returned in JSON. Responses are private and non-cacheable. Login uses D1 atomic limits per IP and normalized email, in addition to [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits). AICD handles its IP limits locally; it does not require a privileged Supabase key for IP forwarding.

Session refresh is an explicit POST; the browser retries a failed authenticated request once after a successful refresh. Logout clears the browser credentials and attempts to revoke the current provider session. Provider outage can prevent remote revocation. An already issued access JWT may remain valid until its expiry; configure its lifetime accordingly.

Before client use, test an invited account, an uninvited account, an unconfirmed address, expired/reused links, password recovery, refresh, logout, a removed membership, cross-origin writes, and private document downloads in the configured HTTPS deployment. Confirm that provider mail templates use the final application origin and that public signup remains disabled.
