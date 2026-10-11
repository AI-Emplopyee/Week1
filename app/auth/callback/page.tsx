import type { Metadata } from 'next';
import { AccountCallbackPage } from '@/components/account-access';
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } };
export default function CallbackPage() { return <AccountCallbackPage />; }
