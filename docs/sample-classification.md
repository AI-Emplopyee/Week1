# Sample collection classification

The October 2026 sample audit found 42 imported folders labeled `unsupported`.
The old batch preparation script assigned that label whenever every file was
reference-only **or** the folder name matched words such as export, a company
name, or a destination country. This was a coarse import-scope filter, not a
document-reading failure or an ECUS compatibility finding.

Review of the stored source contents produced these corrections, applied through the local application:

| Classification | Collections | Meaning |
| --- | ---: | --- |
| Reference | 25 | Supporting documents, images, templates or historical records, already designated reference-only at import |
| Export / re-export | 15 | Source documents establish goods leaving Vietnam |
| Direction needs review | 2 | Multiple historical movements or contradictory loading/discharge information require review |

These are source folders, not 42 verified individual shipments. In particular,
a historical import declaration can support a later re-export. A folder can also
contain commercial documents for genuinely different shipments. Direction must
come from the actual transaction and transport evidence, not a folder label.

The private repair plan contains the affected case IDs, original hashes and
document/page evidence. The live repair uses the ordinary audited `update_case`
action. Original files, extracted facts and source grouping are preserved; no
shipment is approved by the correction.

The data model now distinguishes `import`, `export`, `reference`, `unknown` and
legacy `unsupported`. The interface gives the specific explanation instead of
calling all four non-import categories unsupported. Reference collections do not
produce irrelevant missing-invoice or missing-import-field questions. Export
documents remain available for extraction and reference; an export declaration
form is not implemented. Unknown direction requires a source check first.

The existing ECUS-style form is an import form. Non-import records cannot autofill
it, save import declaration entries, approve it or use its test handoff. Existing
saved data is retained if a case is reclassified. Original import cases continue
through the existing checks and human review.

New source collections without an explicit case type default to `unknown`.
The batch script no longer infers direction from folder names. It reuses audited
classifications only when every source hash still matches; changed collections
need a fresh classification. Ordinary live document intake retains its existing
import workflow.
