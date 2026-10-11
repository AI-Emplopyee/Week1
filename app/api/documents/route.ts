import { route } from '@/lib/server';
import { upload } from '@/lib/server-upload';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return route(() => upload(request)); }
