export function passwordValidation(password: string, confirmation: string): string | undefined {
  if (password.length < 12 || password.length > 128) return 'Mật khẩu phải có từ 12 đến 128 ký tự.';
  if (password !== confirmation) return 'Mật khẩu nhập lại chưa khớp.';
  return undefined;
}
/** Only extract supported invite/recovery parameters; never render or persist the token. */
export function callbackParameters(fragment: string): { tokenHash: string; type: 'invite' | 'recovery' | ''; valid: boolean } {
  if (!fragment.startsWith('#')) return { tokenHash: '', type: '', valid: false };
  const params = new URLSearchParams(fragment.slice(1)); const tokenHash = params.get('token_hash') || ''; const requestedType = params.get('type');
  const type = requestedType === 'invite' || requestedType === 'recovery' ? requestedType : '';
  const valid = !!type && params.getAll('token_hash').length === 1 && params.getAll('type').length === 1 && /^[a-zA-Z0-9_-]{20,256}$/.test(tokenHash);
  return { tokenHash: valid ? tokenHash : '', type, valid };
}

export type AuthAvailability = 'supabase' | 'local' | 'unconfigured';
export function authAvailability(status: { mode: AuthAvailability; configured: boolean }): AuthAvailability {
  return status.configured ? status.mode : 'unconfigured';
}
