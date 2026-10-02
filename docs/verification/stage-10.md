# Этап 10 — реальная упаковка

UTC: 2026-10-02T10:03:46.048Z

Commit: репозиторий без коммитов; рабочее дерево

## pnpm dist:mac

Exit code: 0; PASS

```text
vite v8.3.2 building client environment for production...
transforming...
✓ 2065 modules transformed.
rendering chunks...
computing gzip size...
dist/renderer/index.html                   0.61 kB │ gzip:   0.37 kB
dist/renderer/assets/index-CXtB1Sl9.css   22.88 kB │ gzip:   5.24 kB
dist/renderer/assets/index-BbqHt7SI.js   430.07 kB │ gzip: 136.62 kB

✓ built in 163ms
  • electron-builder  version=26.15.3 os=25.6.0
  • loaded configuration  file=package.json ("build" field)
  • detected workspace root for project using packageManager field  pm=pnpm config=pnpm@11.18.0 resolved=/Users/wozglas/Documents/ChatGPT/eve online bot projectDir=/Users/wozglas/Documents/ChatGPT/eve online bot
  • executing @electron/rebuild  electronVersion=44.5.1 arch=arm64 buildFromSource=false workspaceRoot=/Users/wozglas/Documents/ChatGPT/eve online bot projectDir=./ appDir=./
  • installing native dependencies  arch=arm64
  • preparing       moduleName=better-sqlite3 arch=arm64
  • finished        moduleName=better-sqlite3 arch=arm64
  • completed installing native dependencies
  • packaging       platform=darwin arch=arm64 electron=44.5.1 appOutDir=release/mac-arm64
  • downloaded      label=electron progress=100%
  • downloaded electron zip extracted successfully  output=/Users/wozglas/Documents/ChatGPT/eve online bot/release/mac-arm64
  • searching for node modules  pm=pnpm searchDir=/Users/wozglas/Documents/ChatGPT/eve online bot
  • duplicate dependency references  dependencies=["@radix-ui/react-slot@1.3.3","react-dom@19.3.0","@radix-ui/react-compose-refs@1.1.5","@radix-ui/react-context@1.2.2","@radix-ui/react-id@1.1.4","@radix-ui/react-presence@1.1.10","@radix-ui/react-primitive@2.1.10","@radix-ui/react-use-controllable-state@1.2.6","@radix-ui/react-use-layout-effect@1.1.4","@radix-ui/react-collapsible@1.1.20","@radix-ui/react-collection@1.1.15","@radix-ui/react-label@2.1.15","@radix-ui/react-menu@2.1.24","@radix-ui/react-popper@1.3.7","@radix-ui/react-use-callback-ref@1.1.4","@radix-ui/react-use-effect-event@0.0.5","@radix-ui/react-use-is-hydrated@0.1.3","@radix-ui/react-use-size@1.1.4","@radix-ui/react-visually-hidden@1.2.11","react-style-singleton@2.2.3","@radix-ui/react-use-previous@1.1.4"]
  • skipped macOS code signing  reason=identity explicitly is set to null
  • building        target=DMG arch=arm64 file=release/EVE-Trader-0.1.1-mac-arm64.dmg
  • building block map  blockMapFile=release/EVE-Trader-0.1.1-mac-arm64.dmg.blockmap
$ pnpm build && electron-builder --mac dmg --arm64
$ node scripts/build.mjs

```

## node scripts/packaged-smoke.mjs

Exit code: 0; PASS

```text
{"status":"PASS","checks":["packaged worker + native SQLite + migrations + DEMO","settings write","hide to tray + show","restart persistence"]}

```

## SHA-256

```text
e38068e94ae99b513431b9f0e590659106fac4cee0e3517f105bc89ba9971d73  EVE-Trader-0.1.0-mac-arm64.dmg
94ef8e3bbbe5d639668c50856f1f83c0d3d374cf827e8d7171c948654f0a7da2  EVE-Trader-0.1.1-mac-arm64.dmg
```

Платформа: darwin/arm64.

Live SSO и подпись/notarization: BLOCKED. Windows pipeline не запускался в локальной macOS-сессии. Подробности: [scope-10.md](./scope-10.md).
