import { requestKimiExtraction } from '@/lib/server-kimi';
import { json, route } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return route(async () => json(await requestKimiExtraction(request))); }
