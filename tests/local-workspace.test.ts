import test from "node:test";
import assert from "node:assert/strict";
import { authAvailability } from "../lib/account-validation.ts";
import { reviewerForMode } from "../lib/client-reviewer.ts";
import { clearSavedGoodsDraft } from "../lib/client-drafts.ts";
import { translate } from "../lib/i18n-core.ts";
import type { GoodsLine } from "../lib/types.ts";

const line: GoodsLine = {
  id: "line-1",
  description: "Vải lụa",
  quantity: "2",
  unit: "M",
  unitPrice: "10",
  amount: "20",
  hsCode: "5208",
  origin: "VN",
  dutyRate: "5",
  vatRate: "10",
  reviewed: true,
  manual: true,
};
test("configured local mode remains local rather than choosing any login provider", () => {
  assert.equal(authAvailability({ mode: "local", configured: true }), "local");
  assert.equal(translate("en", "Cục bộ · một người"), "Local · single user");
  assert.equal(translate("vi", "Cục bộ · một người"), "Cục bộ · một người");
});

test("goods success clears only its submitted draft without mutating other cases", () => {
  const submitted = [{ ...line }];
  const other = [{ ...line, id: "line-other" }];
  const drafts = { "case-1": submitted, "case-2": other };
  const cleared = clearSavedGoodsDraft(drafts, "case-1", submitted);
  assert.equal(cleared["case-1"], undefined);
  assert.strictEqual(cleared["case-2"], other);
  assert.strictEqual(
    drafts["case-1"],
    submitted,
    "original state stays immutable",
  );
});

test("late goods success preserves newer edits including a new empty table", () => {
  const submitted = [{ ...line }];
  const newer = [{ ...line, quantity: "7" }];
  for (const changed of [newer, []]) {
    const drafts = { "case-1": changed };
    assert.strictEqual(
      clearSavedGoodsDraft(drafts, "case-1", submitted),
      drafts,
    );
  }
  const noDraft = {};
  assert.strictEqual(
    clearSavedGoodsDraft(noDraft, "case-1", submitted),
    noDraft,
  );
});

test("local settings and case-edit reviewer choices use the authenticated actor, while shared choices stay intact", () => {
  const actor = {
    id: "local_mac_owner",
    name: "Local owner (this Mac)",
    email: "local-owner@aicd.invalid",
  };
  for (const input of ["", "Simon", "old-shared-reviewer@example.com"])
    assert.equal(reviewerForMode(true, actor, input), actor.name);
  assert.equal(
    reviewerForMode(false, actor, "Another reviewer"),
    "Another reviewer",
  );
  assert.equal(reviewerForMode(false, actor, ""), "");
});
