import { json, mutate, readJson, requireSameOrigin, response, route, workspace } from '@/lib/server';
import { parseMutation } from '@/lib/server-validation';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return route(async () => json(response(await workspace(request)))); }
export function POST(request: Request) {
  return route(async () => {
    requireSameOrigin(request);
    const context = await workspace(request);
    const { revision, action } = parseMutation(await readJson(request));
    return json(await mutate(context, revision, action));
  });
}
