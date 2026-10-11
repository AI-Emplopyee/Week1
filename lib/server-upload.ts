import PostalMime from 'postal-mime';
import { boundedPdfPages } from '@/lib/pdf-pages';
import { assessExtraction } from '@/lib/extraction-quality';
import { ApiError, bucket, expectRevision, json, mutate, readLimitedBytes, requireSameOrigin, response, workspace } from '@/lib/server';
import { acceptedFile, MAX_UPLOAD_BYTES, parseId, parseUploadedPages, parseRevision, safeFilename } from '@/lib/server-validation';
import type { EmailRecord, SourcePage, UploadedDocument } from '@/lib/types';

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function textPages(text: string): SourcePage[] {
  if (text.length > 500_000) return [];
  const parts = text.split('\f');
  return parts.length > 50 ? [] : parts.map((part, index) => ({ page: index + 1, text: part }));
}
function optionalId(value: FormDataEntryValue | null): string | undefined { return value == null || value === '' ? undefined : parseId(value); }
function validateFile(name: string, bytes: Uint8Array) {
  try { return acceptedFile(name, bytes); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : 'Unsupported file.'); }
}
async function pdfPages(bytes: Uint8Array, supplied: SourcePage[] = []): Promise<SourcePage[]> {
  try { return await boundedPdfPages(bytes, supplied); }
  catch (error) { throw new ApiError(400, (error as Error).message); }
}
export async function upload(request: Request): Promise<Response> {
  requireSameOrigin(request);
  const context = await workspace(request);
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data;')) throw new ApiError(415, 'Upload files using multipart/form-data.');
  const raw = await readLimitedBytes(request, MAX_UPLOAD_BYTES);
  const form = await new Response(raw.buffer as ArrayBuffer, { headers: { 'content-type': contentType } }).formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new ApiError(400, 'Choose a file to upload.');
  if (form.get('revision') == null) throw new ApiError(400, 'A workspace revision is required.');
  const revision = parseRevision(form.get('revision'));
  expectRevision(context, revision);
  const targetCaseId = optionalId(form.get('targetCaseId'));
  const documentId = optionalId(form.get('documentId'));
  if (targetCaseId && !context.state.cases.some(item => item.id === targetCaseId)) throw new ApiError(404, 'Shipment case not found.');
  if (documentId && !context.state.documents.some(item => item.id === documentId && item.active)) throw new ApiError(404, 'Active document not found.');
  let name: string;
  try { name = safeFilename(file.name); }
  catch (error) { throw new ApiError(400, (error as Error).message); }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { extension, mime } = validateFile(name, bytes);
  const sha256 = await hash(bytes);
  const storedKeys: string[] = [];
  const storage = bucket();
  const writeOriginal = async (id: string, data: Uint8Array, contentType: string): Promise<string> => {
    const key = `${context.state.id}/${id}`;
    await storage.put(key, data, { httpMetadata: { contentType } });
    storedKeys.push(key);
    return key;
  };
  try {
    if (extension === 'eml') {
      if (documentId) throw new ApiError(400, 'Import an email as a new intake. Replace an individual attachment from its source document.');
      let parsed: Awaited<ReturnType<typeof PostalMime.parse>>;
      try { parsed = await PostalMime.parse(bytes, { attachmentEncoding: 'arraybuffer', maxNestingDepth: 12, maxRfc822NestingDepth: 3, maxHeadersSize: 64 * 1024 }); }
      catch { throw new ApiError(400, 'This email could not be parsed. Export the original message as an EML file and retry.'); }
      if (!parsed.headers.some(header => ['from', 'subject', 'message-id'].includes(header.key))) throw new ApiError(400, 'The file does not contain an email envelope.');
      const messageId = (parsed.messageId || `sha256:${sha256}`).slice(0, 1000);
      if (context.state.emails.some(email => email.sha256 === sha256 || email.messageId === messageId)) return json({ ...response(context), notice: 'This email is already in the workspace. No duplicate was created.' });
      if (parsed.attachments.length > 50) throw new ApiError(400, 'Email intake supports up to 50 attachments.');
      const emailId = `email_${crypto.randomUUID()}`;
      const date = parsed.date ? new Date(parsed.date) : new Date();
      const email: EmailRecord = { id: emailId, messageId, sender: (parsed.from?.address || parsed.from?.name || 'Unknown sender').slice(0, 1000), subject: (parsed.subject || name).slice(0, 1000), receivedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(), originalName: name, blobKey: await writeOriginal(emailId, bytes, mime), documentIds: [], sha256 };
      const documents: UploadedDocument[] = [];
      // Preserve complete HTML and MIME parts in the EML. Attachment-free messages can provide text evidence.
      if (!parsed.attachments.length) {
        const bodyText = [`From: ${email.sender}`, `Subject: ${email.subject}`, `Date: ${email.receivedAt}`, '', parsed.text || '(No plain text email body. View the original EML.)'].join('\n');
        const bodyBytes = new TextEncoder().encode(bodyText);
        const bodyId = `doc_${crypto.randomUUID()}`;
        const bodyPages = textPages(bodyText);
        documents.push({ id: bodyId, name: `${name.replace(/\.eml$/i, '')}-email-body.txt`, mime: 'text/plain', size: bodyBytes.length, sha256: await hash(bodyBytes), blobKey: await writeOriginal(bodyId, bodyBytes, 'text/plain'), pages: bodyPages, extractionStatus: bodyPages.length ? 'extracted' : 'needs_transcription', sourceEmailId: emailId });
      }
      for (const attachment of parsed.attachments) {
        const attachmentName = safeFilename(attachment.filename || 'unnamed-attachment');
        const data = typeof attachment.content === 'string' ? new TextEncoder().encode(attachment.content) : new Uint8Array(attachment.content);
        const attachmentHash = await hash(data);
        const duplicate = context.state.documents.find(doc => doc.sha256 === attachmentHash);
        if (duplicate) { email.documentIds.push(duplicate.id); continue; }
        if (documents.some(doc => doc.sha256 === attachmentHash)) continue;
        const id = `doc_${crypto.randomUUID()}`;
        let attachmentMime = attachment.mimeType || 'application/octet-stream';
        let pages: SourcePage[] = [];
        let extractionStatus: UploadedDocument['extractionStatus'] = 'needs_transcription';
        let extractionError: string | undefined;
        try {
          const accepted = acceptedFile(attachmentName, data);
          attachmentMime = accepted.mime;
          if (['txt', 'csv'].includes(accepted.extension)) {
            pages = textPages(new TextDecoder().decode(data));
            extractionStatus = pages.length && pages.every(page => page.text.trim().length >= 12) ? 'extracted' : 'needs_transcription';
          } else {
            if (accepted.extension === 'pdf') pages = await pdfPages(data);
            if (['png', 'jpg', 'jpeg', 'webp'].includes(accepted.extension)) pages = [{ page: 1, text: '' }];
            extractionError = 'Email attachment original preserved. Add a verified transcription in Source documents before review.';
          }
        } catch {
          extractionStatus = 'unsupported';
          extractionError = 'Attachment preserved, but this format cannot be extracted. Replace it with a supported document.';
        }
        documents.push({ id, name: attachmentName, mime: attachmentMime, size: data.length, sha256: attachmentHash, blobKey: await writeOriginal(id, data, attachmentMime), pages, extractionStatus, extractionError, sourceEmailId: emailId });
      }
      email.documentIds.push(...documents.map(doc => doc.id));
      return json(await mutate(context, revision, { type: 'intake', documents, targetCaseId, email }));
    }
    if (context.state.documents.some(doc => doc.sha256 === sha256)) return json({ ...response(context), notice: 'This exact original document is already in the workspace. No duplicate was created.' });
    let pages = parseUploadedPages(JSON.parse(String(form.get('pages') || '[]')));
    if (['txt', 'csv'].includes(extension)) pages = textPages(new TextDecoder().decode(bytes));
    if (extension === 'pdf') pages = await pdfPages(bytes, pages);
    if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
      if (pages.some(page => page.page !== 1)) throw new ApiError(400, 'An image contains a single source page.');
      // Browser OCR remains labelled evidence. Manual edits belong to the audited transcription action.
      pages = pages.length === 1 && pages[0].textSource === 'ocr' ? pages : [{ page: 1, text: '' }];
    }
    const reportedStatus = form.get('extractionStatus');
    const reportedError = form.get('extractionError');
    if (reportedStatus !== null && (typeof reportedStatus !== 'string' || !['extracted', 'needs_transcription', 'unsupported', 'failed'].includes(reportedStatus))) throw new ApiError(400, 'Invalid extraction status.');
    if (reportedError !== null && (typeof reportedError !== 'string' || reportedError.length > 2000)) throw new ApiError(400, 'Extraction diagnostics must be text no longer than 2,000 characters.');
    const assessment = assessExtraction(pages, reportedStatus ?? undefined, reportedError ?? undefined);
    const id = `doc_${crypto.randomUUID()}`;
    const document: UploadedDocument = { id, name, mime, size: bytes.length, sha256, pages, ...assessment, blobKey: await writeOriginal(id, bytes, mime) };
    return json(await mutate(context, revision, documentId ? { type: 'replace_document', documentId, document } : { type: 'intake', documents: [document], targetCaseId }));
  } catch (error) {
    if (storedKeys.length) await storage.delete(storedKeys).catch(() => undefined);
    throw error;
  }
}
