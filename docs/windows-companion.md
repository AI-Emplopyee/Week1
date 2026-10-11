# Attended Windows companion — design boundary

No real ECUS connector ships in this Phase 1 build. `lib/ecus.ts` defines the adapter contract, and the test adapter exercises immutable snapshots and idempotency without a Windows computer.

## Intended attended flow

A broker signs into a small Windows tray application on the same machine as ECUS, pairs it with an authorized workspace, and selects a frozen AICD review snapshot. The companion displays its reference, timestamp, goods count and requested action, **Create ECUS draft**. The broker confirms the attended operation. Connection credentials live in Windows Credential Manager, never browser storage; signing certificates and PINs stay outside the adapter.

First inspect the installed ECUS edition, version and supported vendor interfaces. Prefer an approved file import or vendor integration. Evaluate UI automation only when no supported method is available. Do not write ECUS database tables.

## Adapter job contract

- Input: authenticated job ID, immutable snapshot ID/hash, schema version, requested action `create_draft`, idempotency key and short expiration.
- States: queued, awaiting operator, validating screen, creating draft, verifying read-back, succeeded, failed or needs reconciliation.
- Output: verified ECUS draft reference, comparison of header and goods lines against the frozen snapshot, evidence metadata, timestamps and failure reason.
- Distinct subsequent states remain `IDA not transmitted`, `IDC not registered`, and `customs outcome not assessed`. Digital signing and official transmission are outside the first adapter's capability set.

## Failure and duplication behavior

Keep a durable local idempotency journal and server run record. After interruption, a pending job must read back whether a draft already exists before retrying. A timeout after an uncertain ECUS write must transition to `needs reconciliation`; it cannot blindly replay creation. Preserve the original frozen payload. New reviewer changes require a new approval snapshot and job.

For UI automation, validate the application process/version, active screen and field mapping before every step. Stop on unexpected dialogs, focus changes, login expiry or screen mismatch. Read back all material values before reporting success. Capture only the minimum necessary verification evidence according to the broker's document policy.

## Evidence still required

Installed ECUS version, supported import formats/vendor documentation, a test account and machine, operator supervision, a nonproduction declaration workflow, read-back access and failure scenarios. A real integration is accepted only after a draft is created and verified in that installation. The current `TEST-` results prove none of these capabilities.
