// Run only against an isolated, disposable local workspace; never a user's data.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

const base = new URL(process.argv[2] || "http://127.0.0.1:5174");
if (
  base.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
)
  throw new Error("Only an HTTP loopback server is supported.");
if (process.env.AICD_SMOKE_ISOLATED !== "1")
  throw new Error(
    "Set AICD_SMOKE_ISOLATED=1 only after starting a disposable local workspace.",
  );
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const results = [];
const pass = (name) => {
  results.push(name);
  console.log(`PASS ${name}`);
};
async function request(path, options = {}) {
  const response = await fetch(new URL(path, base), {
    ...options,
    headers: { Origin: base.origin, ...options.headers },
  });
  const body = await response.json();
  return { response, body };
}
const auth = (await request("/api/auth/status")).body;
assert.equal(auth.mode, "local");
assert.equal(auth.authenticated, true);
let workspace = (await request("/api/workspace")).body;
const before = () => structuredClone(workspace.state);
const refresh = async () => {
  workspace = (await request("/api/workspace")).body;
  return workspace;
};
async function upload(
  files,
  metadata = files.map((file) => ({
    name: file.name,
    pages: [],
    extractionStatus: "extracted",
  })),
  expected = 200,
) {
  const form = new FormData();
  for (const file of files)
    form.append("file", new File([file.bytes], file.name));
  form.set("documents", JSON.stringify(metadata));
  form.set("revision", String(workspace.state.revision));
  const result = await request("/api/documents", {
    method: "POST",
    body: form,
  });
  assert.equal(
    result.response.status,
    expected,
    result.body.error || JSON.stringify(result.body),
  );
  if (expected === 200) workspace = result.body;
  return result;
}
async function action(action, expected = 200) {
  const result = await request("/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: workspace.state.revision, action }),
  });
  assert.equal(
    result.response.status,
    expected,
    `${action.type}: ${result.body.error || JSON.stringify(result.body)}`,
  );
  if (expected === 200) workspace = result.body;
  return result;
}
const stamp = `BATCH-${randomUUID().slice(0, 8).toUpperCase()}`;
const fixtures = await Promise.all(
  ["commercial-invoice", "packing-list", "bill-of-lading"].map(async (name) => {
    const text = await readFile(
      new URL(`../fixtures/DEMO-${name}-022.txt`, import.meta.url),
      "utf8",
    );
    return {
      name: `DEMO-${name}-${stamp}.txt`,
      bytes: text.replaceAll("022", stamp),
    };
  }),
);
const initial = before();
await upload([fixtures[2], fixtures[0], fixtures[1]]);
const imported = fixtures.map((file) =>
  workspace.state.documents.find(
    (document) => document.sha256 === sha(file.bytes),
  ),
);
assert(imported.every(Boolean));
const caseIds = new Set(imported.map((document) => document.caseId));
assert.equal(
  caseIds.size,
  1,
  "The entire mixed-order batch belongs to one shipment.",
);
const caseId = [...caseIds][0];
const shipment = () => workspace.state.cases.find((item) => item.id === caseId);
assert.equal(
  workspace.state.revision,
  initial.revision + 1,
  "A batch commits one workspace revision.",
);
assert.equal(workspace.state.documents.length, initial.documents.length + 3);
const invoiceEntry = shipment().declarationDraft.fields.find(
  (entry) => entry.fieldId === "1.41",
);
assert.equal(invoiceEntry.value.reference, `DEMO-INV-${stamp}`);
assert(
  shipment().declarationDraft.fields.some(
    (entry) => entry.fieldId === "1.28" && entry.value.amount === "630",
  ),
);
assert(
  !workspace.issues.some(
    (issue) =>
      issue.caseId === caseId &&
      !issue.resolved &&
      ["missing-invoice", "missing-packing", "missing-transport"].some(
        (suffix) => issue.id.endsWith(`:${suffix}`),
      ),
  ),
);
pass(
  "atomic multipart batch groups all documents before combined declaration autofill",
);

const priorDuplicate = before();
await upload([fixtures[1], fixtures[2], fixtures[0]]);
assert.deepEqual(
  workspace.state,
  priorDuplicate,
  "Duplicate batches must not create documents, audit rows or a new revision.",
);
pass("duplicate batch is idempotent regardless of file order");

const priorInvalid = before();
const invalidFirst = {
  name: `DEMO-uncommitted-${stamp}.txt`,
  bytes: `SYNTHETIC ONLY\nCOMMERCIAL INVOICE\nInvoice Number: UNCOMMITTED-${stamp}\nImporter: DEMO isolated importer\nExporter: DEMO isolated exporter\n`,
};
await upload(
  [
    invalidFirst,
    {
      name: "DEMO-invalid.exe",
      bytes: "Unsupported executable fixture; never execute this text.",
    },
  ],
  undefined,
  400,
);
await refresh();
assert.deepEqual(
  workspace.state,
  priorInvalid,
  "Failure after staging a valid first file must roll back the entire batch.",
);
assert(
  !workspace.state.documents.some(
    (document) => document.sha256 === sha(invalidFirst.bytes),
  ),
);
const mismatch = before();
await upload(
  [invalidFirst],
  [{ name: "wrong-name.txt", pages: [], extractionStatus: "extracted" }],
  400,
);
await refresh();
assert.deepEqual(workspace.state, mismatch);
pass(
  "invalid second file and mismatched metadata leave no partial workspace changes",
);

// Vinext checks multipart bodies before route handlers. Keep this above its
// former 1 MiB framework limit while remaining inside AICD's 22 MiB batch limit.
const largePdf = await PDFDocument.create();
largePdf.addPage([595, 842]);
largePdf.setSubject(
  `SYNTHETIC SIZE-BOUNDARY FIXTURE ${stamp} ${"X".repeat(1_100_000)}`,
);
const largeBytes = await largePdf.save({ useObjectStreams: false });
assert(largeBytes.length > 1024 * 1024);
const largeName = `DEMO-size-boundary-${stamp}.pdf`;
await upload([{ name: largeName, bytes: largeBytes }]);
const largeSaved = workspace.state.documents.find(
  (document) => document.sha256 === sha(largeBytes),
);
assert(largeSaved && largeSaved.size === largeBytes.length);
assert.equal(
  largeSaved.extractionStatus,
  "needs_transcription",
  "An unreadable blank page must stay unresolved.",
);
pass(
  "valid PDF over 1 MiB passes framework multipart handling without false extraction success",
);

const pdf = await PDFDocument.create();
pdf.addPage([595, 842]);
const scannedBytes = await pdf.save();
const attachmentName = `DEMO-scanned-invoice-${stamp}.pdf`;
const scanText = `SYNTHETIC OCR FIXTURE — NOT A REAL CLIENT SHIPMENT\nCOMMERCIAL INVOICE\nInvoice Number: DEMO-EMAIL-${stamp}\nInvoice Date: 2026-10-10\nImporter: DEMO Email Buyer\nExporter: DEMO Email Seller\nCurrency: USD\nInvoice Total: 42.00\nGross Weight: 10\n`;
const emlName = `DEMO-email-${stamp}.eml`;
const boundary = `aicd-${stamp}`;
const eml = [
  "From: synthetic-sender@example.invalid",
  "To: synthetic-broker@example.invalid",
  `Subject: SYNTHETIC attachment OCR ${stamp}`,
  `Message-ID: <${stamp}@example.invalid>`,
  "MIME-Version: 1.0",
  `Content-Type: multipart/mixed; boundary="${boundary}"`,
  "",
  `--${boundary}`,
  "Content-Type: text/plain; charset=UTF-8",
  "",
  "SYNTHETIC TEST ONLY.",
  `--${boundary}`,
  `Content-Type: application/pdf; name="${attachmentName}"`,
  `Content-Disposition: attachment; filename="${attachmentName}"`,
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from(scannedBytes).toString("base64"),
  `--${boundary}--`,
  "",
].join("\r\n");
const emailPrior = before();
const metadata = [
  {
    name: emlName,
    pages: [],
    extractionStatus: "extracted",
    attachments: [
      {
        name: attachmentName,
        index: 0,
        pages: [
          { page: 1, text: scanText, textSource: "ocr", ocrConfidence: 0.95 },
        ],
        extractionStatus: "extracted",
      },
    ],
  },
];
await upload([{ name: emlName, bytes: eml }], metadata);
assert.equal(workspace.state.revision, emailPrior.revision + 1);
const email = workspace.state.emails.find((item) => item.sha256 === sha(eml));
assert(email);
assert.equal(email.sender, "synthetic-sender@example.invalid");
const attachment = workspace.state.documents.find(
  (item) => item.id === email.documentIds[0],
);
assert.equal(attachment.name, attachmentName);
assert.equal(attachment.pages[0].text, scanText);
assert.equal(attachment.pages[0].textSource, "ocr");
assert.equal(attachment.extractionStatus, "extracted");
assert.equal(attachment.sourceEmailId, email.id);
assert.notEqual(
  attachment.caseId,
  caseId,
  "Unrelated email shipment must remain separate.",
);
pass(
  "EML attachment metadata retains page-level OCR and the original sender relationship",
);

const emailCaseId = attachment.caseId;
// A lone invoice cannot prove its group yet. Confirm the fixture's identity
// before expecting missing-document questions for the completed intake batch.
await action({
  type: "confirm_grouping",
  caseId: emailCaseId,
  reason:
    "SYNTHETIC smoke test: this single fictional invoice defines the shipment awaiting other documents.",
});
const question = workspace.issues.find(
  (issue) =>
    issue.caseId === emailCaseId && !issue.resolved && issue.kind === "missing",
);
assert(
  question,
  "The intentionally incomplete email shipment must have a real missing-information question.",
);
await action({
  type: "draft_questions",
  caseId: emailCaseId,
  issueIds: [question.id],
  locale: "en",
});
const draft = workspace.state.emailDrafts.find(
  (item) => item.caseId === emailCaseId,
);
assert(draft);
assert.equal(draft.status, "draft");
assert.equal(draft.recipient, email.sender);
assert(draft.body.includes("Please"));
assert(draft.issueIds.includes(question.id));
const subject = `SYNTHETIC reviewed questions ${stamp}`;
const body = `${draft.body}\n\nHuman reviewer fixture: please include the missing document.`;
await action({ type: "save_email_draft", draftId: draft.id, subject, body });
await refresh();
const reopened = workspace.state.emailDrafts.find(
  (item) => item.id === draft.id,
);
assert.equal(reopened.subject, subject);
assert.equal(reopened.body, body);
assert.equal(reopened.status, "draft");
assert(
  workspace.state.audit.some(
    (entry) =>
      entry.action === "email_draft_updated" &&
      entry.after?.draftId === draft.id,
  ),
);
const crossCase = before();
await action(
  { type: "draft_questions", caseId, issueIds: [question.id], locale: "en" },
  422,
);
await refresh();
assert.deepEqual(workspace.state, crossCase);
pass(
  "sender questions persist as editable local drafts and reject cross-shipment issue IDs",
);
console.log(
  JSON.stringify(
    {
      passed: results.length,
      caseId,
      emailCaseId,
      revision: workspace.state.revision,
      results,
    },
    null,
    2,
  ),
);
