export interface VerifiedIdentityLike {
  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
}

const normalizeIdentityText = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('vi-VN')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9@._+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const GENERIC_ROLE_LABELS = new Set([
  'ky su qc',
  'ky su',
  'qc',
  'admin',
  'administrator',
  'quan tri vien',
  'editor',
  'viewer',
  'chi xem',
  'tai khoan google',
  'user',
  'nguoi dung',
]);

export const isGenericIdentityDisplayName = (value: unknown): boolean => {
  const normalized = normalizeIdentityText(value);
  return Boolean(normalized && GENERIC_ROLE_LABELS.has(normalized));
};

/**
 * Resolve an auditable person label for business records.
 *
 * A Firebase/Google displayName may legally be a generic role label left over from an
 * old account profile (for example "Kỹ sư QC"). Such a role is not a unique person
 * identity and must never be persisted as the Defect creator. If a real signed-in user
 * exists, stay on that account and fall back to its email rather than a remembered
 * identity from another session. The remembered identity is used only when there is no
 * live Firebase user (offline verified lease).
 */
export const resolveVerifiedIdentityLabel = (
  liveIdentity?: VerifiedIdentityLike | null,
  rememberedIdentity?: VerifiedIdentityLike | null,
): string => {
  if (liveIdentity) {
    const liveName = String(liveIdentity.displayName || '').trim();
    if (liveName && !isGenericIdentityDisplayName(liveName)) return liveName;

    const liveEmail = String(liveIdentity.email || '').trim().toLowerCase();
    if (liveEmail) return liveEmail;

    return '';
  }

  const rememberedName = String(rememberedIdentity?.displayName || '').trim();
  if (rememberedName && !isGenericIdentityDisplayName(rememberedName)) return rememberedName;

  return String(rememberedIdentity?.email || '').trim().toLowerCase();
};
