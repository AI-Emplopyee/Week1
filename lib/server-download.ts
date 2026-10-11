import { ApiError, bucket, privateHeaders, workspace } from '@/lib/server';
import { parseId } from '@/lib/server-validation';

function disposition(name: string, inline: boolean): string {
  const fallback = name.replace(/[^a-zA-Z0-9._ -]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
export async function download(request: Request, id: string, kind: 'document' | 'email'): Promise<Response> {
  parseId(id);
  const context = await workspace(request);
  const record = kind === 'document' ? context.state.documents.find(doc => doc.id === id) : context.state.emails.find(email => email.id === id);
  if (!record) throw new ApiError(404, 'Original document not found in this workspace.');
  const isDocument = 'mime' in record;
  let filename = isDocument ? record.name : record.originalName;
  let mime = isDocument ? record.mime : 'message/rfc822';
  const inline = new URL(request.url).searchParams.get('download') !== '1' && ['application/pdf', 'text/plain', 'text/csv', 'image/png', 'image/jpeg', 'image/webp'].includes(mime);
  let body: BodyInit;
  if (record.blobKey) {
    // A caller only supplies the record id; the storage key is read from its authorized workspace.
    if (!record.blobKey.startsWith(`${context.state.id}/`)) throw new ApiError(404, 'Original document not found in this workspace.');
    const object = await bucket().get(record.blobKey);
    if (!object) throw new ApiError(404, 'The original document is unavailable.');
    body = object.body as unknown as BodyInit;
  } else if (isDocument && record.synthetic) {
    body = record.pages.map(page => `--- Page ${page.page} ---\n${page.text}`).join('\n\n');
    mime = 'text/plain; charset=utf-8';
    if (!filename.endsWith('.txt')) filename += '.txt';
  } else throw new ApiError(404, 'The original document is unavailable.');
  return new Response(body, { headers: { ...privateHeaders, 'Content-Type': mime, 'Content-Disposition': disposition(filename, inline), 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'; sandbox" } });
}
