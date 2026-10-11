import { download } from '@/lib/server-download';
import { route } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(async () => download(request, (await context.params).id, 'document'));
}
