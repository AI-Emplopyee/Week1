import { getKimiStatus } from '@/lib/server-kimi';
import { json, route } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return route(async () => json(await getKimiStatus(request))); }
