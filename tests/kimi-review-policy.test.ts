import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, createEmptyWorkspace, getIssues } from "../lib/engine.ts";
import { getDeclarationEntry } from "../lib/declaration.ts";
import { isShipmentFactClear } from "../lib/shipment-autofill.ts";
import { extractDocument } from "../lib/extraction.ts";
import type { Action, Actor, AiSourceProposal, WorkspaceState } from "../lib/types.ts";

const actor: Actor = { id: "review-policy", name: "Test reviewer", email: "review@example.invalid" };
const collection = { name: "In-memory tests", folder: "Single packet", caseType: "import" as const };
const act = (state: WorkspaceState, action: Action) => applyAction(state, action, actor);
function addDocument(state: WorkspaceState, id = "invoice") {
  return act(state, { type: "intake", sourceCollection: collection, documents: [{
    id, name: `${id}.pdf`, mime: "application/pdf", sha256: `test-original-${id}`, size: 100,
    extractionPipeline: "kimi", extractionStatus: "pending_ai", aiStatus: "partial",
    pages: [{ page: 1, text: "COMMERCIAL INVOICE\nInvoice No: MUST-NOT-BE-PARSED\nGross weight: 999 KG" }],
    synthetic: true,
  }] });
}
function proposal(field: string, value: string, overrides: Partial<AiSourceProposal> = {}): AiSourceProposal {
  return { field, value, quote: `${field}: ${value}`, page: 1, confidence: "high", readability: "clear",
    evidence: "vision", bounds: [0.1, 0.1, 0.5, 0.1], ...overrides };
}
function read(state: WorkspaceState, proposals: AiSourceProposal[], documentId = "invoice", readability: "clear" | "uncertain" = "clear") {
  const document = state.documents.find(document => document.id === documentId)!;
  return act(state, { type: "add_ai_candidates", caseId: document.caseId, documentId, documentVersion: document.version,
    model: "test-kimi", pages: [1], proposals,
    pageReadings: [{ page: 1, documentType: documentId === "invoice" ? "invoice" : "packing_list", readability }],
    visionEvidence: [{ page: 1, imageSha256: "a".repeat(64), width: 1000, height: 1400 }],
  });
}
const invoice = () => [
  proposal("invoiceNumber", "INV-TEST"), proposal("invoiceDate", "2026-10-01"),
  proposal("importer", "Example Buyer"), proposal("exporter", "Example Seller"),
  proposal("currency", "USD"), proposal("invoiceTotal", "100.00"),
  proposal("grossWeight", "10"), proposal("grossWeightUnit", "KG"),
  ...Object.entries({ description: "Test widget", quantity: "2", unit: "PCS", unitPrice: "50.00", amount: "100.00" })
    .map(([field, value]) => proposal(field, value, { rowIndex: 1 })),
];
function confirmed(state: WorkspaceState) {
  return act(state, { type: "confirm_grouping", caseId: state.cases[0].id, reason: "This test packet contains one shipment." });
}

test("Kimi-only intake waits for Kimi and never parses legacy text or filename as shipment facts", () => {
  const state = addDocument(createEmptyWorkspace("kimi-review-policy"));
  assert.equal(state.candidates.length, 0);
  assert.equal(state.cases[0].goods.length, 0);
  assert.equal(state.documents[0].type, "other");
  const issues = getIssues(confirmed(state));
  assert.ok(issues.some(issue => issue.id.endsWith("document-invoice")));
  assert.ok(!issues.some(issue => issue.kind === "missing" || issue.id.endsWith("goods-missing")));
});

test("one clear Kimi reading fills source-backed fields and rows without individual confirmations", () => {
  const state = confirmed(read(addDocument(createEmptyWorkspace("kimi-clear")), invoice()));
  const shipment = state.cases[0];
  assert.equal(state.documents[0].type, "invoice");
  assert.equal(state.documents[0].extractionStatus, "extracted");
  assert.equal(shipment.goods.length, 1);
  assert.ok(state.candidates.every(candidate => candidate.method.startsWith("kimi:") && candidate.confidence === "high"));
  assert.ok(!getIssues(state).some(issue => issue.id.includes(":review-") || issue.id.includes(":goods-uncertain-")));
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "1.41")?.value.kind, "reference");
  assert.equal(getDeclarationEntry(shipment.declarationDraft, "1.41")?.review, null);
  assert.equal(shipment.goods[0].reviewed, false);
  assert.equal(shipment.approval, undefined);
  assert.equal(shipment.status, "review");
  assert.equal(shipment.fields.customsProcedure, undefined);
});

test("clear readings that disagree between files still ask for a choice", () => {
  let state = read(addDocument(createEmptyWorkspace("kimi-conflict")), invoice());
  state = addDocument(state, "packing");
  state = confirmed(read(state, [proposal("grossWeight", "12")], "packing"));
  const conflict = getIssues(state).find(issue => issue.field === "grossWeight" && issue.kind === "conflict");
  assert.ok(conflict && !conflict.resolved);
  assert.equal(conflict.candidateIds.length, 2);
  assert.ok(!getIssues(state).some(issue => issue.id.endsWith(":review-grossWeight")), "The conflict gets one question, not an extra routine confirmation.");
});

test("unclear readings and ambiguous dates remain questions; page uncertainty overrides a claimed high confidence", () => {
  const input = invoice().map(candidate => candidate.field === "invoiceDate"
    ? proposal("invoiceDate", "03/04/2026")
    : candidate.field === "grossWeight" ? proposal("grossWeight", "10", { confidence: "low", readability: "uncertain" }) : candidate);
  const state = confirmed(read(addDocument(createEmptyWorkspace("kimi-uncertain")), input));
  const questions = getIssues(state);
  assert.ok(questions.some(issue => issue.id.endsWith(":review-grossWeight")));
  assert.ok(questions.some(issue => issue.id.endsWith(":review-invoiceDate")));
  const uncertainPage = read(addDocument(createEmptyWorkspace("kimi-page")), invoice(), "invoice", "uncertain");
  assert.equal(uncertainPage.documents[0].extractionStatus, "needs_transcription");
  assert.ok(uncertainPage.candidates.every(candidate => candidate.confidence === "low"));
});

test("two copies of an uncertain original cannot count as independent agreement; invalid numbers never become clear", () => {
  const state = read(addDocument(createEmptyWorkspace("kimi-independence")), [proposal("grossWeight", "10", { confidence: "medium" })]);
  const first = state.candidates[0];
  const duplicate = { ...state.documents[0], id: "copy" };
  state.documents.push(duplicate);
  const second = { ...first, id: "copy-candidate", documentId: duplicate.id };
  assert.equal(isShipmentFactClear(state, "grossWeight", [first, second]), false);
  duplicate.sha256 = "different-original";
  assert.equal(isShipmentFactClear(state, "grossWeight", [first, second]), true);
  assert.equal(isShipmentFactClear(state, "grossWeight", [{ ...first, value: "1,000" }, { ...second, value: "1,000" }]), false);
});

test("rereading a page replaces old machine guesses and keeps identical human decisions connected", () => {
  let state = confirmed(read(addDocument(createEmptyWorkspace("kimi-reread")), invoice()));
  const source = state.candidates.find(candidate => candidate.field === "grossWeight")!;
  state = act(state, { type: "review_field", caseId: state.cases[0].id, field: "grossWeight", value: "10", candidateId: source.id, reason: "I checked this original." });
  const same = read(state, invoice());
  assert.equal(same.cases[0].fields.grossWeight.candidateId, source.id);
  assert.equal(same.cases[0].fields.grossWeight.stale, false);
  assert.equal(same.candidates.length, state.candidates.length);
  const changed = read(same, invoice().map(candidate => candidate.field === "grossWeight" ? proposal("grossWeight", "12") : candidate));
  assert.equal(changed.cases[0].fields.grossWeight.value, "10");
  assert.equal(changed.cases[0].fields.grossWeight.stale, true);
  assert.deepEqual(changed.candidates.filter(candidate => candidate.field === "grossWeight").map(candidate => candidate.value), ["12"]);
  assert.ok(changed.audit.some(entry => entry.action === "ai_source_evidence_replaced"));
});

test("a weak duplicate goods reading does not add confirmation when the same cell is clearly supported", () => {
  const state = confirmed(read(addDocument(createEmptyWorkspace("kimi-row")), invoice()));
  const price = state.candidates.find(candidate => candidate.field === "unitPrice")!;
  state.candidates.push({ ...price, id: "weaker-duplicate", confidence: "low", readability: "uncertain" });
  assert.ok(!getIssues(state).some(issue => issue.id.includes(":goods-uncertain-")));
  state.candidates.find(candidate => candidate.id === price.id)!.confidence = "low";
  assert.ok(getIssues(state).some(issue => issue.id.includes(":goods-uncertain-")));
});

test("explicitly clear supplementary pages do not raise obsolete layout or classification questions", () => {
  let state = addDocument(createEmptyWorkspace("kimi-supplement"));
  const document = state.documents[0];
  state = act(state, { type: "add_ai_candidates", caseId: document.caseId, documentId: document.id, documentVersion: 1,
    model: "test-kimi", pages: [1], proposals: [],
    pageReadings: [{ page: 1, documentType: "other", readability: "clear" }],
    visionEvidence: [{ page: 1, imageSha256: "a".repeat(64), width: 1000, height: 1400 }],
  });
  assert.ok(!getIssues(state).some(issue => issue.id.endsWith("layout-invoice") || issue.id.endsWith("classification-invoice")));
  assert.ok(getIssues(confirmed(state)).some(issue => issue.id.endsWith("missing-invoice")), "Historical text headings cannot override Kimi's page classification.");
});

test("new document versions wait for Kimi again and retain earlier human decisions as stale", () => {
  const state = confirmed(read(addDocument(createEmptyWorkspace("kimi-version")), invoice()));
  const classified = act(state, { type: "classify_document", documentId: "invoice", documentType: "invoice" });
  assert.equal(classified.documents[0].extractionStatus, "pending_ai");
  assert.equal(classified.documents[0].pages[0].aiReadability, undefined);
  assert.equal(classified.documents[0].aiProcessedPages, undefined);
  assert.ok(!getIssues(confirmed(classified)).some(issue => issue.kind === "missing"));
  const transcribed = act(state, { type: "transcribe_document", documentId: "invoice", pages: [{ page: 1, text: "Invoice No: MANUAL-TEXT" }], reason: "Human supplied a source transcription." });
  assert.equal(transcribed.documents[0].extractionStatus, "pending_ai");
  assert.ok(!transcribed.candidates.some(candidate => candidate.documentVersion === 2));
});

test("extended factual form fields ask only for genuine uncertainty and accept an explicit human correction", () => {
  const extra = [
    proposal("importerAddress", "123 Example Road"),
    proposal("exporterCountry", "China"),
    proposal("arrivalDate", "03/04/2026"),
    proposal("containerCount", "1.5"),
    proposal("exporterCity", "Example City", { confidence: "medium", readability: "uncertain" }),
  ];
  let state = confirmed(read(addDocument(createEmptyWorkspace("kimi-more-fields")), [...invoice(), ...extra]));
  const pending = getIssues(state);
  for (const field of ["arrivalDate", "containerCount", "exporterCity"])
    assert.ok(pending.some(issue => issue.id.endsWith(`:review-${field}`)), field);
  for (const field of ["importerAddress", "exporterCountry"])
    assert.ok(!pending.some(issue => issue.id.endsWith(`:review-${field}`)), field);
  const address = getDeclarationEntry(state.cases[0].declarationDraft, "1.15");
  assert.deepEqual(address?.value, { kind: "text", text: "123 Example Road" });
  state = act(state, { type: "review_field", caseId: state.cases[0].id, field: "exporterCity", value: "Example City", reason: "Confirmed city in source." });
  assert.ok(!getIssues(state).some(issue => issue.id.endsWith(":review-exporterCity") && !issue.resolved));
  assert.ok(getIssues(state).some(issue => issue.id.endsWith(":review-arrivalDate") && !issue.resolved));
});

test("intake completion is derived from trusted Kimi page readings, not a caller-supplied completed flag", () => {
  const state = act(createEmptyWorkspace("kimi-status"), { type: "intake", sourceCollection: collection, documents: [{
    id: "status", name: "status.pdf", mime: "application/pdf", sha256: "status-source", size: 100,
    extractionPipeline: "kimi", extractionStatus: "extracted", aiStatus: "completed", aiProcessedPages: [1],
    pages: [{ page: 1, text: "", aiReadability: "clear", documentType: "invoice" }], synthetic: true,
  }] });
  assert.equal(state.documents[0].extractionStatus, "pending_ai");
  assert.equal(state.documents[0].aiStatus, "partial");
  assert.deepEqual(state.documents[0].aiProcessedPages, []);
  assert.equal(state.documents[0].pages[0].aiReadability, undefined);
  assert.equal(state.documents[0].type, "other");
});

test("unsupported originals and source-opening failures retain their actionable terminal status", () => {
  for (const extractionStatus of ["unsupported", "failed"] as const) {
    const explanation = extractionStatus === "unsupported" ? "Convert this original to PDF." : "Provide an unlocked readable original.";
    const state = act(createEmptyWorkspace(`kimi-${extractionStatus}`), { type: "intake", sourceCollection: collection, documents: [{
      id: extractionStatus, name: extractionStatus === "unsupported" ? "old.xls" : "locked.pdf",
      mime: extractionStatus === "unsupported" ? "application/vnd.ms-excel" : "application/pdf",
      sha256: `terminal-${extractionStatus}`, size: 100, extractionPipeline: "kimi",
      extractionStatus, extractionError: explanation, pages: [], synthetic: true,
    }] });
    assert.equal(state.documents[0].extractionStatus, extractionStatus);
    assert.equal(state.documents[0].extractionError, explanation);
    assert.equal(state.documents[0].aiStatus, undefined);
    const issue = getIssues(state).find(issue => issue.id.endsWith(`document-${extractionStatus}`));
    assert.equal(issue?.description, explanation);
    assert.notEqual(issue?.title, "Đang chờ Kimi đọc chứng từ");
    const classified = act(state, { type: "classify_document", documentId: extractionStatus, documentType: "invoice" });
    assert.equal(classified.documents[0].extractionStatus, extractionStatus, "Choosing a document category cannot repair an unreadable original.");
    assert.equal(classified.documents[0].extractionError, explanation);
  }
});

test("intake and regrouping cannot recover shipment identifiers through the legacy reader for Kimi sources", () => {
  const source = "COMMERCIAL INVOICE\nInvoice No: SHARED-NOT-READ\nHBL No: SHARED-HBL-NOT-READ\nDescription | Quantity | Unit | Unit Price | Amount\nWidget | 2 | PCS | 10 | 20";
  let state = act(createEmptyWorkspace("kimi-no-local-grouping"), { type: "intake", documents: ["first", "second"].map(id => ({
    id, name: `${id}.txt`, mime: "text/plain", sha256: `different-${id}`, size: source.length,
    extractionPipeline: "kimi", extractionStatus: "pending_ai", pages: [{ page: 1, text: source }], synthetic: true,
  })) });
  assert.deepEqual(extractDocument(state.documents[0]), { candidates: [], goods: [] });
  assert.equal(state.cases.filter(shipment => !shipment.mergedInto).length, 2);
  assert.equal(state.candidates.length, 0);
  state = act(state, { type: "regroup_existing" });
  assert.equal(state.cases.filter(shipment => !shipment.mergedInto).length, 2);
  assert.equal(state.candidates.length, 0);
  assert.ok(state.cases.every(shipment => !shipment.groupingConfirmed && shipment.goods.length === 0));
});

test("multi-batch intake retains six-page complete and partial Kimi readings without applying the per-request limit", () => {
  for (const count of [5, 6]) {
    const pages = Array.from({ length: 6 }, (_, index) => ({ page: index + 1, text: `Text source page ${index + 1}` }));
    const state = act(createEmptyWorkspace(`kimi-intake-${count}`), { type: "intake", sourceCollection: collection, documents: [{
      id: "six-pages", name: "source.txt", mime: "text/plain", sha256: "six-pages-original", size: 100,
      extractionPipeline: "kimi", extractionStatus: "extracted", aiStatus: "completed", pages, synthetic: true,
      aiPageReadings: pages.slice(0, count).map(page => ({ page: page.page, documentType: "invoice", readability: "clear" })),
    }] });
    assert.equal(state.documents[0].pages.length, 6);
    assert.equal(state.documents[0].aiProcessedPages?.length, count);
    assert.equal(state.documents[0].extractionStatus, count === 6 ? "extracted" : "pending_ai");
    assert.equal(state.documents[0].aiStatus, count === 6 ? "completed" : "partial");
    assert.equal(state.documents[0].pages[5].aiReadability, count === 6 ? "clear" : undefined);
  }
});
