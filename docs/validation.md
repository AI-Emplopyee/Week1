# Validation scope

## Evidence available

No existing repository was supplied. Six real shipment PDFs (55 pages) were supplied later and inspected locally. Their contents and derived results remain in ignored local storage; the deployed demo and tracked fixtures contain synthetic examples only. No broad extraction accuracy or real ECUS success metric is reported.

## Required software checks

The domain regression suite covers source/page provenance, classification and grouping, contradictory facts, safe normalization and ambiguity, duplicate inputs, manual review, unsupported/scan paths, replacement invalidation, immutable snapshots, archive/reopen, test connector failure/retry/idempotency and an empty regulatory engine.

The API validation suite exercises request limits, file signatures, action allowlists, same-origin checks and revision conflicts. Browser/API smoke tests cover persistent intake and the review path. Type checking and a production build verify the integrated application.

Run `npm test` for the actual executable test list. See the delivery notes for checks completed in the development environment. A passing synthetic test proves the checked behavior only; it does not establish general extraction or customs correctness.

## Not yet tested with real evidence

- Supplier layouts, scans, languages and missing-page patterns across real shipments.
- Extracted-field accuracy and wrong values that software failed to flag.
- Shipment grouping mistake rates and broker review time.
- An authorized live Gmail synchronization and its retention policy.
- Multi-person use under an explicitly configured shared Site audience.
- Real ECUS installation, real draft creation/read-back, transmission or registration.
- Regulations, code tables, valuation, duty/VAT, origin/FTA or HS classification.
- Live Supabase sign-in, SMTP invitations/recovery, session renewal and standalone deployment in the owner's cloud accounts.
- Live Kimi model responses, account/model availability and extraction accuracy. All Kimi transport tests are mocked; no real shipment was sent.

## Acceptance boundary

Internal approval freezes an AICD review snapshot; it does not grant customs approval. `Create ECUS draft` executes the **test** connector only. A legal/customs status must remain `Not yet assessed`, including after a successful test run or archive.

## Verified in this delivery (October 10, 2026)

- `npm test`: domain, API/persistence, PDF layout, OCR layout, report and localization regression tests pass; run the command for the current count.
- `npm run typecheck`: passed on the integrated code.
- Production build: passed; PDF font and parser are loaded on demand.
- `node scripts/smoke-api.mjs`: 8 integration groups passed against the running loopback app. This included an authenticated review-to-snapshot workflow, failed/successful/idempotent test handoffs, responsible completion and reopen, exact EML/PDF original-byte preservation, duplicate messages, concurrent HTTP 200/409 saves, and HTTP 400/403/404/401 guards.
- Browser inspection: sign-in, synthetic demo queue, source evidence, conflicts displayed side by side and a reviewer decision persisted; no client console errors in the inspected flow.
- PDF: Vietnamese and English reports generated from synthetic state, reopened and rendered with Poppler. Both eight-page reports passed visual checks for Unicode, page breaks, source references, changes and footer numbering.

## Email/password and Kimi update

- 96 automated tests pass, including provider identity validation, invite allowlists, atomic throttling, one-use recovery proofs, cookie protections, bounded and redacted provider responses, callback parsing and localization, session refresh, Kimi page selection, exact source grounding, version retirement and review invalidation.
- The standalone build and Wrangler dry run passed without deployment, using clearly synthetic infrastructure identifiers. Generated configuration selects Supabase mode, disables simulated Sites identity and resolves both D1 migration files.
- Local HTTP checks rejected forged platform identity headers in standalone mode, rejected HTTP password submission before any provider call and blocked cross-origin authentication requests.
- Browser inspection verified English/Vietnamese login and password-reset screens using a fake local provider configuration without submitting credentials. The unconfigured state blocks login. Kimi settings display the international endpoint and unavailable state until server configuration exists.
- Eight existing API integration groups passed again after the auth changes. These checks cover the Sites-mode local workspace with synthetic data; they do not substitute for live Supabase testing.

Kimi only proposes factual header fields from explicitly selected stored text pages (up to five pages / 24,000 characters). Successful proposal saves are audited. Failed or timed-out provider attempts consume the rate limit but do not yet create a separate durable transmission ledger. Requests are not automatically retried after provider errors.

The API smoke script supplies known text fixture pages for its PDF upload. That check validates storage and page/provenance constraints, not the browser PDF text parser's accuracy. These API and workflow tests use synthetic data only. The separate real-sample regression is described below.

## Real sample: exact coverage

- Inventoried all six PDFs and all 55 physical pages. 54 pages have absent/minimal native text; one master B/L page has a usable text layer.
- Local regression processed nine scanned pages with the same Tesseract.js engine and bundled language models used by browser intake, plus one native-text page. The sampled scans cover the combined invoice/packing file, C/O, HBL, labelled contract, and three detailed packing pages.
- 23 selected header/goods values matched local visual checks: invoice/packing facts and one invoice goods row, plus HBL/MBL references. These are selected engineering checks, not a broker-approved declaration or a full-field accuracy denominator.
- 56 candidate values and two document-level goods proposals were retained; the case prefers the invoice goods proposal for review. The initial partial state was approximately 52 KB and had 24 actionable issues. No value was automatically approved.
- 45 further detailed packing pages were inventoried but not OCR-validated in this delivery. Dense rotated component tables, Chinese text, C/O OCR ambiguities and the document labelled contract require human verification. The application exposes source/manual review paths.
- Reusable runner: `scripts/evaluate-extraction.ts`. It takes local manifest, extracted-page/OCR and expected-check files, writes only a requested local result, and does not contain client facts. The private result is ignored at `outputs/private-sample/regression-results.json`.
- Browser QA verified the language switch, preference across reload, queue and review screens. Browser file-picker automation stalled, so end-to-end browser upload/OCR was not verified. Direct API original-file intake, parser/OCR module checks and local OCR evaluation were tested separately.

Do not report 23/23 selected matches as overall shipment accuracy. Unchecked fields, grouping mistakes, reviewer time and actual ECUS transfer still have no representative measurement.
