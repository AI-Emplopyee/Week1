import {
  declarationEntryKey,
  DECLARATION_LIMITS,
  emptyDeclarationValue,
  isDeclarationSourceCurrent,
} from "./declaration.ts";
import { isIsoDate, parseExactDecimal } from "./integrity.ts";
import type {
  DeclarationFieldEntry,
  DeclarationProvenance,
  DeclarationValue,
} from "./declaration-types.ts";
import type {
  Actor,
  Candidate,
  ShipmentCase,
  ShipmentDocument,
  WorkspaceState,
} from "./types.ts";

const numericFields = new Set([
  "invoiceTotal",
  "packageCount",
  "grossWeight",
  "netWeight",
  "containerCount",
  "quantity",
  "unitPrice",
  "amount",
]);
const confidenceOrder = { high: 0, medium: 1, low: 2 };
const partyFields = new Set([
  "importer",
  "exporter",
  "transportShipper",
  "transportConsignee",
  "notifyParty",
  "houseShipper",
  "houseConsignee",
  "houseNotifyParty",
  "masterShipper",
  "masterConsignee",
  "masterNotifyParty",
]);

/** Compare exact decimal strings without ever converting money or weight to a JS float. */
export function normalizedShipmentValue(field: string, value: string): string {
  const trimmed = (partyFields.has(field) ? value.normalize("NFKC") : value)
    .trim()
    .replace(/\s+/g, " ");
  // Layout-only spacing differs between PDF/OCR sources. Keep punctuation and every
  // letter meaningful: this does not expand abbreviations or guess company names.
  if (partyFields.has(field))
    return trimmed.toLocaleLowerCase("en").replace(/\s*([.,])\s*/g, "$1");
  if (numericFields.has(field) && parseExactDecimal(trimmed)) {
    const [whole, fraction = ""] = trimmed.split(".");
    const decimal = fraction.replace(/0+$/, "");
    return `${whole.replace(/^0+(?=\d)/, "")}${decimal ? `.${decimal}` : ""}`;
  }
  const lowered = trimmed.toLocaleLowerCase("en");
  if (["unit", "grossWeightUnit", "packageUnit"].includes(field)) {
    const equivalentUnits: Record<string, string> = {
      kg: "kg",
      kgs: "kg",
      kilograms: "kg",
      kilogram: "kg",
      package: "package",
      packages: "package",
      pkg: "package",
      pkgs: "package",
      carton: "carton",
      cartons: "carton",
      ctn: "carton",
      ctns: "carton",
      case: "case",
      cases: "case",
      pallet: "pallet",
      pallets: "pallet",
      pc: "piece",
      pcs: "piece",
      piece: "piece",
      pieces: "piece",
    };
    return equivalentUnits[lowered] ?? lowered;
  }
  return lowered;
}

export type ShipmentFact = {
  field: string;
  status: "agreed" | "conflict" | "missing";
  value?: string;
  candidates: Candidate[];
  alternatives: { value: string; candidateIds: string[] }[];
};

function activeCandidates(
  state: WorkspaceState,
  shipment: ShipmentCase,
): Candidate[] {
  const documents = new Map(
    state.documents
      .filter((doc) => doc.active && !doc.referenceOnly && doc.caseId === shipment.id)
      .map((doc) => [doc.id, doc]),
  );
  return state.candidates.filter(
    (candidate) =>
      candidate.caseId === shipment.id &&
      candidate.documentVersion ===
        documents.get(candidate.documentId)?.version &&
      candidate.value.trim(),
  );
}

function reconcile(field: string, candidates: Candidate[]): ShipmentFact {
  const sorted = [...candidates].sort(
    (a, b) =>
      confidenceOrder[a.confidence] - confidenceOrder[b.confidence] ||
      a.value.localeCompare(b.value) ||
      a.id.localeCompare(b.id),
  );
  if (
    field === "container" &&
    sorted.length &&
    sorted.every((candidate) =>
      /^(?:[A-Z]{4}\d{7})(?:\s*[,;/]\s*[A-Z]{4}\d{7})*$/i.test(
        candidate.value.trim(),
      ),
    )
  ) {
    const value = [
      ...new Set(
        sorted.flatMap((candidate) =>
          candidate.value.toUpperCase().split(/\s*[,;/]\s*/),
        ),
      ),
    ]
      .sort()
      .join(", ");
    return {
      field,
      status: "agreed",
      value,
      candidates: sorted,
      alternatives: [
        { value, candidateIds: sorted.map((candidate) => candidate.id) },
      ],
    };
  }
  const groups = new Map<string, Candidate[]>();
  for (const candidate of sorted) {
    const key = normalizedShipmentValue(field, candidate.value);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const alternatives = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({
      value: group[0].value,
      candidateIds: group.map((candidate) => candidate.id),
    }));
  return {
    field,
    status: groups.size > 1 ? "conflict" : groups.size ? "agreed" : "missing",
    ...(groups.size === 1 ? { value: sorted[0].value } : {}),
    candidates: sorted,
    alternatives,
  };
}

/** All active header evidence, including collisions, is available to the question UI. */
export function buildShipmentFacts(
  state: WorkspaceState,
  shipment: ShipmentCase,
): Record<string, ShipmentFact> {
  const candidates = activeCandidates(state, shipment).filter(
    (candidate) => !candidate.lineId,
  );
  return Object.fromEntries(
    [...new Set(candidates.map((candidate) => candidate.field))]
      .sort()
      .map((field) => [
        field,
        reconcile(
          field,
          candidates.filter((candidate) => candidate.field === field),
        ),
      ]),
  );
}

/** Text citations remain literal; vision citations retain their separate saved image evidence. */
function candidateEvidence(
  candidate: Candidate,
  documents: Map<string, ShipmentDocument>,
): DeclarationProvenance[] {
  const document = documents.get(candidate.documentId);
  const page = document?.pages.find((page) => page.page === candidate.page);
  if (!document || !page || document.version !== candidate.documentVersion)
    return [];
  if (candidate.visualEvidence) {
    return [{
      kind: "document",
      documentId: document.id,
      documentVersion: document.version,
      page: page.page,
      quote: candidate.originalText,
      visualEvidence: { candidateId: candidate.id, ...candidate.visualEvidence },
    }];
  }
  const variants = [
    candidate.value,
    ...candidate.normalizations.map((change) => change.before),
  ].filter((value) => value.trim());
  const containsValue = (text: string) =>
    variants.some((value) =>
      text
        .replace(/\s+/g, " ")
        .toLowerCase()
        .includes(value.replace(/\s+/g, " ").toLowerCase()),
    );
  const snippets = page.text.includes(candidate.originalText)
    ? [candidate.originalText]
    : candidate.originalText
        .split(/\r?\n/)
        .filter((line) => line.trim() && page.text.includes(line));
  return snippets
    .filter(containsValue)
    .slice(0, 3)
    .flatMap((snippet) => {
      let quote = snippet;
      if (quote.length > 1600) {
        const offset = variants
          .map((value) => quote.toLowerCase().indexOf(value.toLowerCase()))
          .find((index) => index >= 0);
        if (offset === undefined) return [];
        quote = quote.slice(
          Math.max(0, offset - 200),
          Math.max(0, offset - 200) + 1600,
        );
        if (!containsValue(quote)) return [];
      }
      return [
        {
          kind: "document" as const,
          documentId: document.id,
          documentVersion: document.version,
          page: page.page,
          quote,
        },
      ];
    });
}

/** A clear source fact is a draft value, never a fabricated human approval. */
export function isShipmentFactClear(
  state: WorkspaceState,
  field: string,
  candidates: readonly Candidate[],
): boolean {
  if (!candidates.length) return false;
  const fact = reconcile(field, [...candidates]);
  if (fact.status !== "agreed" || !fact.value) return false;
  if (
    (numericFields.has(field) && !parseExactDecimal(fact.value, {
      integer: ["packageCount", "containerCount"].includes(field),
    })) ||
    (["invoiceDate", "packingListDate", "arrivalDate"].includes(field) &&
      !isIsoDate(fact.value))
  ) return false;
  const documents = new Map(state.documents
    .filter((document) => document.active && !document.referenceOnly)
    .map((document) => [document.id, document]));
  const supported = candidates.filter((candidate) => {
    const document = documents.get(candidate.documentId);
    return document?.caseId === candidate.caseId &&
      document.version === candidate.documentVersion &&
      document.pages.find(page => page.page === candidate.page)?.aiReadability !== "uncertain" &&
      (candidate.confidence !== "high" || !candidate.method.startsWith("kimi:") || candidate.readability === "clear") &&
      candidateEvidence(candidate, documents).length > 0;
  });
  const clear = (evidence: readonly Candidate[]) =>
    evidence.some((candidate) => candidate.confidence === "high") ||
    new Set(evidence.filter((candidate) => candidate.confidence === "medium")
      .map((candidate) => documents.get(candidate.documentId)!.sha256)).size >= 2;
  if (field === "container") {
    // A clear container must not silently validate a different, uncertain one.
    const tokens = fact.value.toUpperCase().match(/[A-Z]{4}\d{7}/g);
    if (tokens?.length) return tokens.every((token) => clear(supported.filter(
      (candidate) => candidate.value.toUpperCase().match(/[A-Z]{4}\d{7}/g)?.includes(token),
    )));
  }
  return clear(supported);
}

type Part = {
  value: string;
  fact: ShipmentFact;
  provenance: DeclarationProvenance[];
  unknown?: boolean;
};
type Proposal = {
  fieldId: string;
  goodsLineId?: string;
  value: DeclarationValue;
  parts: Part[];
};
const missingFact = (field: string): ShipmentFact => ({
  field,
  status: "missing",
  candidates: [],
  alternatives: [],
});

function uniqueEvidence(
  evidence: DeclarationProvenance[],
): DeclarationProvenance[] {
  return [
    ...new Map(
      evidence.map((source) => [JSON.stringify(source), source]),
    ).values(),
  ].slice(0, DECLARATION_LIMITS.maxProvenance);
}

function valuePresent(value: DeclarationValue): boolean {
  return "rows" in value
    ? value.rows.some((row) =>
        Object.entries(row).some(
          ([key, content]) => key !== "id" && content.trim(),
        ),
      )
    : Object.entries(value).some(
        ([key, content]) => key !== "kind" && String(content).trim(),
      );
}

function semanticFingerprint(proposal: Proposal): string {
  // This is a comparison token, not a security hash. New copies of the same value
  // do not invalidate a human decision simply because their document IDs differ.
  return JSON.stringify(
    proposal.parts.map((part) => [
      part.fact.field,
      part.fact.alternatives
        .map((item) => normalizedShipmentValue(part.fact.field, item.value))
        .sort(),
      normalizedShipmentValue(part.fact.field, part.value),
      !!part.unknown,
    ]),
  );
}

function proposalsFor(
  state: WorkspaceState,
  shipment: ShipmentCase,
): Proposal[] {
  const documents = new Map(
    state.documents
      .filter((doc) => doc.active && doc.caseId === shipment.id)
      .map((doc) => [doc.id, doc]),
  );
  const candidates = activeCandidates(state, shipment);
  const header = buildShipmentFacts(state, shipment);
  const proposals: Proposal[] = [];
  const part = (
    field: string,
    available?: Candidate[],
    allowReviewed = true,
  ): Part => {
    const fact = available
      ? reconcile(
          field,
          available.filter((candidate) => candidate.field === field),
        )
      : (header[field] ?? missingFact(field));
    const reviewed = allowReviewed ? shipment.fields[field] : undefined;
    if (reviewed && !reviewed.stale && reviewed.value.trim()) {
      const chosen = fact.candidates.find(
        (candidate) =>
          candidate.id === reviewed.candidateId &&
          normalizedShipmentValue(field, candidate.value) ===
            normalizedShipmentValue(field, reviewed.value),
      );
      const provenance = chosen ? candidateEvidence(chosen, documents) : [];
      if (reviewed.source === "manual" || provenance.length)
        return {
          value: reviewed.value,
          fact: { ...fact, status: "agreed" },
          provenance: provenance.length
            ? provenance
            : [
                {
                  kind: "manual",
                  note: `${field}: ${reviewed.reason || "Value entered by the responsible reviewer."}`.slice(
                    0,
                    4000,
                  ),
                },
              ],
        };
    }
    const provenance = uniqueEvidence(
      fact.candidates.flatMap((candidate) =>
        candidateEvidence(candidate, documents),
      ),
    );
    return {
      value: fact.status === "agreed" && provenance.length ? fact.value! : "",
      fact,
      provenance,
      unknown: fact.status === "agreed" && !provenance.length,
    };
  };
  const checked = (source: Part, valid: (value: string) => boolean): Part =>
    source.value && !valid(source.value)
      ? { ...source, value: "", unknown: true }
      : source;
  const decimal = (source: Part, integer = false) =>
    checked(source, (value) => !!parseExactDecimal(value, { integer }));
  const add = (
    fieldId: string,
    components: Record<string, Part>,
    goodsLineId?: string,
  ) => {
    const bounded = Object.fromEntries(
      Object.entries(components).map(([key, source]) => [
        key,
        checked(
          source,
          (value) =>
            value.length <=
            (key === "text"
              ? DECLARATION_LIMITS.maxTextLength
              : DECLARATION_LIMITS.maxComponentLength),
        ),
      ]),
    );
    const value = emptyDeclarationValue(fieldId);
    Object.assign(
      value,
      Object.fromEntries(
        Object.entries(bounded).map(([key, source]) => [key, source.value]),
      ),
    );
    proposals.push({
      fieldId,
      ...(goodsLineId ? { goodsLineId } : {}),
      value,
      parts: Object.values(bounded),
    });
  };

  // Commercial and transport parties deliberately stay separate. A master bill's
  // carrier/forwarder is never silently substituted for the commercial buyer.
  add("1.13", { name: part("importer") });
  add("1.15", { text: part("importerAddress") });
  add("1.16", { text: part("importerTelephone") });
  add("1.20", { name: part("exporter") });
  add("1.22", {
    line1: part("exporterAddress"),
    line2: part("exporterAddressLine2"),
    city: part("exporterCity"),
    country: part("exporterCountry"),
  });
  add("1.41", { reference: part("invoiceNumber") });
  add("1.42", { date: checked(part("invoiceDate"), isIsoDate) });
  add("1.44", {
    incotermCode: checked(part("incoterm"), (value) =>
      /^[A-Z]{3}$/i.test(value),
    ),
    currencyCode: checked(part("currency"), (value) =>
      /^[A-Z]{3}$/i.test(value),
    ),
    amount: decimal(part("invoiceTotal")),
  });
  add("1.31", { name: part("vessel") });
  add("1.32", { date: checked(part("arrivalDate"), isIsoDate) });
  add("1.33", { name: part("portOfDischarge") });
  add("1.34", { name: part("portOfLoading") });
  add("1.35", { count: decimal(part("containerCount"), true) });

  const transportField = [
    "houseBillOfLading",
    "billOfLading",
    "masterBillOfLading",
  ].find(
    (field) =>
      header[field]?.candidates.length || shipment.fields[field]?.value,
  );
  if (transportField) {
    const source = part(transportField);
    proposals.push({
      fieldId: "1.26",
      value: {
        kind: "reference_rows",
        rows: source.value
          ? [{ id: `source-${transportField}`, reference: source.value }]
          : [],
      },
      parts: [source],
    });
  }

  const sourceUnit = (
    source: Part,
    explicitKey: string,
    expression: RegExp,
  ): Part => {
    const explicit = part(explicitKey);
    if (explicit.fact.status !== "missing") return explicit;
    const units = source.fact.candidates.flatMap((candidate) => {
      const found = [...candidate.originalText.matchAll(expression)].map(
        (match) => match[1].toUpperCase(),
      );
      return [...new Set(found)].map((value) => ({
        ...candidate,
        field: explicitKey,
        value,
      }));
    });
    return part(explicitKey, units, false);
  };
  const packages = decimal(part("packageCount"), true);
  add("1.27", {
    amount: packages,
    unitCode: sourceUnit(
      packages,
      "packageUnit",
      /\b(PACKAGES?|PKGS?|CARTONS?|CTNS?|CASES?|PALLETS?)\b/gi,
    ),
  });
  const weight = decimal(part("grossWeight"));
  add("1.28", {
    amount: weight,
    unitCode: sourceUnit(
      weight,
      "grossWeightUnit",
      /\b(KGS?|KGM|TONNES?|TONS?|LBS?)\b/gi,
    ),
  });

  for (const line of shipment.goods) {
    const own = candidates.filter((candidate) => candidate.lineId === line.id);
    const description = normalizedShipmentValue(
      "description",
      line.description,
    );
    const sameDescription = candidates.filter(
      (candidate) =>
        candidate.lineId &&
        candidate.field === "description" &&
        normalizedShipmentValue("description", candidate.value) === description,
    );
    // A description can link a second document only when it uniquely identifies
    // one row in each document. Repeated descriptions never collapse two items.
    const uniqueLineIds = new Set<string>([line.id]);
    if (
      shipment.goods.filter(
        (other) =>
          normalizedShipmentValue("description", other.description) ===
          description,
      ).length === 1
    ) {
      for (const candidate of sameDescription)
        if (
          new Set(
            sameDescription
              .filter((other) => other.documentId === candidate.documentId)
              .map((other) => other.lineId),
          ).size === 1
        )
          uniqueLineIds.add(candidate.lineId!);
    }
    const joined = candidates.filter(
      (candidate) => candidate.lineId && uniqueLineIds.has(candidate.lineId),
    );
    const itemPart = (field: string) => {
      // Manual goods decisions remain authoritative. Propagate their exact value
      // as a draft with an explicit manual basis, never as invented PDF evidence.
      if (
        line.manual &&
        [
          "description",
          "quantity",
          "unit",
          "unitPrice",
          "amount",
          "hsCode",
          "origin",
        ].includes(field)
      ) {
        const value = String(line[field as keyof typeof line] ?? "");
        return {
          value,
          fact: reconcile(
            field,
            joined.filter((candidate) => candidate.field === field),
          ),
          provenance: [
            {
              kind: "manual" as const,
              note: `${field}: ${line.reason || "Goods value entered by the responsible reviewer."}`.slice(
                0,
                4000,
              ),
            },
          ],
        };
      }
      const baselineUnit = own.find(
        (candidate) => candidate.field === "unit",
      )?.value;
      const comparable =
        ["quantity", "unit", "unitPrice", "amount"].includes(field) &&
        baselineUnit
          ? joined.filter((candidate) => {
              const unit = joined.find(
                (item) =>
                  item.lineId === candidate.lineId && item.field === "unit",
              )?.value;
              return (
                !unit ||
                normalizedShipmentValue("unit", unit) ===
                  normalizedShipmentValue("unit", baselineUnit)
              );
            })
          : joined;
      return part(field, comparable, false);
    };
    add("1.78", { text: itemPart("description") }, line.id);
    add(
      "1.83",
      { amount: decimal(itemPart("quantity")), unitCode: itemPart("unit") },
      line.id,
    );
    add("1.85", { amount: decimal(itemPart("amount")) }, line.id);
    add(
      "1.86",
      {
        amount: decimal(itemPart("unitPrice")),
        currencyCode: checked(part("currency"), (value) =>
          /^[A-Z]{3}$/i.test(value),
        ),
        unitCode: itemPart("unit"),
      },
      line.id,
    );
    add(
      "1.74",
      {
        code: checked(itemPart("hsCode"), (value) => /^\d{4,10}$/.test(value)),
      },
      line.id,
    );
    add(
      "1.79",
      {
        code: checked(itemPart("origin"), (value) => /^[A-Z]{2}$/i.test(value)),
      },
      line.id,
    );
  }
  return proposals;
}

function sourceRevoked(
  entry: DeclarationFieldEntry,
  state: WorkspaceState,
  shipment: ShipmentCase,
): boolean {
  return (
    (!!entry.goodsLineId &&
      !shipment.goods.some((line) => line.id === entry.goodsLineId)) ||
    entry.provenance.some((source) => {
      if (source.kind !== "document") return false;
      return !isDeclarationSourceCurrent(source, {
        caseId: shipment.id,
        documents: state.documents,
        goods: shipment.goods,
        candidates: state.candidates,
      });
    })
  );
}

function contradictsSaved(
  proposal: Proposal,
  entry: DeclarationFieldEntry,
): boolean {
  if (
    proposal.parts.some(
      (part) => part.fact.status === "conflict" || part.unknown,
    )
  )
    return true;
  if (proposal.value.kind !== entry.value.kind) return true;
  if ("rows" in proposal.value) {
    if (!("rows" in entry.value)) return true;
    const savedRows = entry.value.rows
      .map((row) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(row).filter(([key]) => key !== "id"),
          ),
        ),
      )
      .sort();
    const proposedRows = proposal.value.rows
      .map((row) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(row).filter(([key]) => key !== "id"),
          ),
        ),
      )
      .sort();
    return (
      proposedRows.length > 0 &&
      JSON.stringify(savedRows) !== JSON.stringify(proposedRows)
    );
  }
  return Object.entries(proposal.value).some(
    ([key, value]) =>
      key !== "kind" &&
      value &&
      normalizedShipmentValue(
        ["amount", "count"].includes(key) ? "amount" : key,
        value,
      ) !==
        normalizedShipmentValue(
          ["amount", "count"].includes(key) ? "amount" : key,
          String((entry.value as unknown as Record<string, string>)[key] ?? ""),
        ),
  );
}

/** Run once after a whole shipment has been grouped and its evidence rebuilt. */
export function syncShipmentDeclaration(
  state: WorkspaceState,
  shipment: ShipmentCase,
  actor: Actor,
): void {
  if (
    shipment.caseType !== "import" ||
    shipment.mergedInto ||
    shipment.status === "completed" ||
    !shipment.groupingConfirmed
  )
    return;
  shipment.declarationDraft ??= { schemaVersion: 1, fields: [] };
  const draft = shipment.declarationDraft;
  const before = structuredClone(draft);
  const proposals = proposalsFor(state, shipment);
  const at = new Date().toISOString();
  const handled = new Set<string>();
  for (const proposal of proposals) {
    const key = declarationEntryKey(proposal.fieldId, proposal.goodsLineId);
    handled.add(key);
    const index = draft.fields.findIndex(
      (entry) => declarationEntryKey(entry.fieldId, entry.goodsLineId) === key,
    );
    const prior = index >= 0 ? draft.fields[index] : undefined;
    const fingerprint = semanticFingerprint(proposal);
    const evidence = uniqueEvidence(
      proposal.parts.flatMap((part) => part.provenance),
    );
    const collision = proposal.parts.some(
      (part) => part.fact.status === "conflict" || part.unknown,
    );
    const missing = !valuePresent(proposal.value);
    if (
      prior &&
      (prior.generatedBy !== "shipment_extraction" || prior.review)
    ) {
      const changed =
        prior.sourceFingerprint !== undefined &&
        prior.sourceFingerprint !== fingerprint;
      if (
        sourceRevoked(prior, state, shipment) ||
        (changed && contradictsSaved(proposal, prior))
      ) {
        prior.stale = true;
        prior.staleReason =
          "Supporting shipment evidence changed; retain and review the saved decision.";
      }
      prior.sourceFingerprint = fingerprint;
      continue;
    }
    if (missing) {
      if (prior) {
        prior.stale = true;
        prior.staleReason = collision
          ? "Shipment sources disagree; no value was selected automatically."
          : "Active shipment sources no longer support this extracted value.";
        prior.sourceFingerprint = fingerprint;
      }
      continue;
    }
    const next: DeclarationFieldEntry = {
      fieldId: proposal.fieldId,
      ...(proposal.goodsLineId ? { goodsLineId: proposal.goodsLineId } : {}),
      applicability: "applicable",
      basis:
        "Captured from the combined shipment evidence. This is a draft, not legal or ECUS code validation.",
      value: proposal.value,
      provenance: evidence,
      reason:
        "Shipment documents reconciled before declaration autofill; repeated facts were compared, not added.",
      review: null,
      stale: collision,
      ...(collision
        ? {
            staleReason:
              "Shipment sources disagree or a value cannot be safely read; affected components remain empty.",
          }
        : {}),
      updatedBy: actor.id,
      updatedAt: at,
      codeVerification: "unverified",
      generatedBy: "shipment_extraction",
      sourceFingerprint: fingerprint,
      sourceCandidateIds: [
        ...new Set(
          proposal.parts.flatMap((part) =>
            part.fact.candidates.map((candidate) => candidate.id),
          ),
        ),
      ].sort(),
    };
    // Preserve timestamps and avoid audit churn when rebuilding identical evidence.
    if (
      prior &&
      JSON.stringify({ ...prior, updatedAt: "", updatedBy: "" }) ===
        JSON.stringify({ ...next, updatedAt: "", updatedBy: "" })
    )
      continue;
    if (index >= 0) draft.fields[index] = next;
    else if (draft.fields.length < DECLARATION_LIMITS.maxEntries)
      draft.fields.push(next);
  }
  for (const entry of draft.fields)
    if (
      !handled.has(declarationEntryKey(entry.fieldId, entry.goodsLineId)) &&
      sourceRevoked(entry, state, shipment)
    ) {
      entry.stale = true;
      entry.staleReason =
        "The supporting document or goods row is no longer active in this shipment.";
    }
  if (JSON.stringify(before) !== JSON.stringify(draft)) {
    const affected = draft.fields.filter(
      (entry) =>
        JSON.stringify(
          before.fields.find(
            (previous) =>
              declarationEntryKey(previous.fieldId, previous.goodsLineId) ===
              declarationEntryKey(entry.fieldId, entry.goodsLineId),
          ),
        ) !== JSON.stringify(entry),
    );
    state.audit.push({
      id: `audit-${crypto.randomUUID()}`,
      caseId: shipment.id,
      at,
      actor: actor.name,
      action: "shipment_declaration_synchronized",
      reason:
        "Combined current shipment sources into draft fields; human decisions retained and affected evidence changes flagged.",
      before: before.fields.filter((entry) =>
        affected.some(
          (next) =>
            declarationEntryKey(next.fieldId, next.goodsLineId) ===
            declarationEntryKey(entry.fieldId, entry.goodsLineId),
        ),
      ),
      after: structuredClone(affected),
    });
  }
}
