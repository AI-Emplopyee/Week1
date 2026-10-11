# AICD — Vietnamese shipment review workspace

A working Phase 1 pilot: upload shipment documents, inspect extracted evidence, reconcile conflicting facts, review a draft, preserve decisions and versions, export a Vietnamese or English PDF review report, archive completed cases, and exercise a **test-only** ECUS handoff.

## Materials received

| Material | Available | Consequence |
| --- | --- | --- |
| Product brief | Yes | Implementation scope and acceptance criteria |
| Existing code / prototype | No; user confirmed | New application; no legacy components claimed or reused |
| Real sample shipment | Six supplied PDFs, 55 pages | Local first regression: 23 selected visual checks matched; detailed packing pages remain partly unverified |
| Pilot email provider | Google Workspace / Gmail | Email ingestion interface targets Gmail; `.eml` intake preserves original messages |
| Regulations and current code tables | No | `Not yet assessed`; rule registry intentionally empty |
| ECUS installation / integration specification | No | Test connector only; no real draft creation or transfer-success claim |

All included examples and fixtures are explicitly synthetic. They test software behavior, not real supplier extraction accuracy. No real client documents are included.

## Run locally

Requires Node.js 22.13+ and npm. Do not expose the development server to a public interface: the starter's local identity simulation exists only for loopback development and is excluded from production builds.

```sh
npm ci
npm run db:generate  # only after changing db/schema.ts; the initial migration is already committed
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_charming_ghost_rider.sql
npm run dev -- --hostname 127.0.0.1
```

Apply the initial migration **once** to a new local database; do not replay it after every startup. Open the URL printed by the server. Local sign-in uses the development identity supplied by the Sites starter. Choose **Khám phá hồ sơ mẫu** to load synthetic examples or upload your own files. Data persists in local D1/R2 state across server restarts. Hosted deployment uses a separate database and bucket.

```sh
npm test
npm run typecheck
npm run build
node scripts/smoke-api.mjs # optional: writes synthetic verification records to the running local preview
```

The postinstall script copies PDF.js and Tesseract.js workers/cores into same-origin static assets. English and Vietnamese OCR language models are bundled from the official tessdata_fast project under Apache 2.0. Choose **Tiếng Việt / English** in the header; the preference persists in your browser and sets the PDF report language. Source text and reviewer entries remain verbatim. Noto Sans is bundled under its SIL Open Font License so PDF reports preserve Vietnamese text. Document parsing does not call a third-party AI or OCR service.

## Working demo

1. Sign in, then load the explicitly synthetic demonstration cases.
2. Open the case with a document conflict. Compare candidate values and their original text, filename, version, page, and location.
3. Select or enter a value with an explanation. Confirm document grouping and review the goods lines; manual HS/origin/rate decisions stay unverified.
4. Leave and reopen the draft. Changes persist and the audit records their author, timestamp, reason, and before/after values.
5. Approve an internally reviewed version when the software issues are addressed. Legal/customs validation remains `Not yet assessed`.
6. Select **Create ECUS draft** in the test connector. A successful simulation creates only a `TEST-…` reference. It never contacts ECUS, signs, transmits IDA, or registers IDC. Retrying a successful snapshot cannot create another test draft; a failed simulation can be retried.
7. View and download the report. Mark a case complete to archive it; reopen it for amendments.
8. Upload fixtures individually or as a mixed set. Use move/split/merge, replace a document, or transcribe an unsupported scan. Replacement invalidates prior review decisions and approval.

## Data and security model

- The production Site starts owner-private, behind Sites authentication. Each API resolves the signed-in identity and authorizes workspace membership. Team email allowlisting is a second restriction, not a way around the Site's private audience. Actual colleague access additionally requires explicitly configured Site sharing.
- D1 persists case state, audit entries, immutable review snapshots and test runs. R2 stores original files and email bytes. File endpoints require membership and derive object keys from stored records.
- Mutations require an expected workspace revision. An atomic compare-and-swap rejects stale writes with HTTP 409 rather than silently overwriting another reviewer. The client preserves pending input for deliberate retry.
- File intake validates format signatures, sizes, extracted text limits, hashes and filenames. Same-origin mutation checks and private response caching protect browser endpoints. Credentials and signing material are absent from the browser and repository.
- Uploaded PDF text is parsed in the browser, with its source file preserved on the server. This is reviewable extraction evidence, not cryptographic proof of a document's contents. Reviewers must inspect the original.
- The first slice stores one versioned JSON aggregate per workspace (bounded to 1.8 MB). It is intended for pilot volume. Larger teams require normalized case/event storage and pagination before scaling. Retention, backups, malware scanning and production access policy require operational configuration.

## Extraction scope and honest limits

PDF, TXT and CSV extraction uses modular bilingual label, spatial-row, wrapped-header and table strategies. PDF pages with little native text and uploaded images run local browser OCR with English/Vietnamese models, visible progress, cancellation and timeouts. Models and workers load from this app; source documents are never sent to a third-party OCR service. OCR values are capped at medium confidence; unreadable or weak pages retain a transcription blocker. Rotated rasters are retried in alternative orientations. Unsupported languages, complex component tables and damaged scans may still require checked transcription or manual goods entry. A learned layout model is not connected.

Document type is also recorded per page, allowing an invoice and packing list in one PDF. House and master B/L identifiers and transport parties are separate; transport consignees are not assumed to be commercial importers. Package counts do not become commercial goods quantities. Every proposal retains document/version/page/text/method provenance. All original files remain unchanged.

An email ingestion interface accepts saved `.eml` files and records the original message, sender, timestamp, message ID, attachments and their versions. Duplicate message IDs/hashes and duplicate attachment hashes are checked. Gmail live synchronization is not enabled until the correct pilot inbox and access are authorized. No code sends email automatically.

The first delivery provides source-level evidence and software behavior tests. It does **not** establish field accuracy, unflagged-error rate, grouping accuracy, reviewer-time reduction, or real ECUS transfer success on real shipments. Add broker-reviewed fixtures before publishing those measures.

## Structure

- `lib/types.ts`: extensible declaration and workflow schema.
- `lib/extraction.ts`: classification, normalization and extraction.
- `lib/engine.ts`: grouping, reconciliation, review, versioning and audit transitions.
- `lib/demo.ts`, `fixtures/`: explicitly synthetic examples and regression inputs.
- `lib/server*.ts`, `app/api/`: authenticated persistence, original-file intake and downloads.
- `lib/client-intake.ts`, `lib/client-ocr.ts`, `lib/pdf-text.ts`: local PDF text/OCR, spatial reconstruction and manual paths.
- `lib/report.ts`: complete evidence-backed, Unicode PDF review report.
- `lib/ecus.ts`: adapter contract and deterministic idempotent test connector.
- `lib/rules.ts`: versioned future rule/code-table interfaces, with empty registries.
- `docs/windows-companion.md`: attended Windows companion design and access requirements.
- `docs/validation.md`: exact test scope, missing evidence and acceptance boundaries.

## Later dependencies

1. Broker-reviewed expected declarations and additional supplier layouts to measure accuracy beyond the selected checks on this sample.
2. Authorized pilot Gmail mailbox, desired intake labels and retention policy for live synchronization.
3. Verified regulations and current code tables to implement and version legal/customs checks.
4. Installed ECUS version and vendor-supported interfaces or supervised Windows access to validate an actual draft. Direct database writes are prohibited.
