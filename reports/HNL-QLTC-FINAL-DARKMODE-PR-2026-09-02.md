# HNL QLTC – Final Dark Mode PR checkpoint

Baseline: `d2c3126ef16192b1edc490ccd839b3ab7fcfc7a4` (Merge PR #38).

This PR keeps Firebase project/app/Hosting, R2, RBAC, offline data and APK/EXE workflow configuration unchanged.

Scope:
- Add `public/darkmode-final.css` containing the final opacity-suffixed Tailwind Dark Mode guards verified from the final local audit.
- Load that guard after the application module from `index.html` so it wins over earlier Tailwind-generated utility CSS.
- No business logic, Firebase, Firestore, R2, projectId or permissions changes.

Drive backup exists in the existing continuation folder with FULL SOURCE ZIP, PATCH ZIP, final audit report, SHA256 and continuation checkpoint.

Release gate: do not merge or deploy until Build + TypeScript + Lint + Rules + Security + APK + EXE are green.
