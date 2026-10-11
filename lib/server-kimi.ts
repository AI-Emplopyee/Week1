import { env } from 'cloudflare:workers';
import { consumeRateLimit } from '@/lib/auth-persistence';
import { extractWithKimi, KIMI_LIMITS, KimiError, kimiRequestSchema, kimiStatus, selectKimiPages } from '@/lib/kimi';
import { ApiError, expectRevision, mutate, readJson, requireSameOrigin, workspace } from '@/lib/server';

// This module is imported exclusively by server routes. Neither setting is accepted from a browser.
function configuration() { return { apiKey: env.MOONSHOT_API_KEY, model: env.MOONSHOT_MODEL }; }
export async function getKimiStatus(request: Request) {
  await workspace(request);
  return kimiStatus(configuration());
}
export async function requestKimiExtraction(request: Request) {
  requireSameOrigin(request);
  const context = await workspace(request);
  const input = kimiRequestSchema.parse(await readJson(request));
  expectRevision(context, input.revision);
  const shipment = context.state.cases.find(shipment => shipment.id === input.caseId && !shipment.mergedInto);
  const document = context.state.documents.find(document => document.id === input.documentId && document.caseId === input.caseId && document.active);
  if (!shipment || !document) throw new ApiError(404, 'Active document not found in this case.');
  if (shipment.status === 'completed') throw new ApiError(422, 'Reopen this case before requesting AI proposals.');
  try {
    const config = configuration();
    if (!kimiStatus(config).configured) throw new KimiError(503, 'Kimi requires server-side MOONSHOT_API_KEY and MOONSHOT_MODEL configuration.');
    const pages = selectKimiPages(document, input.pages);
    if (!await consumeRateLimit(context.db, `kimi-extract:${context.state.id}`, KIMI_LIMITS.requestsPerMinute, 60)) throw new ApiError(429, 'This workspace has reached the Kimi request limit. Wait one minute before trying again.');
    const result = await extractWithKimi(config, document, pages.map(page => page.page));
    const before = context.state.candidates.length;
    const saved = await mutate(context, input.revision, { type: 'add_ai_candidates', caseId: shipment.id, documentId: document.id, documentVersion: document.version, model: result.model, pages: result.pages, proposals: result.proposals });
    return { ...saved, ai: { added: saved.state.candidates.length - before, rejected: result.rejected, model: result.model, documentId: document.id, pages: result.pages } };
  } catch (error) {
    if (error instanceof KimiError) throw new ApiError(error.status, error.message);
    throw error;
  }
}
