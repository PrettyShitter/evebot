# Этап 10 — упаковка
macOS arm64: реальная .app/.dmg сборка; packaged smoke запускает бинарник из release, подтверждает native SQLite, migration, worker, DEMO, сохранение настроек, hide/show tray и restart.
См. packaged-darwin.json и checksums.sha256. Исходный smoke не доказывает OAuth callback или подпись.
Windows: подготовлен .github/workflows/verify.yml; runner не запускался, installer .exe отсутствует, статус BLOCKED.
Signing/notarization: credentials отсутствуют; unsigned build.
