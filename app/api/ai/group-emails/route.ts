import { requestEmailGrouping } from '@/lib/server-email-grouping';
import { json, route } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return route(async () => json(await requestEmailGrouping(request))); }
