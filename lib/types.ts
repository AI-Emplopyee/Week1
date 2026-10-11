export type Confidence = 'high' | 'medium' | 'low';
export type DocumentType = 'invoice' | 'packing_list' | 'bill_of_lading' | 'air_waybill' | 'contract' | 'certificate_of_origin' | 'other';
export type CaseStatus = 'review' | 'approved' | 'completed';
export type FieldDefinition = { key: string; label: string; group: string; required?: boolean; manualOnly?: boolean };
export type SourcePage = { page: number; text: string; documentType?: DocumentType; textSource?: 'pdf_text' | 'ocr' | 'manual'; ocrConfidence?: number };
export type ShipmentDocument = { classificationConfirmed?: boolean; id: string; caseId: string; name: string; type: DocumentType; mime: string; size: number; sha256: string; version: number; active: boolean; replacesId?: string; uploadedAt: string; blobKey?: string; pages: SourcePage[]; transcribedPages?: number[]; extractionStatus: 'extracted' | 'needs_transcription' | 'unsupported' | 'failed'; extractionError?: string; sourceEmailId?: string; synthetic: boolean };
export type Candidate = { id: string; caseId: string; documentId: string; documentVersion: number; field: string; lineId?: string; value: string; originalText: string; page: number; location: string; method: string; confidence: Confidence; normalizations: { before: string; after: string; reason: string }[] };
export type ReviewedValue = { value: string; source: 'candidate' | 'manual'; candidateId?: string; reason: string; reviewedBy: string; reviewedAt: string; stale: boolean; unverified: boolean };
export type GoodsLine = { id: string; description: string; quantity: string; unit: string; unitPrice: string; amount: string; hsCode: string; origin: string; dutyRate: string; vatRate: string; sourceDocumentId?: string; sourcePage?: number; originalText?: string; reviewed: boolean; manual: boolean; reason?: string };
export type IssueResolution = { issueId: string; reason: string; actor: string; at: string; fingerprint: string };
export type ShipmentCase = { mergedInto?: string; id: string; reference: string; title: string; status: CaseStatus; caseType: 'import' | 'unsupported'; assignedTo: string; createdAt: string; updatedAt: string; documentIds: string[]; fields: Record<string, ReviewedValue>; goods: GoodsLine[]; groupingConfidence: Confidence; groupingReason: string; groupingConfirmed: boolean; synthetic: boolean; resolutions: IssueResolution[]; approval?: { actor: string; at: string; snapshotId: string }; completedBy?: string; completedAt?: string };
export type Issue = { id: string; caseId: string; kind: 'conflict' | 'missing' | 'uncertain' | 'grouping' | 'unsupported' | 'document' | 'stale' | 'goods' | 'transfer'; severity: 'error' | 'warning'; title: string; description: string; field?: string; candidateIds: string[]; documentIds: string[]; resolved: boolean; fingerprint: string; resolution?: IssueResolution };
export type AuditEntry = { id: string; caseId?: string; at: string; actor: string; action: string; field?: string; before?: unknown; after?: unknown; reason: string };
export type EmailRecord = { id: string; messageId: string; sender: string; subject: string; receivedAt: string; originalName: string; blobKey?: string; documentIds: string[]; sha256: string };
export type Snapshot = { id: string; caseId: string; createdAt: string; actor: string; version: number; declaration: ShipmentCase; candidates: Candidate[]; documents: ShipmentDocument[]; issues: Issue[]; customsValidation: 'Not yet assessed' };
export type HandoffRun = { id: string; caseId: string; snapshotId: string; idempotencyKey: string; at: string; actor: string; connector: 'test'; status: 'succeeded' | 'failed'; draftReference?: string; message: string; idaStatus: 'not_transmitted'; idcStatus: 'not_registered'; customsOutcome: 'not_assessed' };
export type WorkspaceState = { id: string; name: string; revision: number; cases: ShipmentCase[]; documents: ShipmentDocument[]; candidates: Candidate[]; audit: AuditEntry[]; emails: EmailRecord[]; snapshots: Snapshot[]; handoffs: HandoffRun[]; settings: { inboxProvider: 'gmail'; inboxAddress: string; inboxStatus: 'not_connected'; defaultReviewer: string }; };
export type Actor = { id: string; name: string; email: string };
export type UploadedDocument = { id: string; name: string; mime: string; size: number; sha256: string; blobKey?: string; pages: SourcePage[]; extractionStatus: ShipmentDocument['extractionStatus']; extractionError?: string; sourceEmailId?: string; synthetic?: boolean };
export type AiSourceProposal = { field: string; value: string; quote: string; page: number; confidence: 'low' | 'medium' };
export type Action =
 | { type: 'add_ai_candidates'; caseId: string; documentId: string; documentVersion: number; model: string; pages: number[]; proposals: AiSourceProposal[] }
 | { type: 'seed_demo' }
 | { type: 'create_case'; title: string; caseType?: ShipmentCase['caseType'] }
 | { type: 'intake'; documents: UploadedDocument[]; targetCaseId?: string; email?: EmailRecord }
 | { type: 'review_field'; caseId: string; field: string; value: string; candidateId?: string; reason: string }
 | { type: 'review_goods'; caseId: string; goods: GoodsLine[]; reason: string }
 | { type: 'resolve_issue'; caseId: string; issueId: string; reason: string }
 | { type: 'confirm_grouping'; caseId: string; reason: string }
 | { type: 'move_documents'; documentIds: string[]; targetCaseId?: string; title?: string }
 | { type: 'merge_cases'; sourceCaseId: string; targetCaseId: string }
 | { type: 'replace_document'; documentId: string; document: UploadedDocument }
 | { type: 'classify_document'; documentId: string; documentType: DocumentType }
 | { type: 'transcribe_document'; documentId: string; pages: SourcePage[]; reason: string }
 | { type: 'update_case'; caseId: string; title?: string; assignedTo?: string; caseType?: ShipmentCase['caseType'] }
 | { type: 'approve'; caseId: string }
 | { type: 'handoff'; caseId: string; simulateFailure?: boolean }
 | { type: 'complete'; caseId: string; reason: string }
 | { type: 'reopen'; caseId: string; reason: string }
 | { type: 'settings'; inboxAddress?: string; defaultReviewer?: string };
export type WorkspaceResponse = { state: WorkspaceState; actor: Actor; role: 'owner' | 'reviewer'; issues: Issue[] };

