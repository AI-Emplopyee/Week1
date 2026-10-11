import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
mkdirSync('public', { recursive: true });
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdf.worker.min.mjs');
mkdirSync('public/ocr/core', { recursive: true });
copyFileSync('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
copyFileSync('node_modules/tesseract.js/LICENSE.md', 'public/ocr/LICENSE-tesseract-js.txt');
copyFileSync('node_modules/tesseract.js-core/LICENSE', 'public/ocr/LICENSE-tesseract-core.txt');
for (const name of readdirSync('node_modules/tesseract.js-core')) {
  if (name.endsWith('.wasm.js')) copyFileSync(`node_modules/tesseract.js-core/${name}`, `public/ocr/core/${name}`);
}
