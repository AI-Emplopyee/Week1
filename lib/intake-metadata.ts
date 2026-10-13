import { z } from 'zod';
import { pagesSchema } from './server-validation.ts';

const prepared = z.object({
  name: z.string().min(1).max(240),
  sourcePaths: z.array(z.string().min(1).max(1500)).max(100).optional(),
  referenceOnly: z.boolean().optional(),
  pages: pagesSchema,
  extractionStatus: z.enum(['pending_ai', 'extracted', 'needs_transcription', 'unsupported', 'failed']),
  extractionError: z.string().max(2000).optional(),
}).strict();
const attachment = prepared.extend({ index: z.number().int().min(0).max(49) }).strict();
export const intakeMetadataSchema = z.array(prepared.extend({ attachments: z.array(attachment).max(50).optional() }).strict()).min(1).max(20);
export type IntakeMetadata = z.infer<typeof intakeMetadataSchema>[number];
export const sourceCollectionSchema = z.object({ name: z.string().trim().min(1).max(120), folder: z.string().trim().min(1).max(500), caseType: z.enum(['import', 'export', 'reference', 'unknown', 'unsupported']).optional() }).strict();

export function parseIntakeMetadata(value: unknown, names: string[]): IntakeMetadata[] {
  const parsed = intakeMetadataSchema.parse(value);
  if (parsed.length !== names.length || parsed.some((item, index) => item.name !== names[index])) throw new Error('Document metadata must match each file in upload order.');
  for (const item of parsed) {
    if (item.pages.some(page => page.textSource === 'manual') || item.attachments?.some(attachment => attachment.pages.some(page => page.textSource === 'manual'))) throw new Error('Manual transcription must use the audited document transcription action.');
    if (new Set(item.attachments?.map(attachment => attachment.index)).size !== (item.attachments?.length ?? 0)) throw new Error('Attachment metadata indexes must be unique.');
  }
  return parsed;
}
