import { getVisionPage, uploadVisionPage } from '@/lib/server-vision';
import { route } from '@/lib/server';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return route(() => uploadVisionPage(request)); }
export function GET(request: Request) { return route(() => getVisionPage(request)); }
