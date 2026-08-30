# HNL QLTC V6.3.0 RC2.2.8 — WIP Checkpoint

Baseline: `main@bd9fef1d695bbaebb591980098d5ce61360a77ea`

Branch: `rc2-2-8-data-integrity-master-gate`

Draft PR: #7

Status: **WIP — DO NOT MERGE / DO NOT DEPLOY PROD**.

## Implemented in source

- Canonical membership: normalized email is authoritative; UID rows are legacy fallback only.
- Project member fetch/realtime collapse physical aliases to one logical email.
- Role write converges legacy UID aliases; revoke removes all aliases for the logical email.
- Last-ADMIN guard counts unique active ADMIN emails.
- Firestore Rules, Firebase Storage Rules and R2 gateway use the same canonical email precedence.
- Regression guards cover stale UID ADMIN vs canonical email VIEWER.
- Defect notifications deep-link to exact project/floor/defect, clear stale status filter, enable Defect layer, focus exact pin and open detail modal.
- Floor target dates moved from Cấu hình to Mặt bằng → Kế hoạch tiến độ tầng while preserving existing `floor_plans.targetFrameDate/targetBoardDate` fields.
- Mobile notification badge opens Notification Center directly instead of expanding a large floor-plan-covering card.
- App-level VisualViewport keyboard state hides BottomNav/floating alerts while the OS keyboard is open.
- Chat room follows VisualViewport height so composer remains above the mobile keyboard.
- Presence-not-configured warning is no longer rendered as an amber error-like banner.
- ProjectMember Cloud lifecycle type includes `active` / `updatedAt` for fail-closed ADMIN counting.
- Permission role-change/revoke uses the app confirmation modal with Project + email + old/new role context.
- User-facing role labels normalized to `ADMIN (Quản trị)`, `EDITOR (Kỹ sư)`, `VIEWER (Chỉ xem)` inside Security Center.
- Floor pan/zoom restore is accepted only for a compatible saved viewport; stale state from a different mobile size/orientation falls back to fit state.

## CI note

Earlier PR Build reached Stability/RBAC/R2/Auth golden PASS but TypeScript correctly failed because `ProjectMember.active` was not declared. The model has now been corrected instead of removing the active-member guard.

This checkpoint commit is intentionally user-authored through the repository connector so GitHub PR Build/APK/EXE workflows run again after the one-shot bot patch commits.

## Still required before Ready

- PR Build: Stability, TypeScript, Lint, Rules compile, production critical security audit, web build.
- Android APK build and fixed release signing gate.
- Windows EXE build.
- Review remaining notification/badge semantics and loading UX.
- Runtime Golden: ADMIN/EDITOR/VIEWER on multiple devices; online role change/revoke; offline reconnect; real R2 photo A→B; floor target-date realtime; Defect deep-link from toast and Notification Center.

No PROD deployment is authorized by this checkpoint.
