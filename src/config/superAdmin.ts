export const SUPER_ADMIN_EMAIL = 'lengochieu1211@gmail.com';

export const normalizeAccountEmail = (email?: string | null): string =>
  String(email || '').trim().toLowerCase();

export const isSuperAdminEmail = (email?: string | null): boolean =>
  normalizeAccountEmail(email) === SUPER_ADMIN_EMAIL;
