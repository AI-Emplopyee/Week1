import assert from 'node:assert/strict';
import test from 'node:test';
import { declarationDraftKey, hasDeclarationDrafts, clearSavedDeclarationDraft } from '../lib/declaration-client.ts';

test('declaration draft identity separates headers, goods IDs and cases without delimiter collisions', () => {
  const keys = [declarationDraftKey('case:1', '1.78', 'goods:a'), declarationDraftKey('case:1', '1.78', 'goods:b'), declarationDraftKey('case:1', '1.78'), declarationDraftKey('case:2', '1.78', 'goods:a')];
  assert.equal(new Set(keys).size, 4);
  assert.ok(hasDeclarationDrafts({ [keys[1]]: {} }, 'case:1'));
  assert.equal(hasDeclarationDrafts({ [keys[1]]: {}, malformed: {} }, 'case:2'), false);
});

test('late declaration saves retain newer input and unrelated field drafts', () => {
  const key = declarationDraftKey('case-1', '1.44'); const other = declarationDraftKey('case-1', '1.43');
  const submitted = { amount: '100', basis: 'Source A' }; const newer = { amount: '120', basis: 'Source B' }; const unrelated = { value: 'unchanged' };
  const drafts = { [key]: newer, [other]: unrelated };
  assert.strictEqual(clearSavedDeclarationDraft(drafts, key, submitted), drafts);
  const cleared = clearSavedDeclarationDraft({ [key]: submitted, [other]: unrelated }, key, submitted);
  assert.equal(cleared[key], undefined); assert.strictEqual(cleared[other], unrelated);
});
