# How to

## Rebuild and reinstall the Dock app

Quit Daily Tracker first, then from the project folder:

```bash
npm run dist && rm -rf "/Applications/Daily Tracker.app" && ditto release/mac-arm64/daily-tracker.app "/Applications/Daily Tracker.app"
```

`npm run dist` builds the renderer and packages the app into `release/mac-arm64/daily-tracker.app`. The rest replaces the copy in Applications. Your Dock pin keeps working.

## Run in development

```bash
npm run dev
```

The page hot-reloads, but changes to `main.js`, `preload.js`, `github-service.js` or `sentry-service.js` need a restart (Ctrl+C, then `npm run dev` again).

## Where data lives

`~/Library/Application Support/daily-tracker/` (`tracker.db`, `history.json`). Shared by the Dock app and `npm run dev`. The project's `data/` folder is the old location, kept as a backup.

## Troubleshooting

- **`NODE_MODULE_VERSION` error for better-sqlite3**: run `npm install` (its postinstall rebuilds the module for Electron).
- **Keychain prompt for "daily-tracker Safe Storage"**: click Always Allow. It's the encrypted Jira token.
