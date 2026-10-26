/**
 * Trusted-server implementation of the canonical project membership model.
 * Firebase client-side role hints are never accepted as authorization.
 * Any unverified email is refused before email-owner/superadmin/legacy member lookup.
 * Project permission reads must be made within the SAME Firestore transaction as writes.
 */
const normalizeEmail = value => String(value || '').trim().toLowerCase();
export const assertWarehouseRole = ({ project, emailMembership, uidMembership, actor, permission }) => {
  if (!actor || typeof actor.uid !== 'string' || !actor.uid ||
      !actor.emailVerified || !normalizeEmail(actor.email) ||
      !project || project.deleted === true || project.deletedAt != null) {
    throw new Error('WAREHOUSE_AUTH_OR_PROJECT_INACTIVE');
  }
  const identity = normalizeEmail(actor.email);
  const privilegedOwner = project.ownerUid === actor.uid || normalizeEmail(project.ownerEmail) === identity;
  // Mirrors current Firestore SUPER_ADMIN exception, but only for a verified Auth email.
  const superAdmin = identity === 'lengochieu1211@gmail.com';
  // Canonical email member overrides UID member EVEN IF inactive or missing role.
  const member = emailMembership !== null ? emailMembership : uidMembership;
  const role = member?.active !== false ? member?.role : null;
  const admin = privilegedOwner || superAdmin || role === 'ADMIN';
  if (!admin && !(permission !== 'ADMIN' && ['EDITOR', 'ENGINEER'].includes(role))) {
    throw new Error('WAREHOUSE_ROLE_DENIED');
  }
};