import type { ShipmentDocument, SourcePage } from './types.ts';
export type AiLimits = { maxPages: number; maxTextCharacters: number; maxCandidates: number };
/** The preview and request use the same exact stored pages. Never truncate source text silently. */
export function selectedAiPages(document: Pick<ShipmentDocument, 'pages'>, selected: readonly number[], limits: AiLimits): { pages: SourcePage[]; characters: number; error?: string } {
  const unique = new Set(selected);
  const pages = document.pages.filter(page => unique.has(page.page)).sort((a, b) => a.page - b.page);
  const characters = pages.reduce((total, page) => total + page.text.length, 0);
  if (!pages.length) return { pages, characters, error: 'Chọn ít nhất một trang có văn bản để tiếp tục.' };
  if (pages.length !== unique.size || pages.some(page => !page.text.trim())) return { pages, characters, error: 'Trang được chọn không còn có văn bản hợp lệ. Nạp lại chứng từ trước khi gửi.' };
  if (pages.length > limits.maxPages) return { pages, characters, error: `Chỉ chọn tối đa ${limits.maxPages} trang mỗi lần.` };
  if (characters > limits.maxTextCharacters) return { pages, characters, error: `Văn bản được chọn vượt quá ${limits.maxTextCharacters} ký tự. Chọn ít trang hơn; nội dung sẽ không bị cắt tự động.` };
  return { pages, characters };
}
