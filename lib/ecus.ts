import type { HandoffRun, Snapshot } from './types.ts';

export type EcusDraftResult = { status: 'succeeded' | 'failed'; draftReference?: string; message: string };
export interface EcusAdapter {
  readonly kind: 'test' | 'attended_windows';
  /** Creates an editable draft only. Signing, IDA and IDC are intentionally absent. */
  createDraft(snapshot: Readonly<Snapshot>, idempotencyKey: string): Promise<EcusDraftResult>;
}
export const testEcusAdapter: EcusAdapter = {
  kind: 'test',
  async createDraft(snapshot, idempotencyKey) {
    return simulateTestDraft(snapshot, idempotencyKey);
  },
};
export function simulateTestDraft(snapshot: Readonly<Snapshot>, idempotencyKey: string, fail = false): EcusDraftResult {
  if (!snapshot.declaration.approval || snapshot.declaration.approval.snapshotId !== snapshot.id) throw new Error('Snapshot must contain its approval before test handoff.');
  if (!idempotencyKey) throw new Error('An idempotency key is required.');
  return fail
    ? { status: 'failed', message: 'TEST CONNECTOR: simulated failure before draft creation. Retry uses the same frozen snapshot and idempotency key.' }
    : { status: 'succeeded', draftReference: `TEST-${snapshot.id}`, message: 'TEST CONNECTOR ONLY: simulated editable ECUS draft. No ECUS installation was contacted; no signing, IDA transmission, IDC registration or customs outcome.' };
}
export function successfulRunForSnapshot(runs: readonly HandoffRun[], snapshotId: string): HandoffRun | undefined {
  return runs.find(run => run.snapshotId === snapshotId && run.status === 'succeeded');
}
