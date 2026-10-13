# VNACCS Form 01 coverage reference

Version: `form01-2018-plus-121-2025-reference.2026-10-10.v1` · Research checked: 10 October 2026.

This registry inventories all **96 numbered import declaration indicators** in Form 01 of Appendix I to Circular 39/2018/TT-BTC, which amends Appendix II to Circular 38/2015/TT-BTC. It also records the **13 Form 01 indicators explicitly amended** by Appendix I, section 2(a), of Circular 121/2025/TT-BTC. It is a traceable implementation-gap inventory, **not a verified current declaration schema, an executable legal rule set, or evidence of 96-field compliance**.

The runtime data is in [`lib/vnaccs.ts`](../lib/vnaccs.ts) and [`lib/vnaccs-data.ts`](../lib/vnaccs-data.ts). [`vnaccs-coverage.json`](vnaccs-coverage.json) is the complete machine-readable snapshot. [`vnaccs-coverage.csv`](vnaccs-coverage.csv) is the compact review matrix; the JSON/module retain the longer Vietnamese source instructions.

## What the numbers mean

The baseline has 73 general indicators, numbered 1.1–1.73, and 23 goods indicators, 1.74–1.96. Indicator 1.1 is system-assigned; 1.70–1.73 are reserved for customs officers. The registry therefore identifies 68 header, 23 item and 5 customs-owned indicators. An indicator can contain several subfields or repeating groups: 1.44 has four subfields, 1.86 has three, and 1.38 accepts multiple permit entries. **96 indicators do not mean 96 scalar inputs.**

The source column headed **“Bảng mã”** identifies references to code tables. Its `X` is **not a mandatory-field marker**. Registry requirement categories are separate, conservative interpretations requiring qualified confirmation. A required indicator may have system-populated data or case-specific exceptions; a conditional indicator may be optional, deferred pending guidance, or mandatory only in a particular case. These labels are not enforced as filing law.

Every condition and validation note carries `source_read_human_confirmation_required`. Vietnamese official labels and source text are preserved; English labels and notes are AICD explanatory translations, not official legal translations. `reviewOwner` identifies a proposed AICD workflow responsibility, not a legally designated role or an assigned person.

## Verified sources and their limits

| Source | What was read or established |
| --- | --- |
| [39/2018/TT-BTC, MOIT-hosted official PDF](https://vntr.moit.gov.vn/storage/doc/file/1629725278%20_%2039.2018.TT-BTC.pdf#page=139) | Form 01 labels and instructions, physical PDF pages 139–168. All 96 rows are transcribed. |
| [39/2018 government register](https://vanban.chinhphu.vn/default.aspx?docid=193970&pageid=27160) | Issued 20 April 2018; effective 5 June 2018. This date is baseline provenance, not a statement that every baseline instruction remains current. |
| [121/2025 government register](https://vanban.chinhphu.vn/?docid=216623&pageid=27160) | Issued 18 December 2025; effective 1 February 2026. |
| [121/2025 official Gazette PDF](https://congbaocdn.chinhphu.vn/180507251028987904/2026/1/29/cong-bao-so-60-ngay-27-01-46958signed-1769648620477270334287.pdf#page=133) | Appendix I, section 2(a), physical pages 133–145: the 13 Form 01 amendments. Page 146 begins Form 02. The official Gazette DOCX attachment was also read for text extraction. |
| [121/2025 official Customs copy](https://files.customs.gov.vn/CustomsCMS/DONG_NAI/2025/12/26/121_2025_TT_BTC_18_12_2025.pdf) | Official scanned original located; searchable Gazette copy used for field-level transcription. |
| [Customs code-table index](https://www.customs.gov.vn/index.jsp?pageId=26&cid=1192) | Official index located. No complete, current, versioned code-table dataset could be retrieved and verified in this work. |
| [14828/CHQ-GSQL, 3 April 2026](https://files.customs.gov.vn/CustomsCMS/DONG_NAI/2026/4/3/14828_CHQ_GSQL_03_04_2026.pdf) | Later official implementation guidance exists. It is not a complete consolidated Form 01 specification or code-table release. |

No complete current tariff, procedure, country, unit, port/location, permit, tax or exemption table is loaded. Codes appearing in transcribed legal instructions are historical/reference text, not an active allowed-value set. The registry does not activate those codes, validate a case against them, or offer them as current filing choices.

Later implementation guidance, including material reported as 8444/CHQ-GSQL and 11811/CHQ-GSQL affecting invoice indicators 1.39/1.40, has **not** been verified against a complete primary-source copy. Secondary quotations were not used to activate or rewrite rules. The existence of later guidance and the absent current tables mean `currentLawConfirmed` remains `false` for the registry and every field. This work is not an exhaustive consolidation of intervening amendments to the 2018 baseline.

## Changes explicitly found in Circular 121/2025

These are summaries of the cited replacement instructions, not new executable rules. The module retains the full 2018 text and separate 2025 replacement text so a reviewer can see their provenance.

| Indicator | Change or emphasis in replacement instructions | Gazette PDF pages |
| --- | --- | --- |
| 1.12 | Importer identifier includes the designated recipient in on-the-spot imports. | 133 |
| 1.13 | Importer name includes the designated recipient; warehouse/system-populated cases remain specified. | 133 |
| 1.19 | Exporter identifier includes the designated domestic supplier for on-the-spot imports. | 133–134 |
| 1.20 | Exporter-name role instructions cover contractual seller, processing principal, on-the-spot supplier and bonded-warehouse cases. | 134 |
| 1.24 | Entrusting-exporter name includes the foreign party directing on-the-spot delivery, where applicable. | 134 |
| 1.38 | Permit guidance includes the stated defense/security import permit and exemption-notice cases, with `QPGP`/`MTTB` examples. These examples are not a complete permit code table. | 134–136 |
| 1.44 | Four-subfield invoice total instructions include DPU and a DAT-plus-detail instruction when DPU is unavailable in the system; special invoice/FOC cases still require review. | 136–140 |
| 1.50 | Valuation detail instructions include transport-document date syntax and consultation requests, including indirect consultation. | 140 |
| 1.68 | Remarks specify updated on-the-spot and provisional-release cases, separators and overflow/HYS handling. | 140–142 |
| 1.69 | Enterprise-reference syntax is updated for on-the-spot, processing/export-processing enterprise and other cases. It is not the application's case reference. | 142–143 |
| 1.74 | HS instructions refer to current nomenclature/tariffs, retain Chapter 98 treatment and add control/operating software imported before equipment. | 143 |
| 1.78 | Description specifies classification-relevant attributes and manufacturer, with machinery/component and other scenario instructions. A short commercial description does not establish compliance. | 143–145 |
| 1.80 | Replaces the old tariff-code enumeration with a reference to current Customs tables, Chapter 98 B02/B17 guidance, and the distinction between exempt and non-taxable treatment. | 145 |

## Source-fact relationships

This table describes the original extraction/review fact model. It is separate from the structured declaration editor described below: `not_implemented` here means no existing source-fact relationship, not that the new editor has no input for that indicator. These registry values are retained so earlier audit exports remain comparable.

| Status | Count | Meaning |
| --- | ---: | --- |
| `source_proposal` | 15 | Existing source-backed AICD values relate to **part** of this indicator. They still need review and do not constitute complete declaration subfields. |
| `manual_review` | 4 | An unverified manual AICD customs field relates to this indicator. No legal eligibility, classification or rate is automatically determined. |
| `not_implemented` | 72 | No relationship in the original source-fact model. Check the declaration catalogue separately for editable structures. |
| `system_owned` | 5 | Customs-assigned number or customs-officer instructions; AICD does not generate or modify them. |

There are **zero verified ECUS mappings** and **zero active legal rules**. These counts describe application relationships only; do not turn them into a completeness or readiness score.

The source relationships are 1.13, 1.20, 1.26–1.28, 1.31, 1.33–1.34, 1.41–1.42, 1.44, 1.78, 1.83, 1.85 and 1.86. The manual relationships are 1.4 (`customsProcedure`), 1.74 (`goods.hsCode`), 1.76 (`goods.dutyRate`) and 1.79 (`goods.origin`). Header `countryOfOrigin` is not automatically assigned to item origin.

Important distinctions deliberately preserved in the mapping:

- HBL, MBL and an untyped B/L remain separate source facts. A reviewer must select the correct transport document for 1.26.
- Package count lacks the official package-type code; gross weight lacks the complete mode/unit/precision structure; port names are not verified location codes.
- Invoice total/currency/Incoterm relate to three parts of 1.44. They do not provide the price category, all conditional instructions, or customs value.
- `container` contains identifiers, not the count in 1.35. AICD does not implement the separate HYS container-list format.
- `contractNumber` alone does not implement valuation details 1.50. AICD case `reference` does not implement 1.69. A goods-line ID does not implement the registered-list number in 1.75.
- AICD's single quantity/unit pair does not implement quantity (2), 1.84. Commercial item amount does not implement customs value, 1.87. A manual VAT percentage does not implement the tax-category/rate-code group in 1.94.
- HS, origin, valuation method, tariff eligibility, duty/tax relief and filing remain qualified human decisions. The registry does not add automatic assignments to the extraction engine.

## Structured declaration coverage

`lib/declaration-types.ts`, `lib/declaration-catalog.ts` and `lib/declaration.ts` add a separate, versioned declaration draft. The catalogue has 90 editable indicators, including partial capture for 1.48. Indicators 1.1 and 1.70–1.73 are customs-owned and read-only. Indicator 1.46 remains blocked because the source describes three unnamed cells with entry deferred pending guidance; inventing their meaning would misrepresent the source. The fourth cell of 1.48 is blocked for the same reason. Other components of 1.48 remain editable.

Compound values have named components, while transport references, permits, adjustments, transit points and tax groups use stable row IDs. Each item-level entry references a goods ID, never a mutable line index. A saved entry records applicability, its basis, document/version/page/quote or manual evidence, reason, reviewer/time and stale status. An empty entry is unresolved rather than assumed inapplicable.

Modelled/editable, source-proposed, saved, reviewed, structurally checked, current-law verified and ECUS verified describe different facts. Software validation checks declared types, dates, exact numeric strings, component pairs, evidence references and internal row relationships. It does not confirm tariff codes, code-table membership, legal precision, all required subfields or scenario-specific applicability. Untouched conditional indicators do not become invented mandatory filing requirements.

The user identified their broker's software as **ECUS5-VNACCS 2018**. The editor uses the vendor's published [General information 1](https://help.ecus.net.vn/6.1_TT_Chung_1.html), [General information 2](https://help.ecus.net.vn/6.2.ThongTinChung2.html) and [Goods](https://help.ecus.net.vn/6.3.2.TKN_DSHANG_B.html) organization as a familiar layout reference. These help pages do not prove an exact match to a particular installed build.

The exported JSON includes `summaryDimension`, `captureSummary` and per-indicator `capture` metadata. The CSV preserves its first 26 source-reference columns and appends 14 capture/dimension columns. Regenerate both with `node --experimental-strip-types scripts/export-vnaccs.ts`; `lib/vnaccs-export.ts` joins the two models without making the base reference registry depend on the editor. The tests compare both exports against runtime data.

## ECUS boundary

Every `ecusMapping` has `status: 'unverified'` and `target: null`. The user supplied the 2018 version label, but an exact installed build and vendor-confirmed import template/schema, encoding, field positions, date/decimal conventions and accepted example have not been supplied. No guessed ECUS column names are published. The existing **ECUS TEST** connector simulates creating an editable draft from a reviewed snapshot; it contacts no ECUS installation and does not establish any import mapping for these 96 indicators. IDA and IDC remain separate external operations and are not transmitted by this registry.

## Data and review conventions

`sourceKind` identifies possible evidence families: shipment documents, party/code master data, customs-system data and a reviewer decision. It does not imply that AICD presently retrieves all those sources. `coverage.aicdKeys` is the narrower list of actual application relationships.

Suggested `reviewOwner` values are `qualified_customs_reviewer`, `party_master_owner`, `valuation_reviewer`, `classification_origin_reviewer`, `tax_reviewer` and `customs_system`. The UI may display these as workflow responsibilities; they are not access-control grants or legal office assignments.

Source transcriptions normalize PDF line wrapping. In amended 1.38, the official DOCX extraction duplicated text from overlapping drawing shapes; the example was transcribed against Gazette PDF page 136 as `QPGP 06GP17032025`. The duplicate processing-material paragraph in amended 1.78 is retained because it also appears on printed Gazette page 144. Official PDF pages remain authoritative if transcription or interpretation differs. Field-level `pages` use one-based physical PDF pages, not source paragraph or table row numbers.

The 2018 source text remains visibly separate from the 2025 overlay. Neither the UI nor callers should present an unamended baseline paragraph as a verified current rule. The effective dates describe the cited instruments; they do not certify continuing validity of every instruction.

## Required work before legal rule activation or real filing

A qualified reviewer must reconcile all applicable intervening/later changes and confirm scenario-specific requirements. Current code datasets need authoritative provenance, versions, effective ranges and update ownership. The new compound/repeating capture models still need broker and vendor validation for the intended scenario. A vendor-confirmed ECUS schema and controlled sample import must establish exact mappings. Legal rule activation then needs separately reviewed rules with scope/effective dates and meaningful positive/negative cases. None of those gates is satisfied by merely finding all 96 indicator labels or providing an editor.

Registry tests check structural completeness, exact amendment membership, source anchors, actual application keys and conservative boundaries. They are regression protection for this reference inventory; passing them does not certify legal compliance or live customs acceptance.
