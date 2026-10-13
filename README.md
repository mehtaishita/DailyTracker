# Daily Tracker

A personal Electron desktop app for staying on top of daily work — meetings, Jira, GitHub PRs, and Sentry issues in one place.

## Features

- **Today** — A daily briefing:
  - **Daily quote** — libquotes.com's Quote of the Day, fetched once a day.
  - **Next up** — the next meeting with a live countdown and a Join button.
  - **Stand** — on Monday, Tuesday and Thursday, what you shipped since the last standup in your watched repos (Settings → GitHub), read from their checkouts under `~/code` via [git-standup](https://github.com/nilbuild/git-standup). Commits are grouped by the Jira ticket in their subject (click a ticket to open it); each refresh fetches first, so PRs merged on GitHub appear too, marked and clickable. Monday covers Thursday onward, Tuesday covers Monday onward, Thursday covers Tuesday onward.
  - **Needs you** — GitHub PRs with unread comments on PRs you authored or have commented on, and PRs where you were mentioned; plus Jira tickets with comments you haven't seen. Opening a row or clicking ✓ marks it read.
  - **Meetings** — today's schedule, with past meetings dimmed.
- **Calendar** — Week or month view of meetings from ICS/Outlook calendar URLs, with meeting link detection. Opens on the current week with today's agenda.
- **Jira** — Shows your current sprint issues and their statuses.
- **GitHub** — Lists your PRs, review-requested PRs, and open PRs. Run Claude AI reviews on any PR and post selected feedback as GitHub comments.
- **Sentry** — Monitors error issues across projects with skill-based triage (root cause, fix suggestions).
- **Notes** — Daily scratchpad, one note per day.
- **Tasks** — Todo list with in-progress, done, and skipped states. Past items are auto-archived to history.
- **Meeting alerts** — In-app banner 15, 5, and 2 minutes before each meeting, with an optional chime (Settings → Appearance).
- **Themes** — Default, Coastal, and two Pan themes (pansexual-flag gradient frame): Pan · Yellow and Pan · Glass.

### How "Needs you" tracks read state

- **GitHub** uses GitHub's own notification read state — opening the PR from the app or clicking ✓ marks the thread read on GitHub. Nothing is stored locally.
- **Jira** has no public read/unread API, so the app records when you last opened each ticket from the app (or clicked ✓). A ticket shows when someone else has commented since then; commenting yourself also counts as seen.

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [Electron](https://www.electronjs.org/) (installed via npm)
- [gh CLI](https://cli.github.com/) — authenticated via `gh auth login`
- [Sentry CLI](https://cli.sentry.dev/) (the `sentry` command, not the older `sentry-cli`) — install with `brew install getsentry/tools/sentry`, then authenticate via `sentry auth login`
- A Jira account with an API token

## Setup

```bash
npm install
```

`npm install` also rebuilds `better-sqlite3` for Electron (via the `postinstall` script).

Configure integrations in the app's Settings tab after launching:

| Setting | Description |
|---|---|
| Jira domain | e.g. `yourcompany.atlassian.net` |
| Jira email | Your Atlassian account email |
| Jira API token | Generate at id.atlassian.com |
| Jira project key | e.g. `PROJ` |
| Calendar URL | ICS/webcal URL from Outlook or Google Calendar |
| GitHub repos | Comma-separated list of `owner/repo` for PR diff reviews |
| Sentry projects | `org/project` slugs to monitor |

GitHub and Sentry auth is handled by their respective CLIs — no tokens stored in the app. The Jira API token is encrypted in the macOS keychain.

## Running

```bash
# Development (hot reload)
npm run dev

# Build the renderer and run it once
npm start
```

In development the page hot-reloads, but changes to `main.js`, `preload.js`, `github-service.js`, or `sentry-service.js` need a restart (Ctrl+C, then `npm run dev` again).

## Installing as a Mac app

Quit Daily Tracker first, then from the project folder:

```bash
npm run dist && rm -rf "/Applications/Daily Tracker.app" && ditto release/mac-arm64/daily-tracker.app "/Applications/Daily Tracker.app"
```

`npm run dist` builds the renderer and packages the app into `release/mac-arm64/daily-tracker.app` (ad-hoc signed, for local use). The rest replaces the copy in Applications. Run the same command to update after code changes; your Dock pin keeps working.

## Data

Stored in `~/Library/Application Support/daily-tracker/` (`tracker.db`, `history.json`), shared by the installed app and `npm run dev`. The project's `data/` folder is the old location, kept as a backup.

## Troubleshooting

- **`NODE_MODULE_VERSION` error for better-sqlite3**: run `npm install` (its postinstall rebuilds the module for Electron).
- **Keychain prompt for "daily-tracker Safe Storage"**: click Always Allow. It's the encrypted Jira token.

## Tech Stack

- Electron + React + TypeScript
- Vite
- SQLite (via better-sqlite3) for local storage
- Electron safeStorage for credential encryption
- electron-builder for packaging
