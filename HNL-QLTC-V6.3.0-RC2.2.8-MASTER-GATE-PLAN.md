# HNL QLTC V6.3.0 RC2.2.8 — Stability / Data Integrity Master Gate

Baseline: `main@bd9fef1d695bbaebb591980098d5ce61360a77ea`

Status: WIP branch only. Do not merge or deploy PROD until every release gate below is green.

## 1. Core release invariants

### Identity / RBAC

1. One normalized email = one logical project member = one effective role.
2. `projects/{projectId}/members/{normalizedEmail}` is the canonical membership identity.
3. UID member documents are legacy/compatibility aliases only and may never override the canonical email role.
4. Viewer→Editor, Editor→Viewer, Admin→Viewer, revoke and re-add must converge on exactly one effective role across UI, Firestore Rules, Firebase Storage and R2 gateway.
5. Removing a member must revoke every UID/email compatibility alias and discovery index for that logical identity.
6. The last logical ADMIN guard counts unique normalized emails, never physical Firestore documents.
7. Existing duplicate member documents must be repairable idempotently without deleting project business data.

### Data / realtime

1. Firestore remains the authoritative business-data source.
2. R2 remains the primary PROD binary store; local cache is never promoted as a second authoritative source.
3. Reconnect/pending writes may not resurrect deleted data or overwrite a newer revision.
4. Multi-device updates must preserve projectId and record identity.

### Floor-plan / progress UX

1. `targetFrameDate` / `targetBoardDate` remain stored on the existing `floor_plans` documents. No migration or field duplication.
2. The current editor titled **“Cài đặt Tiến Độ Mục Tiêu Từng Tầng”** is operational planning, not application configuration.
3. Move the editing surface out of **Cấu hình** into **Mặt bằng** as **“Kế hoạch tiến độ tầng”**.
4. Mobile: show the selected floor first; keep the panel compact/collapsible so it does not cover the drawing.
5. PC: allow a compact all-floor overview plus selected-floor detail.
6. ADMIN may edit target dates. EDITOR/VIEWER may see target dates, remaining/overdue status and alerts but cannot modify structural target dates.
7. Due-date notifications and the new panel must read the same `floor_plans.targetFrameDate/targetBoardDate` fields; never create a second settings copy.
8. Cấu hình should remain for project metadata, formatting, sync/diagnostics, backup/trash and system preferences.

### Notification deep-link behavior

1. Every actionable notification must identify the underlying business record, not only its screen/tab.
2. Defect notification → open **Mặt bằng** → select the defect's `floorId` → switch to Defect view → select/focus the exact `defect.id` → open its detail modal.
3. A notification may never stop at `setActiveTab('floorplan')` and leave the user to find the record manually.
4. Notification navigation must work even when another floor or a different Defect status filter was previously selected.
5. The target is resolved from the existing `DueDateAlertItem.originalItem`; do not duplicate Defect data into notification storage.
6. If the record was removed/archived after the alert was generated, fail clearly and safely instead of opening an unrelated record.
7. The same deep-link contract must be used by both the floating due-date toast and the full Notification Center.

## 2. Video findings included in this gate

- P0: duplicate physical member rows for one email can display as two members and can carry conflicting roles.
- P0: last-ADMIN guard can count physical rows instead of unique logical members.
- P0: UID-first role lookup can temporarily return a stale role when UID and email documents disagree.
- P1: permission-change/revoke flow needs an application modal with project + email + old role → new role instead of generic browser confirmation.
- P1: floor-plan target-date configuration is placed in the wrong operational location.
- P1: clicking a Defect notification currently only changes to the Floor Plan tab and does not open/focus the referenced Defect.
- P1: floor-plan mobile viewport needs fit/clamp review.
- P1: notification overlays and chat keyboard/mobile bottom navigation require responsive hardening.
- P1: full-screen loading should prefer verified Firestore cache while realtime refresh continues.
- P2: role naming must be normalized across the application.
- P2: notification/floor-plan counters need explicit meaning if they count different things.

## 3. Required regression matrix

### Membership identity

- Existing VIEWER email + stale UID ADMIN → effective VIEWER everywhere.
- Existing EDITOR email + stale UID VIEWER → effective EDITOR everywhere.
- Canonical email inactive/revoked + stale UID ADMIN → no project access.
- Re-add same email as EDITOR → update existing logical member, no second UI row.
- Re-add same email as VIEWER → update role, no duplicate.
- Revoke member with UID alias → all aliases/indexes revoked.
- Unique logical ADMIN count protects the final ADMIN even when duplicate physical rows exist.
- Email case/whitespace variants resolve to one logical identity.

### Permission surfaces

- App UI/handlers.
- Firestore Rules.
- Firebase Storage Rules.
- R2 gateway.
- Offline verified-role lease and reconnect.
- Second-device role change/revocation.

### Floor progress

- Existing dates render unchanged after UI relocation.
- ADMIN edits propagate realtime to a second device.
- EDITOR/VIEWER cannot edit target dates.
- Due soon/overdue state is identical in floor-plan panel and notification center.
- Mobile keyboard/bottom navigation does not cover the progress controls.

### Notification navigation

- Defect on current floor → opens exact Defect detail.
- Defect on another floor → changes floor first, then opens exact Defect detail.
- Previous status filter hides target → navigation resets/reconciles the filter so the target is visible.
- Toast notification and Notification Center produce identical navigation results.
- Deleted/archived target → no unrelated Defect opens; user receives a clear unavailable-state message.
- WorkVolume/Checklist navigation remains unchanged unless a deeper record-target contract is intentionally added and tested.

## 4. Release gates before merge

- Stability / Architecture / Golden Gate.
- Identity/RBAC regression gate.
- Notification deep-link regression gate.
- TypeScript.
- Source lint.
- Firestore Rules compile + emulator behavior.
- Firebase Storage behavior.
- R2 gateway golden.
- Production critical security audit.
- Web build.
- Android APK build + fixed release signing check.
- Windows EXE build.
- No sensitive secrets in source.

## 5. Runtime Golden before PROD

- ADMIN + EDITOR + VIEWER on at least two devices.
- Viewer→Editor→Viewer while both devices are online.
- Revoke while the second device is open.
- Reconnect from offline cache after a role downgrade/revoke.
- Create photo on device A → metadata + R2 binary → device B displays it.
- Floor target date update on ADMIN device → Editor/Viewer display refresh.
- Tap a Defect due-date toast for a different floor → exact Defect detail opens.
- Tap the same Defect from Notification Center after changing status filter → exact Defect still opens.

Do not mark RC2.2.8 releasable until these conditions are verified or explicitly recorded as an external blocker.