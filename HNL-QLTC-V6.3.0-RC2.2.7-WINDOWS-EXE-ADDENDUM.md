# HNL QLTC V6.3.0 RC2.2.7 — Windows EXE Addendum

## Scope
- Windows portable EXE wrapper for PC/laptop.
- Production target: `https://hnlqltc.web.app/?app=desktop`.
- Preserve existing desktop profile/offline data.
- Do not clear Service Worker cache at startup.
- Edge first, Chrome fallback, then default browser fallback.

## High-quality icon correction
The previous `desktop-wrapper/QLTCAnPhu.ico` was only 854 bytes and caused Windows Explorer/desktop to upscale a tiny icon, producing visible blur.

RC2.2.7 now removes that obsolete ICO from source. During Windows build, `desktop-wrapper/build-launcher.ps1` generates a native multi-resolution ICO directly from canonical `public/icon.png`.

`public/icon.png` is the retained high-resolution HNL logo source (1249×1248) and is pixel-identical to the HNL logo supplied for this release.

Generated Windows icon frames:
- 16×16
- 24×24
- 32×32
- 48×48
- 64×64
- 96×96
- 128×128
- 256×256

The generated ICO is embedded into `HNL-QLTC-Windows.exe` at compile time and deleted after packaging so there is only one canonical image source.

## CI gate
`desktop-launcher-golden.mjs` verifies:
- short PROD Hosting target;
- profile/offline continuity;
- no Service Worker cache deletion;
- Chrome fallback;
- canonical HNL logo >=1024px;
- multi-resolution ICO generation including 256×256;
- obsolete blurry 854-byte ICO absent;
- Windows runner + Stability + TypeScript + Lint + web build + EXE artifact.

## Release rule
Do not merge PR #5 until Build + Android APK + Windows EXE are green and Android release signing is confirmed with the fixed repository signing secrets.
