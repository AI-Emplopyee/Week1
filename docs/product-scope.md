# AICD pilot direction — October 11, 2026

This records the user's updated product direction. Interview statements, pricing, market estimates, vendor claims and proposed dates from the product brief are hypotheses or reported plans, not independently established facts or completed work.

## Current purpose

Prepare import declaration evidence for Vietnamese container brokers, from shipment documents toward a human-reviewed declaration draft. The human declarant remains responsible for procedure, HS classification, valuation, origin and preference eligibility, exemptions, signing and submission. AICD's internal review approval is not customs approval or a ready-to-file certification.

The current implementation is React/TypeScript with a local Cloudflare Workers runtime, D1 and R2 emulation, browser PDFium page rendering, an auditable domain engine and owner-configured Kimi-only document extraction. It is not the older Python/Streamlit/Claude prototype described in background material.

## Delivery and gaps

| Workflow | Present implementation | Required before a real pilot |
| --- | --- | --- |
| Inbox intake and matching | Saved `.eml` intake, original preservation, conservative evidence grouping, manual grouping confirmation | Written mailbox/data permission, representative inbox fixtures, Gmail connector and measured matching errors |
| Document sorting and missing evidence | Versioned documents, per-page classification, a pilot completeness checklist | Procedure-specific verified requirements and more supplier layouts |
| Client document requests | No outbound email | Reviewer-editable drafts, explicit approval before sending, permitted recipient and inbox integration |
| Extraction and reconciliation | Source-linked proposals, contradictions, review reasons, replacement invalidation | Broker-reviewed ground truth and calibrated reliability evaluation |
| VNACCS data | Separate source-fact model and typed declaration draft: 90 editable indicators, five customs-owned read-only indicators, deferred 1.46 and partial 1.48; explicit evidence, applicability and review | Broker validation of the capture model for the pilot scenario, current approved code tables and legal rules |
| ECUS handoff | Layout follows published General 1 / General 2 / Goods sections; approved snapshot and idempotent test adapter only | User identifies ECUS5-VNACCS 2018 build 6.0.248 and SQL Server 2008 (`ECUSSQL2008\ECUS5VNACCS`); exact field specification, supported import template and verified read-back still needed |
| Review queue | Case assignment, issue queue, review snapshots and audit history | Pilot throughput/time measurement; stable identities and larger-team storage before scale |
| Per-client correction memory | Current case review history only | Explicit permission, tenant/client isolation, reviewed correction promotion, rollback and protection against propagating a bad correction |
| Sign and submit | No digital signing, IDA/IDC transmission or real submission | Human declarant and approved filing software; outside this local delivery |

## Evaluation before claims

Use permitted, redacted shipments and independently checked ground truth. A broker-filed declaration is comparison evidence, not automatically correct. Measure field accuracy with its denominator, unflagged wrong values per 100 declarations, errors detected, grouping errors, and reviewer minutes per declaration. Set numerical targets after a baseline. Compare competing tools only on the same permitted evidence; no current superiority, labor-saving or revenue claim is justified.

The brief proposes 20–50 workflow sets and 50+ historical declarations; these are acquisition targets, not data already available. Six prior sample PDFs exist locally but remain outside this update's tests and exports. New software tests use synthetic fixtures.

## Responsibilities from the brief

Long's proposed scope: broker introductions, interviews, consent, datasets, Vietnamese rules, ground truth, evaluation and pricing. Simon's proposed scope: model/extraction architecture, intake, review queue and software handoff. Acceptance and completion of these assignments have not been independently verified. The October 12, 17:00 Pacific update is a reported plan; no reminder, external message or SHIP record was created or changed here.

Deploying, buying a domain, public access, production Gmail, automatic client emails, automatic customs decisions and speculative expansion are deferred. Later hosted deployment should retain invite-only verified identities, HTTPS, protected cookies, tenant authorization and server-only provider secrets.

## Selected product and navigation direction

Shipments and Settings are the primary navigation. Settings contains only Gmail and ECUS connection. Archive is a shipment filter. Within each shipment, Review & draft, Documents and Messages are the primary sections; reports and history are secondary actions. The coverage matrix is internal reference material, not an application destination.

The selected team login is Continue with Google, followed by owner approval before workspace access. Returning users should retain a renewable session. Gmail mailbox consent is separate. ECUS credentials are collected later when a real connector is available. The current password adapter is retained infrastructure, not the selected future onboarding flow.

Kimi is centrally configured by the application owner and is the only document extractor. Users do not choose providers, models or keys. PDFium only renders PDF pages for Kimi; PDF.js and OCR are removed from the active pipeline. Unclear readings, conflicting sources and missing required values need different review questions with relevant evidence and Confirm / Ask sender / Enter manually actions. Clear source-backed Kimi readings can fill the draft without an individual confirmation when there is no contradiction or ambiguity. Application checks still enforce evidence, source versions and cross-document consistency; model confidence is not a factual or legal guarantee. Final approval remains human.
