# Synthetic regression documents

All companies, document identifiers and goods in this directory are fictional.
No real client sample was provided. These fixtures test software behavior only;
they do not demonstrate extraction accuracy across suppliers or customs validity.

- `DEMO-commercial-invoice-022.txt`, `DEMO-packing-list-022.txt` and
  `DEMO-bill-of-lading-022.txt`: consistent shipment, label/table extraction and review.
- The `021` set: conflicting package counts and goods quantities.
- `DEMO-shipment-email.eml`: original email envelope and three base64 text attachments;
  upload it twice to exercise email/attachment deduplication.
- `DEMO-invoice-replacement-022.txt`: changed invoice total; use the document
  replacement control to check stale decisions and approval invalidation.
- `DEMO-ambiguous-invoice.txt`: ambiguous date and decimal/grouping separator;
  neither is silently interpreted.

The seeded scan case is explicitly a placeholder with no source image. Test an
actual scan by uploading an image or a scanned PDF: the app must ask for checked
manual transcription because this version has no OCR service.

Supported extraction input is readable document text with bilingual labels and
pipe, tab or CSV goods rows. Original files are stored by the server intake path;
seeded demo documents contain source text only.
