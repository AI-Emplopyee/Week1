import { writeFileSync } from 'node:fs';
import { buildVnaccsCoverageExport, renderVnaccsCoverageCsv } from '../lib/vnaccs-export.ts';

// Run with: node --experimental-strip-types scripts/export-vnaccs.ts
const snapshot = buildVnaccsCoverageExport();
writeFileSync(new URL('../docs/vnaccs-coverage.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n');
writeFileSync(new URL('../docs/vnaccs-coverage.csv', import.meta.url), renderVnaccsCoverageCsv(snapshot));
console.log(`Exported ${snapshot.fields.length} reference indicators and ${snapshot.captureSummary.editable} editable capture models.`);
