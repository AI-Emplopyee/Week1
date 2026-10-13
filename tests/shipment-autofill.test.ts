import assert from "node:assert/strict";
import test from "node:test";
import { extractDocument } from "../lib/extraction.ts";
import {
  getDeclarationEntry,
  getDeclarationIssues,
  saveDeclarationField,
  validateDeclarationEntry,
} from "../lib/declaration.ts";
import {
  buildShipmentFacts,
  normalizedShipmentValue,
  syncShipmentDeclaration,
} from "../lib/shipment-autofill.ts";
import type {
  DeclarationFieldEntry,
  DeclarationValue,
} from "../lib/declaration-types.ts";
import type {
  Actor,
  ShipmentCase,
  ShipmentDocument,
  WorkspaceState,
} from "../lib/types.ts";

const actor: Actor = {
  id: "autofill-reviewer",
  name: "Synthetic reviewer",
  email: "reviewer@example.invalid",
};
const at = "2026-10-12T00:00:00.000Z";
function fixture(): { state: WorkspaceState; shipment: ShipmentCase } {
  const shipment: ShipmentCase = {
    id: "shipment-1",
    reference: "SYNTHETIC-1",
    title: "Synthetic shipment",
    status: "review",
    caseType: "import",
    assignedTo: actor.name,
    createdAt: at,
    updatedAt: at,
    documentIds: [],
    fields: {},
    goods: [],
    groupingConfidence: "high",
    groupingReason: "Synthetic references match.",
    groupingConfirmed: true,
    synthetic: true,
    resolutions: [],
    declarationDraft: { schemaVersion: 1, fields: [] },
  };
  return {
    shipment,
    state: {
      id: "autofill-tests",
      name: "Synthetic workspace",
      revision: 0,
      cases: [shipment],
      documents: [],
      candidates: [],
      audit: [],
      emails: [],
      snapshots: [],
      handoffs: [],
      settings: {
        inboxProvider: "gmail",
        inboxAddress: "",
        inboxStatus: "not_connected",
        defaultReviewer: actor.name,
      },
    },
  };
}
function addSource(
  state: WorkspaceState,
  shipment: ShipmentCase,
  id: string,
  text: string,
  type: ShipmentDocument["type"] = "invoice",
) {
  const doc: ShipmentDocument = {
    id,
    caseId: shipment.id,
    name: `${id}.txt`,
    type,
    mime: "text/plain",
    size: text.length,
    sha256: `synthetic-${id}`,
    version: 1,
    active: true,
    uploadedAt: at,
    pages: [{ page: 1, text, documentType: type, textSource: "pdf_text" }],
    extractionStatus: "extracted",
    synthetic: true,
  };
  state.documents.push(doc);
  shipment.documentIds.push(id);
  const extracted = extractDocument(doc);
  state.candidates.push(...extracted.candidates);
  if (!shipment.goods.length && type === "invoice")
    shipment.goods = extracted.goods;
  return doc;
}
function entry(
  shipment: ShipmentCase,
  field: string,
  goodsLineId?: string,
): DeclarationFieldEntry {
  const found = getDeclarationEntry(
    shipment.declarationDraft,
    field,
    goodsLineId,
  );
  assert.ok(found, `${field} should be populated`);
  return found;
}
function packet() {
  const result = fixture();
  addSource(
    result.state,
    result.shipment,
    "invoice",
    "COMMERCIAL INVOICE\nBuyer: Example Buyer Ltd\nSeller: Example Seller Ltd\nInvoice No: SYN-INV-1\nInvoice Date: 2026-10-01\nCurrency: USD\nInvoice Total: 100.00\nIncoterm: FOB\nDescription | Quantity | Unit | Unit Price | Amount\nWidget | 2 | PCS | 50.00 | 100.00",
  );
  addSource(
    result.state,
    result.shipment,
    "packing",
    "PACKING LIST\nInvoice No: SYN-INV-1\nPackages: 5 PACKAGES\nGross weight: 10.00 KG\nNet weight: 9 KG",
    "packing_list",
  );
  addSource(
    result.state,
    result.shipment,
    "hbl",
    "HOUSE BILL OF LADING\nHBL No: SYN-HBL-1\nMBL No: SYN-MBL-1\nShipper: Forwarding Company\nConsignee: Destination Agent\nVessel: SYNTHETIC VESSEL\nPort of Loading: Origin Port\nPort of Discharge: Destination Port\nPackages: 5 PACKAGES\nGross weight: 10 KG",
    "bill_of_lading",
  );
  return result;
}
const sync = (state: WorkspaceState, shipment: ShipmentCase) =>
  syncShipmentDeclaration(state, shipment, actor);

test("declaration autofill waits until shipment grouping is settled", () => {
  const { state, shipment } = packet();
  shipment.groupingConfirmed = false;
  sync(state, shipment);
  assert.deepEqual(shipment.declarationDraft, { schemaVersion: 1, fields: [] });
  shipment.groupingConfirmed = true;
  sync(state, shipment);
  assert.ok(shipment.declarationDraft!.fields.length > 0);
});

test("shipment autofill combines commercial, packing and transport documents with typed literal citations", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.13").value, {
    kind: "entity",
    name: "Example Buyer Ltd",
  });
  assert.deepEqual(entry(shipment, "1.20").value, {
    kind: "entity",
    name: "Example Seller Ltd",
  });
  assert.deepEqual(entry(shipment, "1.41").value, {
    kind: "reference",
    reference: "SYN-INV-1",
  });
  assert.deepEqual(entry(shipment, "1.42").value, {
    kind: "date",
    date: "2026-10-01",
  });
  assert.deepEqual(entry(shipment, "1.44").value, {
    kind: "invoice",
    priceCategoryCode: "",
    incotermCode: "FOB",
    currencyCode: "USD",
    amount: "100.00",
  });
  assert.deepEqual(entry(shipment, "1.27").value, {
    kind: "quantity",
    amount: "5",
    unitCode: "PACKAGES",
  });
  const grossWeight = entry(shipment, "1.28").value;
  assert.equal(grossWeight.kind === "quantity" && grossWeight.amount, "10");
  assert.deepEqual(entry(shipment, "1.26").value, {
    kind: "reference_rows",
    rows: [{ id: "source-houseBillOfLading", reference: "SYN-HBL-1" }],
  });
  assert.deepEqual(entry(shipment, "1.33").value, {
    kind: "location",
    code: "",
    name: "Destination Port",
  });
  const goodsId = shipment.goods[0].id;
  assert.deepEqual(entry(shipment, "1.83", goodsId).value, {
    kind: "quantity",
    amount: "2",
    unitCode: "PCS",
  });
  assert.deepEqual(entry(shipment, "1.85", goodsId).value, {
    kind: "decimal",
    amount: "100.00",
  });
  assert.deepEqual(entry(shipment, "1.86", goodsId).value, {
    kind: "unit_price",
    amount: "50.00",
    currencyCode: "USD",
    unitCode: "PCS",
  });
  for (const draft of shipment.declarationDraft!.fields) {
    assert.equal(draft.generatedBy, "shipment_extraction");
    assert.equal(draft.review, null);
    assert.equal(draft.codeVerification, "unverified");
    assert.ok(draft.provenance.length);
    assert.ok(draft.sourceCandidateIds?.length);
    assert.ok(
      !validateDeclarationEntry(
        draft,
        {
          caseId: shipment.id,
          documents: state.documents,
          goods: shipment.goods,
        },
        shipment.declarationDraft,
      ).some((problem) => problem.code === "provenance"),
    );
  }
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.4"),
    undefined,
    "No customs procedure is inferred.",
  );
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.79", goodsId),
    undefined,
    "No origin code is inferred from shipment route.",
  );
});

test("duplicate totals are compared exactly, never summed, and input order does not affect draft values", () => {
  const { state, shipment } = packet();
  addSource(
    state,
    shipment,
    "invoice-copy",
    "COMMERCIAL INVOICE\nInvoice No: SYN-INV-1\nInvoice Total: 0100.000\nCurrency: USD",
  );
  sync(state, shipment);
  const value = entry(shipment, "1.44").value;
  assert.ok(value.kind === "invoice");
  assert.equal(normalizedShipmentValue("invoiceTotal", value.amount), "100");
  const before = shipment.declarationDraft!.fields.map((field) => [
    field.fieldId,
    field.goodsLineId,
    field.value,
  ]);
  const shuffled = structuredClone(state);
  const shuffledShipment = shuffled.cases[0];
  shuffled.candidates.reverse();
  shuffled.documents.reverse();
  shuffledShipment.declarationDraft = { schemaVersion: 1, fields: [] };
  sync(shuffled, shuffledShipment);
  assert.deepEqual(
    shuffledShipment.declarationDraft.fields.map((field) => [
      field.fieldId,
      field.goodsLineId,
      field.value,
    ]),
    before,
  );
  assert.equal(
    normalizedShipmentValue(
      "invoiceTotal",
      "9007199254740993.0000000000000001",
    ),
    "9007199254740993.0000000000000001",
  );
});

test("conflicting components stay empty while uncontested parts of the same field still populate", () => {
  const { state, shipment } = packet();
  addSource(
    state,
    shipment,
    "invoice-conflict",
    "COMMERCIAL INVOICE\nInvoice No: SYN-INV-1\nInvoice Total: 200.00\nCurrency: USD",
  );
  sync(state, shipment);
  const draft = entry(shipment, "1.44");
  assert.deepEqual(draft.value, {
    kind: "invoice",
    priceCategoryCode: "",
    incotermCode: "FOB",
    currencyCode: "USD",
    amount: "",
  });
  assert.equal(draft.stale, true);
  assert.equal(
    buildShipmentFacts(state, shipment).invoiceTotal.status,
    "conflict",
  );
  assert.deepEqual(
    buildShipmentFacts(state, shipment).invoiceTotal.alternatives.map(
      (value) => value.value,
    ),
    ["100.00", "200.00"],
  );
});

test("container subsets form one set of evidence rather than a false scalar disagreement", () => {
  const { state, shipment } = fixture();
  addSource(
    state,
    shipment,
    "full-bill",
    "BILL OF LADING\nContainer No: ABCD1234567, EFGH1234567",
    "bill_of_lading",
  );
  addSource(
    state,
    shipment,
    "partial-packing",
    "PACKING LIST\nContainer No: ABCD1234567",
    "packing_list",
  );
  const fact = buildShipmentFacts(state, shipment).container;
  assert.equal(fact.status, "agreed");
  assert.equal(fact.value, "ABCD1234567, EFGH1234567");
  sync(state, shipment);
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.35"),
    undefined,
    "The number of observed containers does not prove a complete shipment count.",
  );
});

test("late corroboration preserves a reviewed field, but changed facts only flag the affected decision", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  const invoice = entry(shipment, "1.41");
  const weight = entry(shipment, "1.28");
  for (const field of [invoice, weight])
    field.review = {
      actorId: actor.id,
      actorName: actor.name,
      at,
      reason: "Synthetic evidence checked.",
    };
  const invoiceBefore = structuredClone(invoice);
  const savedWeight = structuredClone(weight.value);
  addSource(
    state,
    shipment,
    "same-invoice",
    "COMMERCIAL INVOICE\nInvoice No: SYN-INV-1",
  );
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.41"), invoiceBefore);
  addSource(
    state,
    shipment,
    "new-weight",
    "PACKING LIST\nGross weight: 12 KG",
    "packing_list",
  );
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.41"), invoiceBefore);
  assert.deepEqual(entry(shipment, "1.28").value, savedWeight);
  assert.equal(entry(shipment, "1.28").stale, true);
  assert.ok(entry(shipment, "1.28").review);
});

test("a manual declaration decision gets a comparison baseline and is not overwritten", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  const manual: DeclarationValue = {
    kind: "invoice",
    priceCategoryCode: "",
    incotermCode: "FOB",
    currencyCode: "USD",
    amount: "95.00",
  };
  shipment.declarationDraft = saveDeclarationField(
    shipment.declarationDraft,
    {
      type: "save_declaration_field",
      caseId: shipment.id,
      fieldId: "1.44",
      applicability: "applicable",
      basis: "Synthetic approved discount.",
      value: manual,
      provenance: [
        {
          kind: "manual",
          note: "Synthetic corrected commercial amount confirmed.",
        },
      ],
      reason: "Synthetic confirmed discount.",
      review: true,
    },
    {
      caseId: shipment.id,
      documents: state.documents,
      goods: shipment.goods,
      actor,
      at,
    },
  );
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.44").value, manual);
  assert.equal(entry(shipment, "1.44").stale, false);
  addSource(
    state,
    shipment,
    "later-amount",
    "COMMERCIAL INVOICE\nInvoice Total: 105.00",
  );
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.44").value, manual);
  assert.equal(entry(shipment, "1.44").stale, true);
});

test("revoked evidence leaves an explicit stale value; unrelated manually entered fields remain current", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  shipment.declarationDraft!.fields.push({
    fieldId: "1.69",
    applicability: "applicable",
    basis: "Synthetic internal record.",
    value: { kind: "reference", reference: "MANUAL-INTERNAL" },
    provenance: [{ kind: "manual", note: "Synthetic internal reference." }],
    reason: "Synthetic manual input.",
    review: {
      actorId: actor.id,
      actorName: actor.name,
      at,
      reason: "Checked.",
    },
    stale: false,
    updatedBy: actor.id,
    updatedAt: at,
    codeVerification: "unverified",
  });
  const saved = structuredClone(entry(shipment, "1.42").value);
  state.documents.find((doc) => doc.id === "invoice")!.active = false;
  sync(state, shipment);
  assert.deepEqual(entry(shipment, "1.42").value, saved);
  assert.equal(entry(shipment, "1.42").stale, true);
  assert.equal(entry(shipment, "1.69").stale, false);
  assert.equal(
    buildShipmentFacts(state, shipment).invoiceNumber?.candidates.some(
      (candidate) => candidate.documentId === "invoice",
    ) ?? false,
    false,
  );
});

test("ambiguous number/date formats are not guessed, and missing units remain explicit blank components", () => {
  const { state, shipment } = fixture();
  addSource(
    state,
    shipment,
    "ambiguous",
    "COMMERCIAL INVOICE\nInvoice Date: 03/04/2026\nInvoice Total: 1,000\nCurrency: USD\nGross weight: 15",
  );
  sync(state, shipment);
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.42"),
    undefined,
  );
  assert.deepEqual(entry(shipment, "1.44").value, {
    kind: "invoice",
    priceCategoryCode: "",
    incotermCode: "",
    currencyCode: "USD",
    amount: "",
  });
  assert.deepEqual(entry(shipment, "1.28").value, {
    kind: "quantity",
    amount: "15",
    unitCode: "",
  });
});

test("invented or cross-page candidate text cannot become declaration provenance", () => {
  const { state, shipment } = fixture();
  addSource(
    state,
    shipment,
    "source",
    "COMMERCIAL INVOICE\nInvoice No: REAL-REFERENCE",
  );
  const candidate = state.candidates.find(
    (candidate) => candidate.field === "invoiceNumber",
  )!;
  candidate.value = "FORGED-REFERENCE";
  candidate.originalText = "COMMERCIAL INVOICE\nFORGED-REFERENCE";
  sync(state, shipment);
  assert.equal(
    getDeclarationEntry(shipment.declarationDraft, "1.41"),
    undefined,
  );
});

test("rebuilding unchanged source data is a no-op and old snapshots are untouched", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  state.snapshots.push({
    id: "synthetic-snapshot",
    caseId: shipment.id,
    createdAt: at,
    actor: actor.name,
    version: 1,
    declaration: structuredClone(shipment),
    candidates: structuredClone(state.candidates),
    documents: structuredClone(state.documents),
    issues: [],
    customsValidation: "Not yet assessed",
  });
  const before = JSON.stringify(state);
  sync(state, shipment);
  assert.equal(JSON.stringify(state), before);
});

test("ordinary extracted drafts do not generate redundant questions, but actual problems still do", () => {
  const { state, shipment } = packet();
  sync(state, shipment);
  const context = {
    caseId: shipment.id,
    documents: state.documents,
    goods: shipment.goods,
  };
  assert.equal(
    getDeclarationIssues(shipment.declarationDraft, context).length,
    0,
  );
  assert.ok(
    shipment.declarationDraft!.fields.every((field) => field.review === null),
    "Removing repetitive questions must not fabricate human reviews.",
  );
  addSource(
    state,
    shipment,
    "conflicting-total",
    "COMMERCIAL INVOICE\nInvoice Total: 500.00",
  );
  sync(state, shipment);
  assert.ok(
    getDeclarationIssues(shipment.declarationDraft, context).some(
      (issue) => issue.field === "1.44",
    ),
  );
  const packageField = entry(shipment, "1.27");
  packageField.generatedBy = undefined;
  assert.ok(
    getDeclarationIssues(shipment.declarationDraft, context).some(
      (issue) => issue.field === "1.27",
    ),
    "An unfinished manual decision remains reviewable.",
  );
  packageField.generatedBy = "shipment_extraction";
  packageField.provenance = [];
  assert.ok(
    getDeclarationIssues(shipment.declarationDraft, context).some(
      (issue) => issue.field === "1.27",
    ),
    "Source proof is still required.",
  );
});

test("party comparisons ignore only Unicode presentation and punctuation spacing, preserving exact source names", () => {
  const variants = [
    "Fictional Supplier Co.,Ltd.",
    "FICTIONAL SUPPLIER CO. , LTD.",
    "Ｆｉｃｔｉｏｎａｌ Supplier Co．，Ltd．",
  ];
  assert.equal(
    new Set(variants.map((value) => normalizedShipmentValue("exporter", value)))
      .size,
    1,
  );
  assert.notEqual(
    normalizedShipmentValue("exporter", variants[0]),
    normalizedShipmentValue("exporter", "Different Supplier Co.,Ltd."),
  );
  assert.notEqual(
    normalizedShipmentValue("exporter", "A.B Co."),
    normalizedShipmentValue("exporter", "AB Co."),
  );
  const { state, shipment } = fixture();
  for (const [index, variant] of variants.entries())
    addSource(
      state,
      shipment,
      `party-${index}`,
      `COMMERCIAL INVOICE\nExporter: ${variant}`,
    );
  const originalCandidates = structuredClone(state.candidates);
  const facts = buildShipmentFacts(state, shipment);
  assert.equal(facts.exporter.status, "agreed");
  syncShipmentDeclaration(state, shipment, actor);
  const seller = entry(shipment, "1.20");
  assert.equal(seller.value.kind, "entity");
  if (seller.value.kind === "entity")
    assert.ok(variants.includes(seller.value.name));
  assert.equal(seller.stale, false);
  assert.equal(seller.provenance.length, variants.length);
  assert.deepEqual(state.candidates, originalCandidates);
  addSource(
    state,
    shipment,
    "different-party",
    "COMMERCIAL INVOICE\nExporter: Different Supplier Co.,Ltd.",
  );
  assert.equal(buildShipmentFacts(state, shipment).exporter.status, "conflict");
  syncShipmentDeclaration(state, shipment, actor);
  assert.equal(entry(shipment, "1.20").stale, true);
});
