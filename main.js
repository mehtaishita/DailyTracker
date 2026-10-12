const { app, BrowserWindow, ipcMain, shell, powerMonitor, nativeImage, safeStorage } = require('electron')
const path     = require('path')
const fs       = require('fs')
const http     = require('http')
const https    = require('https')
const os       = require('os')
const { fork, spawn } = require('child_process')
const Database = require('better-sqlite3')
const { fetchDailyQuote } = require('./quote-service')
const { fetchStandup } = require('./standup-service')

// Data lives in Application Support so `npm run dev` and the packaged app share it.
// The project's data/ folder is the pre-packaging location, migrated once by initDb().
const LEGACY_STATE_DIR = path.join(__dirname, 'data')
const STATE_DIR  = app.getPath('userData')
const HIST_FILE  = path.join(STATE_DIR, 'history.json')
const TODOS_FILE = path.join(STATE_DIR, 'todos.json')   // Slack sync inbox (read-only for app)
const NOTES_FILE = path.join(STATE_DIR, 'notes.json')   // legacy — migrated on first run
const ENV_FILE   = path.join(__dirname, '.env')
const DB_FILE    = path.join(STATE_DIR, 'tracker.db')

// Apps launched from the Dock get a minimal PATH (/usr/bin:/bin:…), so gh, sentry
// and claude wouldn't resolve. Borrow the login shell's PATH plus the usual install dirs.
if (app.isPackaged) {
  let shellPath = ''
  try {
    shellPath = require('child_process')
      .execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'printf %s "$PATH"'], { timeout: 5000 })
      .toString()
  } catch (_) {}
  const dirs = [
    ...shellPath.split(':'),
    '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'),
    ...(process.env.PATH || '').split(':'),
  ]
  process.env.PATH = [...new Set(dirs.filter(Boolean))].join(':')
}

let mainWindow
let lastLoadDate = new Date().toLocaleDateString('en-CA')

function scheduleDailyRefresh() {
  const now    = new Date()
  const next8  = new Date(now)
  next8.setHours(8, 0, 0, 0)
  if (next8 <= now) next8.setDate(next8.getDate() + 1)
  setTimeout(() => {
    lastLoadDate = new Date().toLocaleDateString('en-CA')
    if (mainWindow) mainWindow.webContents.reload()
    scheduleDailyRefresh()
  }, next8 - now)
}
let fileWatcher
let db

// ── Database ───────────────────────────────────────────────────────────────────
// One-time copy from the project's data/ folder. VACUUM INTO takes a consistent
// snapshot even if another instance has the old database open.
function migrateLegacyStateDir() {
  const legacyDb = path.join(LEGACY_STATE_DIR, 'tracker.db')
  if (fs.existsSync(DB_FILE) || !fs.existsSync(legacyDb)) return
  try {
    const src = new Database(legacyDb, { readonly: true })
    src.prepare('VACUUM INTO ?').run(DB_FILE)
    src.close()
    for (const f of ['history.json', 'todos.json', 'notes.json']) {
      const from = path.join(LEGACY_STATE_DIR, f)
      const to   = path.join(STATE_DIR, f)
      if (fs.existsSync(from) && !fs.existsSync(to)) fs.copyFileSync(from, to)
    }
    console.log('[db] migrated data from', LEGACY_STATE_DIR, 'to', STATE_DIR)
  } catch (e) { console.error('[db] legacy data migration failed:', e) }
}

function initDb() {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  migrateLegacyStateDir()
  db = new Database(DB_FILE)
  db.pragma('journal_mode = WAL')   // safe concurrent access, faster writes
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT    NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'todo',
      note           TEXT    NOT NULL DEFAULT '',
      created        INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_date TEXT    DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      date    TEXT PRIMARY KEY,
      text    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pr_reviews (
      pr_url   TEXT PRIMARY KEY,
      jira_key TEXT NOT NULL DEFAULT '',
      review   TEXT NOT NULL,
      created  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS pr_commented (
      pr_url  TEXT PRIMARY KEY,
      created INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS jira_seen (
      issue_key TEXT PRIMARY KEY,
      seen_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sentry_skill_runs (
      issue_tag  TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      output     TEXT NOT NULL,
      created    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (issue_tag, skill_name)
    );
  `)

  // Idempotent migration: add completed_date if the DB pre-dates this column
  const cols = db.prepare("PRAGMA table_info(todos)").all()
  if (!cols.some(c => c.name === 'completed_date')) {
    db.exec("ALTER TABLE todos ADD COLUMN completed_date TEXT DEFAULT NULL")
  }

  migrateFromJson()
  archivePastDoneSync()
}

// Synchronously archive past-done todos to history.json at startup.
// Mirrors the archive-past-done IPC handler but runs before the renderer loads,
// so items are always cleaned up even if the app was never reloaded.
function archivePastDoneSync() {
  try {
    const todayStr = new Date().toLocaleDateString('en-CA')
    const pastDone = db.prepare(
      "SELECT id, title, status, completed_date FROM todos WHERE status IN ('done','skipped') AND completed_date IS NOT NULL AND completed_date < ?"
    ).all(todayStr)
    if (pastDone.length === 0) return

    let history = {}
    try {
      if (fs.existsSync(HIST_FILE)) history = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'))
    } catch (_) {}

    for (const todo of pastDone) {
      const d = todo.completed_date
      if (!history[d]) history[d] = { completed: [], meetings: [] }
      if (!history[d].completed) history[d].completed = []
      if (!history[d].completed.some(c => c.title === todo.title))
        history[d].completed.push({ title: todo.title, status: todo.status })
    }
    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(HIST_FILE, JSON.stringify(history, null, 2))

    const ids = pastDone.map(t => t.id)
    db.prepare(`DELETE FROM todos WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
    console.log(`[db] archived ${pastDone.length} past-done todo(s) at startup`)
  } catch (e) { console.error('[db] archivePastDoneSync:', e) }
}

function migrateFromJson() {
  // One-time migration: import notes.json into the DB if the table is empty
  try {
    if (fs.existsSync(NOTES_FILE)) {
      const count = db.prepare('SELECT COUNT(*) AS n FROM notes').get().n
      if (count === 0) {
        const legacy = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'))
        const insert = db.prepare('INSERT OR IGNORE INTO notes (date, text) VALUES (?, ?)')
        const run    = db.transaction((entries) => {
          for (const [date, text] of entries) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(date) && text?.trim()) insert.run(date, text)
          }
        })
        run(Object.entries(legacy))
        console.log('[db] migrated notes.json →', Object.keys(legacy).length, 'entries')
      }
    }
  } catch (e) { console.error('[db] notes migration error:', e) }
}

// Merge todos from todos.json into the DB.
// Adds incoming todos whose title doesn't already exist; never deletes.
function mergeTodosFromFile() {
  try {
    if (!fs.existsSync(TODOS_FILE)) return
    const raw = fs.readFileSync(TODOS_FILE, 'utf8').trim()
    if (!raw) return
    const incoming = JSON.parse(raw)
    if (!Array.isArray(incoming) || incoming.length === 0) return

    const existing = new Set(
      db.prepare('SELECT title FROM todos').all().map(r => r.title)
    )
    const insert = db.prepare('INSERT INTO todos (title, status, note) VALUES (?, ?, ?)')
    const run    = db.transaction((items) => {
      for (const t of items) {
        if (t.title && !existing.has(t.title))
          insert.run(t.title, t.status || 'todo', t.note || '')
      }
    })
    run(incoming)
  } catch (e) { console.error('[db] merge from todos.json:', e) }
}

// ── Window ─────────────────────────────────────────────────────────────────────
function createWindow() {
  initDb()
  mainWindow = new BrowserWindow({
    width:           700,
    height:          700,
    minWidth:        500,
    minHeight:       300,
    titleBarStyle:   'hiddenInset',
    backgroundColor: '#12101e',
    vibrancy:        'under-window',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:9173')
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'renderer', 'index.html'))
  }
  watchFile()
}

function watchFile() {
  try {
    if (fileWatcher) fileWatcher.close()
    if (fs.existsSync(TODOS_FILE)) {
      fileWatcher = fs.watch(TODOS_FILE, (event) => {
        if (event === 'change' && mainWindow) {
          mergeTodosFromFile()
          mainWindow.webContents.send('file-changed')
        }
      })
    }
  } catch (_) {}
}

function readEnv(key) {
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      if (line.trim().startsWith('#')) continue
      const [k, ...rest] = line.split('=')
      if (k.trim() === key) return rest.join('=').trim()
    }
  } catch (_) {}
  return ''
}

// Keys whose values are encrypted at rest via the OS keychain (safeStorage)
const ENCRYPTED_KEYS = new Set(['jira_api_token'])

function encryptSetting(value) {
  if (!safeStorage.isEncryptionAvailable()) return value
  return 'enc:' + safeStorage.encryptString(value).toString('base64')
}

function decryptSetting(value) {
  if (!value?.startsWith('enc:')) return value  // plain-text (pre-migration or unavailable)
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
  } catch (_) { return '' }
}

function readSetting(key) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
    const raw = row?.value ?? ''
    return ENCRYPTED_KEYS.has(key) ? decryptSetting(raw) : raw
  } catch (_) { return '' }
}

function getJiraCreds() {
  const domain = readSetting('jira_domain') || readEnv('JIRA_DOMAIN')
  const email  = readSetting('jira_email')  || readEnv('JIRA_EMAIL')
  const token  = readSetting('jira_api_token') || readEnv('JIRA_API_TOKEN')
  return { domain, email, token }
}

function getRepoList() {
  try {
    const raw = readSetting('github_repos')
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch (_) {}
    // legacy comma-separated fallback
    return raw.split(',').map(r => r.trim()).filter(r => /^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+$/.test(r))
  } catch (_) { return [] }
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('read-todos', () => {
  try {
    return db.prepare('SELECT title, status, note, completed_date FROM todos ORDER BY id').all()
  } catch (e) { console.error('[db] read-todos:', e); return [] }
})

ipcMain.handle('write-todos', (_e, todos) => {
  try {
    const deleteAll = db.prepare('DELETE FROM todos')
    const insert    = db.prepare('INSERT INTO todos (title, status, note, completed_date) VALUES (?, ?, ?, ?)')
    const run = db.transaction((items) => {
      deleteAll.run()
      for (const t of items) insert.run(t.title || '', t.status || 'todo', t.note || '', t.completed_date || null)
    })
    run(todos)
    return true
  } catch (e) { console.error('[db] write-todos:', e); return false }
})

ipcMain.handle('archive-past-done', (_e, todayStr) => {
  try {
    // Find done/skipped todos completed before today
    const pastDone = db.prepare(
      "SELECT id, title, status, completed_date FROM todos WHERE status IN ('done', 'skipped') AND completed_date IS NOT NULL AND completed_date < ?"
    ).all(todayStr)

    if (pastDone.length === 0) return true

    // Read existing history
    let history = {}
    try {
      if (fs.existsSync(HIST_FILE)) history = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'))
    } catch (_) {}

    // Group by completed_date and append to history (avoid duplicates)
    for (const todo of pastDone) {
      const d = todo.completed_date
      if (!history[d]) history[d] = { completed: [], meetings: [] }
      if (!history[d].completed) history[d].completed = []
      const alreadyIn = history[d].completed.some(c => c.title === todo.title)
      if (!alreadyIn) history[d].completed.push({ title: todo.title, status: todo.status })
    }

    fs.mkdirSync(STATE_DIR, { recursive: true })
    fs.writeFileSync(HIST_FILE, JSON.stringify(history, null, 2))

    // Remove archived todos from the DB
    const ids = pastDone.map(t => t.id)
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM todos WHERE id IN (${placeholders})`).run(...ids)

    console.log(`[db] archived ${pastDone.length} past-done todo(s) to history.json`)
    return true
  } catch (e) { console.error('[db] archive-past-done:', e); return false }
})

ipcMain.handle('read-notes', () => {
  try {
    const rows = db.prepare('SELECT date, text FROM notes').all()
    return Object.fromEntries(rows.map(r => [r.date, r.text]))
  } catch (e) { console.error('[db] read-notes:', e); return {} }
})

ipcMain.handle('write-note', (_e, dateStr, text) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  try {
    if (clean.trim()) {
      db.prepare('INSERT OR REPLACE INTO notes (date, text) VALUES (?, ?)').run(dateStr, clean)
    } else {
      db.prepare('DELETE FROM notes WHERE date = ?').run(dateStr)
    }
    return true
  } catch (e) { console.error('[db] write-note:', e); return false }
})

ipcMain.handle('read-history', () => {
  try { return fs.existsSync(HIST_FILE) ? JSON.parse(fs.readFileSync(HIST_FILE, 'utf8')) : {} }
  catch (_) { return {} }
})

ipcMain.handle('get-setting', (_e, key) => {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
    if (row?.value == null) return null
    return ENCRYPTED_KEYS.has(key) ? decryptSetting(row.value) : row.value
  } catch (e) { console.error('[db] get-setting:', e); return null }
})

ipcMain.handle('set-setting', (_e, key, value) => {
  try {
    const stored = ENCRYPTED_KEYS.has(key) ? encryptSetting(String(value)) : String(value)
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, stored)
    return true
  } catch (e) { console.error('[db] set-setting:', e); return false }
})

function fetchICSUrl(url, startStr, endStr) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(parseICSRange(data, startStr, endStr)))
    })
    req.on('error', () => resolve({}))
    req.setTimeout(10000, () => { req.destroy(); resolve({}) })
  })
}

ipcMain.handle('fetch-ics-range', async (_e, startStr, endStr) => {
  const urls = []

  // New multi-calendar setting
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ics_calendars')
    if (row?.value) {
      for (const cal of JSON.parse(row.value)) {
        if (cal.url && /^https?:\/\//i.test(cal.url)) urls.push(cal.url)
      }
    }
  } catch (_) {}

  // Fall back to legacy single-url setting, then env
  if (urls.length === 0) {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ics_url')
      if (row?.value && /^https?:\/\//i.test(row.value)) urls.push(row.value)
    } catch (_) {}
  }
  if (urls.length === 0) {
    const envUrl = readEnv('OUTLOOK_ICS_URL')
    if (envUrl && /^https?:\/\//i.test(envUrl)) urls.push(envUrl)
  }
  if (urls.length === 0) return {}

  const results = await Promise.all(urls.map(u => fetchICSUrl(u, startStr, endStr)))
  const merged = {}
  for (const result of results) {
    for (const [date, meetings] of Object.entries(result)) {
      if (!merged[date]) merged[date] = []
      merged[date].push(...meetings)
    }
  }
  return merged
})

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function makeHttpsGet(url, headers = {}) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, { headers }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        makeHttpsGet(res.headers.location, headers).then(resolve)
        return
      }
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(10000, () => { req.destroy(); resolve(null) })
  })
}

function makeHttpsPost(url, headers = {}, body = {}) {
  return new Promise((resolve) => {
    const parsed  = new URL(url)
    const bodyStr = JSON.stringify(body)
    const req = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(10000, () => { req.destroy(); resolve(null) })
    req.write(bodyStr)
    req.end()
  })
}

ipcMain.handle('open-url', (_e, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://')))
    shell.openExternal(url)
})

// libquotes.com Quote of the Day; see quote-service.js
ipcMain.handle('fetch-daily-quote', () => fetchDailyQuote())

// Stand block: commits since local midnight of `since` in the GitHub tab's watched repos.
// See standup-service.js.
ipcMain.handle('fetch-standup', (_e, since) => {
  if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(since)) return { error: 'failed' }
  return fetchStandup(since, getRepoList())
    .then(r => r.error ? r : { standup: r })
})

ipcMain.handle('fetch-jira-sprint', async () => {
  const { domain, email, token } = getJiraCreds()
  if (!domain || !email || !token || domain.startsWith('<')) return { issues: [], error: 'not_configured' }

  const auth    = Buffer.from(`${email}:${token}`).toString('base64')
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }

  // Scoped tokens need the API gateway — get cloudId from the instance (no auth required)
  const tenant  = await makeHttpsGet(`https://${domain}/_edge/tenant_info`)

  if (!tenant?.cloudId) return { issues: [], error: 'Could not resolve cloud ID from ' + domain }

  const cloudId = tenant.cloudId
  const jql     = encodeURIComponent('assignee = currentUser() AND sprint in openSprints() ORDER BY status ASC')
  const url     = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?jql=${jql}&fields=summary,status&maxResults=100`

  const data = await makeHttpsGet(url, headers)

  if (!data)        return { issues: [], error: 'fetch_failed' }
  if (!data.issues) return { issues: [], error: data.errorMessages?.[0] || JSON.stringify(data)?.slice(0, 200) }

  return {
    issues: data.issues.map(i => ({
      key:    i.key,
      title:  i.fields.summary,
      status: i.fields.status.name,
      url:    `https://${domain}/browse/${i.key}`,
    }))
  }
})

ipcMain.handle('fetch-jira-filter-issues', async (_e, filterId, nextPageToken) => {
  const { domain, email, token } = getJiraCreds()
  if (!domain || !email || !token || domain.startsWith('<')) return { issues: [], error: 'not_configured' }
  if (!filterId) return { issues: [], error: 'No filter ID provided' }

  const auth    = Buffer.from(`${email}:${token}`).toString('base64')
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }

  const tenant = await makeHttpsGet(`https://${domain}/_edge/tenant_info`)
  if (!tenant?.cloudId) return { issues: [], error: 'Could not resolve cloud ID from ' + domain }

  const cloudId = tenant.cloudId
  const url     = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`

  const body = {
    jql:        `filter = ${filterId} ORDER BY updated DESC`,
    fields:     ['summary', 'status', 'assignee'],
    maxResults: 50,
    ...(nextPageToken ? { nextPageToken } : {}),
  }

  const data = await makeHttpsPost(url, headers, body)
  if (!data)        return { issues: [], error: 'fetch_failed' }
  if (!data.issues) return { issues: [], error: data.errorMessages?.[0] || JSON.stringify(data)?.slice(0, 200) }

  return {
    issues: data.issues.map(i => ({
      key:      i.key,
      title:    i.fields.summary,
      status:   i.fields.status.name,
      assignee: i.fields.assignee?.displayName ?? null,
      url:      `https://${domain}/browse/${i.key}`,
    })),
    nextPageToken: data.nextPageToken ?? null,
  }
})

// ── Today: Jira tickets with comments you haven't seen ──────────────────────────
// Jira has no public read/unread API, so "seen" is tracked locally: a ticket is
// seen when you open it from this app (jira_seen) or when you comment on it.

const JIRA_LOOKBACK_DAYS = 14
const JIRA_KEY_RE        = /^[A-Z][A-Z0-9_]*-\d+$/

let _jiraAccountId = null
async function getJiraAccountId(cloudId, headers) {
  if (_jiraAccountId) return _jiraAccountId
  const me = await makeHttpsGet(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, headers)
  if (me?.accountId) return (_jiraAccountId = me.accountId)
  // Scoped tokens may lack read:jira-user — fall back to a ticket you reported
  const res = await makeHttpsPost(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`, headers, {
    jql: 'reporter = currentUser() ORDER BY created DESC', fields: ['reporter'], maxResults: 1,
  })
  return (_jiraAccountId = res?.issues?.[0]?.fields?.reporter?.accountId || null)
}

// Jira timestamps look like 2026-10-12T10:00:00.000-0400
function parseJiraTime(s) {
  return Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) || 0
}

// Comments older than this are treated as seen, so the first run isn't flooded
function getJiraSeenBaseline() {
  const saved = Number(readSetting('jira_seen_baseline'))
  if (saved) return saved
  const baseline = Date.now() - 24 * 60 * 60 * 1000
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('jira_seen_baseline', String(baseline))
  return baseline
}

ipcMain.handle('fetch-jira-needs-you', async () => {
  const { domain, email, token } = getJiraCreds()
  if (!domain || !email || !token || domain.startsWith('<')) return { issues: [], error: 'not_configured' }

  const auth    = Buffer.from(`${email}:${token}`).toString('base64')
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }

  const cloudId = await getCloudId(domain)
  if (!cloudId) return { issues: [], error: 'Could not resolve cloud ID from ' + domain }

  const myId = await getJiraAccountId(cloudId, headers)
  if (!myId) return { issues: [], error: 'Could not determine your Jira account' }

  const data = await makeHttpsPost(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql`, headers, {
    jql:        `(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -${JIRA_LOOKBACK_DAYS}d ORDER BY updated DESC`,
    fields:     ['summary', 'status', 'comment'],
    maxResults: 50,
  })
  if (!data)        return { issues: [], error: 'fetch_failed' }
  if (!data.issues) return { issues: [], error: data.errorMessages?.[0] || JSON.stringify(data)?.slice(0, 200) }

  const baseline = getJiraSeenBaseline()
  const seenRows = db.prepare('SELECT issue_key, seen_at FROM jira_seen').all()
  const seenMap  = Object.fromEntries(seenRows.map(r => [r.issue_key, r.seen_at]))

  const issues = []
  for (const i of data.issues) {
    const comments = i.fields.comment?.comments || []
    const myLast   = Math.max(0, ...comments.filter(c => c.author?.accountId === myId).map(c => parseJiraTime(c.created)))
    const seenAt   = Math.max(baseline, seenMap[i.key] || 0, myLast)
    const fresh    = comments.filter(c => c.author?.accountId !== myId && parseJiraTime(c.created) > seenAt)
    if (fresh.length === 0) continue
    const latest = fresh[fresh.length - 1]
    issues.push({
      key:          i.key,
      title:        i.fields.summary,
      status:       i.fields.status?.name || '',
      url:          `https://${domain}/browse/${i.key}`,
      newCount:     fresh.length,
      latestAt:     new Date(parseJiraTime(latest.created)).toISOString(),
      latestAuthor: latest.author?.displayName || '',
    })
  }
  issues.sort((a, b) => b.latestAt.localeCompare(a.latestAt))

  return { issues, error: null }
})

ipcMain.handle('mark-jira-seen', (_e, key) => {
  if (typeof key !== 'string' || !JIRA_KEY_RE.test(key)) return false
  try {
    db.prepare('INSERT OR REPLACE INTO jira_seen (issue_key, seen_at) VALUES (?, ?)').run(key, Date.now())
    return true
  } catch (e) { console.error('[db] mark-jira-seen:', e); return false }
})

// ── GitHub microservice client ─────────────────────────────────────────────────
// Forks github-service.js once; sends typed messages; resolves by message id.
let _ghService = null
let _ghCallbacks = {}
let _ghNextId = 0

function getGhService() {
  if (_ghService && !_ghService.killed) return _ghService
  _ghService = fork(path.join(__dirname, 'github-service.js'))
  _ghService.on('message', (msg) => {
    const cb = _ghCallbacks[msg.id]
    if (cb) { delete _ghCallbacks[msg.id]; cb(msg) }
  })
  _ghService.on('exit', () => { _ghService = null })
  return _ghService
}

function ghCommand(type, params = {}) {
  return new Promise((resolve) => {
    const id  = _ghNextId++
    const svc = getGhService()
    _ghCallbacks[id] = resolve
    svc.send({ id, type, params })
  })
}

// Forks sentry-service.js once; sends typed messages; resolves by message id.
let _sentryService = null
let _sentryCallbacks = {}
let _sentryNextId = 0

function getSentryService() {
  if (_sentryService && !_sentryService.killed) return _sentryService
  _sentryService = fork(path.join(__dirname, 'sentry-service.js'))
  _sentryService.on('message', (msg) => {
    const cb = _sentryCallbacks[msg.id]
    if (cb) { delete _sentryCallbacks[msg.id]; cb(msg) }
  })
  _sentryService.on('exit', () => { _sentryService = null })
  return _sentryService
}

function sentryCommand(type, params = {}) {
  return new Promise((resolve) => {
    const id  = _sentryNextId++
    const svc = getSentryService()
    _sentryCallbacks[id] = resolve
    svc.send({ id, type, params })
  })
}

function getSentryProjects() {
  try {
    const raw = readSetting('sentry_projects')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter(p => /^[^/]+\/[^/]+$/.test(p))
    return []
  } catch (_) { return [] }
}

ipcMain.handle('fetch-sentry', async (_, flags) => {
  const projects = getSentryProjects()
  if (projects.length === 0) return { projects: [], error: 'not_configured' }

  const results = await Promise.all(
    projects.map(async project => {
      const res = await sentryCommand('issue-list', { project, flags: flags || '' })
      return { project, issues: res.data || null, error: res.error || null }
    })
  )

  const anySuccess = results.some(r => r.issues !== null)
  if (!anySuccess) {
    return { projects: [], error: results[0]?.error || 'Failed to load issues' }
  }

  return { projects: results, error: null }
})

ipcMain.handle('fetch-sentry-issue', async (_, tag) => {
  if (!tag) return { error: 'tag required' }
  const res = await sentryCommand('issue-view', { tag })
  if (res.error) return { error: res.error }
  return { detail: res.data }
})

ipcMain.handle('open-sentry-issue', async (_, tag) => {
  if (!tag) return {}
  await sentryCommand('issue-open', { tag })
  return {}
})

// Resolve `claude` binary path once from the login shell so Electron finds it
// regardless of how the app was launched (Dock, Finder, etc.)
let _claudePath = null
function getClaudePath() {
  return new Promise((resolve) => {
    if (_claudePath) return resolve(_claudePath)
    const proc = spawn('/bin/zsh', ['-lc', 'which claude'], {
      env: { ...process.env, HOME: os.homedir() },
    })
    let out = ''
    proc.stdout.on('data', d => { out += d })
    proc.on('close', () => { _claudePath = out.trim() || 'claude'; resolve(_claudePath) })
    proc.on('error', () => { _claudePath = 'claude'; resolve(_claudePath) })
  })
}

ipcMain.handle('fetch-github', async () => {
  const { domain } = getJiraCreds()
  const repoList   = getRepoList()

  const [myRes, reviewReqRes, ...repoResults] = await Promise.all([
    ghCommand('my-prs'),
    ghCommand('review-requested'),
    ...repoList.map(repo => ghCommand('repo-prs', { repo })),
  ])


  if (myRes.error && reviewReqRes.error && repoResults.every(r => r.error))
    return { myPRs: [], reviews: [], openPRs: [], error: myRes.error }

  // Build URL sets for categorisation
  const myUrls     = new Set((myRes.data       || []).map(pr => pr.url))
  const reviewUrls = new Set((reviewReqRes.data || []).map(pr => pr.url))

  // Collect all unique PRs, deduplicated by URL
  const seen   = new Set()
  const allRaw = []

  for (const pr of (myRes.data || [])) {
    if (!seen.has(pr.url)) { seen.add(pr.url); allRaw.push(pr) }
  }
  for (const pr of (reviewReqRes.data || [])) {
    if (!seen.has(pr.url)) { seen.add(pr.url); allRaw.push(pr) }
  }
  for (const res of repoResults) {
    for (const pr of (res.data || [])) {
      if (!seen.has(pr.url)) { seen.add(pr.url); allRaw.push(pr) }
    }
  }

  // Fetch diff stats for every PR in parallel; failures are silently null
  const statsMap = {}
  await Promise.all(allRaw.map(async pr => {
    const repo = pr.repository?.nameWithOwner || pr.repository?.name || ''
    if (!repo || !pr.number) return
    const res = await ghCommand('pr-stats', { number: pr.number, repo })
    if (res.data) statsMap[pr.url] = res.data
  }))

  const mapPR = pr => {
    const base = {
      title:          pr.title,
      url:            pr.url,
      repo:           pr.repository?.nameWithOwner || pr.repository?.name || '',
      number:         pr.number,
      draft:          pr.isDraft || false,
      additions:      statsMap[pr.url]?.additions      ?? null,
      deletions:      statsMap[pr.url]?.deletions      ?? null,
      changedFiles:   statsMap[pr.url]?.changedFiles   ?? null,
      reviewDecision: statsMap[pr.url]?.reviewDecision ?? null,
      jiraKey:        null,
      jiraUrl:        null,
    }
    const jiraMatch = pr.title?.match(/\b([A-Z]+-\d+)\b/)
    if (jiraMatch && domain) {
      base.jiraKey = jiraMatch[1]
      base.jiraUrl = `https://${domain}/browse/${base.jiraKey}`
    }
    return base
  }

  return {
    myPRs:   allRaw.filter(pr =>  myUrls.has(pr.url)).map(mapPR),
    reviews: allRaw.filter(pr => !myUrls.has(pr.url) && reviewUrls.has(pr.url)).map(mapPR),
    openPRs: allRaw.filter(pr => !myUrls.has(pr.url) && !reviewUrls.has(pr.url)).map(mapPR),
    error:   null,
  }
})

// ── Today: "Needs you" ────────────────────────────────────────────────────────
// PRs needing attention: unread GitHub notifications (GitHub tracks read state,
// cleared when you view the PR), open review requests, and your approved PRs.

const NOTIFICATION_REASONS = {
  mention:          'Mentioned',
  team_mention:     'Team mentioned',
  comment:          'New comments',
  author:           'Activity on your PR',
  review_requested: 'Review requested',
  assign:           'Assigned',
  state_change:     'State changed',
}

ipcMain.handle('fetch-needs-you', async () => {
  const [notifRes, reviewReqRes, approvedRes] = await Promise.all([
    ghCommand('notifications'),
    ghCommand('review-requested'),
    ghCommand('my-approved'),
  ])

  if (notifRes.error && reviewReqRes.error && approvedRes.error)
    return { prs: [], error: notifRes.error }

  // searchReasons are the ones that stay after the notification is marked read
  const byUrl = new Map()
  function add(url, fields, reason, fromSearch) {
    const item = byUrl.get(url) || { url, reasons: [], searchReasons: [], unread: false, threadId: null, updatedAt: null, ...fields }
    if (!item.reasons.includes(reason)) item.reasons.push(reason)
    if (fromSearch && !item.searchReasons.includes(reason)) item.searchReasons.push(reason)
    byUrl.set(url, item)
    return item
  }

  for (const n of (notifRes.data || [])) {
    if (n.subject?.type !== 'PullRequest') continue
    const m = n.subject.url?.match(/repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/)
    if (!m) continue
    const item = add(
      `https://github.com/${m[1]}/pull/${m[2]}`,
      { title: n.subject.title, repo: m[1], number: Number(m[2]) },
      NOTIFICATION_REASONS[n.reason] || 'New activity',
      false,
    )
    item.unread    = true
    item.threadId  = n.id
    item.updatedAt = n.updated_at
  }

  for (const pr of (reviewReqRes.data || [])) {
    if (pr.isDraft) continue
    add(pr.url, { title: pr.title, repo: pr.repository?.nameWithOwner || '', number: pr.number }, 'Review requested', true)
  }

  for (const pr of (approvedRes.data || [])) {
    add(pr.url, { title: pr.title, repo: pr.repository?.nameWithOwner || '', number: pr.number }, 'Approved — ready to merge', true)
  }

  // Unread activity first (newest first), then review requests, then approved
  const prs = [...byUrl.values()].sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1
    if (a.unread) return (b.updatedAt || '').localeCompare(a.updatedAt || '')
    return a.reasons.includes('Review requested') === b.reasons.includes('Review requested')
      ? 0 : a.reasons.includes('Review requested') ? -1 : 1
  })

  return { prs, error: null }
})

ipcMain.handle('mark-github-read', async (_e, threadId) => {
  const res = await ghCommand('mark-thread-read', { threadId })
  return { error: res.error || null }
})

// ── Claude Review IPC ─────────────────────────────────────────────────────────

// Cache cloudId per domain so we don't refetch it on every tab load
let _cloudIdCache = {}
async function getCloudId(domain) {
  if (_cloudIdCache[domain]) return _cloudIdCache[domain]
  const tenant = await makeHttpsGet(`https://${domain}/_edge/tenant_info`)
  if (tenant?.cloudId) _cloudIdCache[domain] = tenant.cloudId
  return tenant?.cloudId || null
}


ipcMain.handle('fetch-review-prs', async () => {
  const { domain, email, token } = getJiraCreds()
  if (!domain || !email || !token || domain.startsWith('<')) {
    return { myPRs: [], otherPRs: [], error: 'not_configured' }
  }

  const auth        = Buffer.from(`${email}:${token}`).toString('base64')
  const jiraHeaders = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }

  const cloudId = await getCloudId(domain)
  if (!cloudId) return { myPRs: [], otherPRs: [], error: 'Could not resolve Jira cloud ID' }

  const projectKey = readSetting('jira_project_key').trim()
  if (!projectKey) return { myPRs: [], otherPRs: [], error: 'No Jira project key configured — add one in Settings.' }

  const jql = encodeURIComponent(
    `project = ${projectKey} AND sprint in openSprints() ORDER BY updated DESC`
  )
  const searchUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql` +
    `?jql=${jql}&fields=summary,status,assignee&maxResults=100`
  const searchData = await makeHttpsGet(searchUrl, jiraHeaders)

  if (!searchData?.issues) {
    const err = searchData?.errorMessages?.[0] || 'Failed to fetch sprint issues'
    console.error('[review] search failed:', err)
    return { myPRs: [], otherPRs: [], error: err }
  }

  const statusNames  = [...new Set(searchData.issues.map(i => i.fields.status.name))]
  const reviewIssues = searchData.issues.filter(i => /review/i.test(i.fields.status.name))

  if (reviewIssues.length === 0) {
    return { myPRs: [], otherPRs: [], error: `No tickets in Code Review. Statuses found: ${statusNames.join(', ')}` }
  }

  const repoList = getRepoList()
  if (repoList.length === 0) {
    return { myPRs: [], otherPRs: [], error: 'No repos configured — add repos in Settings.' }
  }

  const [myPrsRes, ...repoResults] = await Promise.all([
    ghCommand('my-prs'),
    ...repoList.map(repo => ghCommand('repo-prs', { repo })),
  ])

  repoResults.forEach((r, i) => { if (r.error) console.warn(`[review] ${repoList[i]} gh error:`, r.error) })

  const myPrUrls = new Set((myPrsRes.data || []).map(p => p.url))

  const allGhPRs = repoResults.flatMap(r => r.data || [])

  const keyPattern = new RegExp(`${projectKey}-\\d+`, 'i')
  const prByKey = {}
  for (const pr of allGhPRs) {
    const m = pr.title?.match(keyPattern)
    if (m) prByKey[m[0].toUpperCase()] = pr
  }

  const all = reviewIssues.flatMap(issue => {
    const pr = prByKey[issue.key]
    if (!pr) return []
    const urlM = pr.url?.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    const repo     = urlM ? urlM[1] : (pr.repository?.nameWithOwner || pr.repository?.name || 'unknown')
    const prNumber = urlM ? parseInt(urlM[2]) : pr.number
    return [{
      jiraKey:     issue.key,
      jiraUrl:     `https://${domain}/browse/${issue.key}`,
      jiraSummary: issue.fields.summary,
      isMine:      myPrUrls.has(pr.url) || issue.fields.assignee?.emailAddress === email,
      prUrl:       pr.url,
      prTitle:     pr.title,
      repo,
      prNumber,
    }]
  })


  if (all.length === 0) {
    return {
      myPRs: [], otherPRs: [],
      error: `Found ${reviewIssues.length} ticket(s) in Code Review but none matched open PRs in: ${repoList.join(', ')}.`,
    }
  }

  // Fetch diff stats for all review PRs in parallel
  const statsMap = {}
  await Promise.all(all.map(async pr => {
    if (!pr.repo || !pr.prNumber) return
    const res = await ghCommand('pr-stats', { number: pr.prNumber, repo: pr.repo })
    if (res.data) statsMap[pr.prUrl] = res.data
  }))
  for (const pr of all) {
    const s = statsMap[pr.prUrl]
    pr.additions      = s?.additions      ?? null
    pr.deletions      = s?.deletions      ?? null
    pr.changedFiles   = s?.changedFiles   ?? null
    pr.reviewDecision = s?.reviewDecision ?? null
  }

  return { myPRs: all.filter(p => p.isMine), otherPRs: all.filter(p => !p.isMine) }
})

ipcMain.handle('post-pr-review-comment', async (_e, number, repo, body) => {
  if (!number || !repo || !body?.trim()) {
    console.error('[post-pr-review-comment] missing params — number:', number, 'repo:', repo, 'body length:', body?.length)
    return { error: 'missing params' }
  }
  const res = await ghCommand('post-pr-review-comment', { number, repo, body })
  if (res.error) console.error('[post-pr-review-comment] gh error:', res.error)
  return res
})

ipcMain.handle('mark-pr-commented', (_e, prUrl) => {
  try {
    db.prepare('INSERT OR REPLACE INTO pr_commented (pr_url) VALUES (?)').run(prUrl)
    return true
  } catch (e) { console.error('[db] mark-pr-commented:', e); return false }
})

ipcMain.handle('get-commented-pr-urls', () => {
  try {
    const rows = db.prepare('SELECT pr_url FROM pr_commented').all()
    return rows.map(r => r.pr_url)
  } catch (e) { console.error('[db] get-commented-pr-urls:', e); return [] }
})

ipcMain.handle('get-commented-pr-count-today', () => {
  try {
    const row = db.prepare(
      "SELECT COUNT(*) as count FROM pr_commented WHERE created >= CAST(strftime('%s', 'now', 'localtime', 'start of day') AS INTEGER)"
    ).get()
    return row ? row.count : 0
  } catch (e) { console.error('[db] get-commented-pr-count-today:', e); return 0 }
})

ipcMain.handle('get-pr-review', (_e, prUrl) => {
  try {
    const row = db.prepare('SELECT review FROM pr_reviews WHERE pr_url = ?').get(prUrl)
    return row ? row.review : null
  } catch (e) { console.error('[db] get-pr-review:', e); return null }
})

ipcMain.handle('run-pr-review', async (_e, prUrl, jiraKey) => {
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!m) return { error: 'Invalid PR URL' }
  const [, owner, repo, prNumberStr] = m
  const prNumber = parseInt(prNumberStr, 10)

  // Build allowed repos list from settings (for pr-diff security gate)
  const allowedRepos = getRepoList()

  // Fetch the raw diff via gh CLI
  const diffRes = await ghCommand('pr-diff', { number: prNumber, repo: `${owner}/${repo}`, allowedRepos })
  if (diffRes.error) return { error: `Failed to fetch PR diff: ${diffRes.error}` }
  const diff = (diffRes.data || '').trim()
  if (!diff) return { error: 'PR diff is empty' }

  const skill = readSetting('review_skill').trim()
  if (!skill) return { error: 'No review skill configured — add one in Settings.' }

  const claudeExec = await getClaudePath()

  return new Promise((resolve) => {
    const proc = spawn(claudeExec, ['-p', `${skill}\n\n${diff}`], {
      env: { ...process.env, HOME: os.homedir() },
      cwd: os.homedir(),
    })

    let out = ''
    let err = ''
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { err += d })

    proc.on('close', code => {
      const text = out.trim()
      if (!text) return resolve({ error: err.trim() || `claude exited with code ${code}` })

      try {
        db.prepare(
          'INSERT OR REPLACE INTO pr_reviews (pr_url, jira_key, review, created) VALUES (?, ?, ?, unixepoch())'
        ).run(prUrl, jiraKey || '', text)
      } catch (e) { console.error('[db] store review:', e) }

      resolve({ review: text })
    })

    proc.on('error', e => resolve({ error: `Failed to launch claude: ${e.message}` }))
  })
})

ipcMain.handle('run-sentry-skill', async (_e, tag, skillName, command) => {
  if (!tag || !command) return { error: 'tag and command required' }
  const claudeExec = await getClaudePath()
  return new Promise((resolve) => {
    const proc = spawn(claudeExec, ['-p', `/${command} ${tag}`], {
      env: { ...process.env, HOME: os.homedir() },
      cwd: os.homedir(),
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { err += d })
    proc.on('close', code => {
      const text = out.trim()
      if (!text) return resolve({ error: err.trim() || `claude exited with code ${code}` })
      try {
        db.prepare(
          'INSERT OR REPLACE INTO sentry_skill_runs (issue_tag, skill_name, output, created) VALUES (?, ?, ?, unixepoch())'
        ).run(tag, skillName, text)
      } catch (e) { console.error('[db] store sentry skill run:', e) }
      resolve({ output: text })
    })
    proc.on('error', e => resolve({ error: `Failed to launch claude: ${e.message}` }))
  })
})

ipcMain.handle('get-sentry-skill-runs', (_e, tag) => {
  try {
    const rows = db.prepare('SELECT skill_name, output FROM sentry_skill_runs WHERE issue_tag = ?').all(tag)
    const result = {}
    for (const row of rows) result[row.skill_name] = row.output
    return result
  } catch (e) { console.error('[db] get-sentry-skill-runs:', e); return {} }
})

// ── ICS parser ────────────────────────────────────────────────────────────────
// ── RRULE expansion helpers ───────────────────────────────────────────────────

function parseRRuleStr(str) {
  const out = {}
  str.replace(/^RRULE:/i, '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i)] = p.slice(i + 1)
  })
  return out
}

const ICS_WD = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 }

function icsAddDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }

function icsNthWeekday(year, month, wd, ord) {
  if (ord > 0) {
    const date = 1 + ((wd - new Date(year, month, 1).getDay() + 7) % 7) + (ord - 1) * 7
    return date <= new Date(year, month + 1, 0).getDate() ? new Date(year, month, date) : null
  } else {
    const last = new Date(year, month + 1, 0)
    const date = last.getDate() - ((last.getDay() - wd + 7) % 7) + (ord + 1) * 7
    return date >= 1 ? new Date(year, month, date) : null
  }
}

function expandRRule(dtstart, rrule, exdates, rangeStart, rangeEnd) {
  const freq     = rrule.FREQ || ''
  const interval = Math.max(1, parseInt(rrule.INTERVAL || '1'))
  const maxCount = rrule.COUNT ? parseInt(rrule.COUNT) : Infinity
  const until    = rrule.UNTIL ? parseICSDate(rrule.UNTIL) : null
  const ceiling  = new Date(rangeEnd.getTime() + 86400000)

  const byday = rrule.BYDAY
    ? rrule.BYDAY.split(',').map(s => {
        const m = s.match(/^([+-]?\d+)?([A-Z]{2})$/)
        return m ? { ord: m[1] != null ? parseInt(m[1]) : null, wd: ICS_WD[m[2]] } : null
      }).filter(Boolean)
    : null

  const done = (d, n) => (until && d > until) || n >= maxCount || d > ceiling
  const ok   = (d)    => d >= rangeStart && d <= ceiling && !exdates.has(d.toLocaleDateString('en-CA'))
  const out  = []
  const MAX  = 1000

  if (freq === 'DAILY') {
    let cur = new Date(dtstart), n = 0
    for (; n < MAX && !done(cur, n); n++, cur = icsAddDays(cur, interval))
      if (ok(cur)) out.push(new Date(cur))

  } else if (freq === 'WEEKLY') {
    if (byday && byday.length > 0) {
      const sorted = [...byday].sort((a, b) => a.wd - b.wd)
      let weekSun = icsAddDays(dtstart, -dtstart.getDay()), n = 0
      for (let wi = 0; wi < MAX && !done(weekSun, n); wi++) {
        for (const { wd } of sorted) {
          const occ = icsAddDays(weekSun, wd)
          occ.setHours(dtstart.getHours(), dtstart.getMinutes(), dtstart.getSeconds())
          if (occ < dtstart || done(occ, n)) continue
          n++
          if (ok(occ)) out.push(new Date(occ))
        }
        weekSun = icsAddDays(weekSun, 7 * interval)
      }
    } else {
      let cur = new Date(dtstart), n = 0
      for (; n < MAX && !done(cur, n); n++, cur = icsAddDays(cur, 7 * interval))
        if (ok(cur)) out.push(new Date(cur))
    }

  } else if (freq === 'MONTHLY') {
    let cur = new Date(dtstart), n = 0
    for (; n < MAX; n++) {
      const occ = (byday && byday.length > 0 && byday[0].ord !== null)
        ? (() => { const o = icsNthWeekday(cur.getFullYear(), cur.getMonth(), byday[0].wd, byday[0].ord); if (o) o.setHours(dtstart.getHours(), dtstart.getMinutes(), dtstart.getSeconds()); return o })()
        : new Date(cur)
      if (!occ || done(occ, n)) break
      if (ok(occ)) out.push(new Date(occ))
      cur = new Date(cur.getFullYear(), cur.getMonth() + interval, cur.getDate(),
        cur.getHours(), cur.getMinutes(), cur.getSeconds())
    }

  } else if (freq === 'YEARLY') {
    let cur = new Date(dtstart), n = 0
    for (; n < MAX && !done(cur, n); n++, cur = new Date(cur.getFullYear() + interval,
        cur.getMonth(), cur.getDate(), cur.getHours(), cur.getMinutes(), cur.getSeconds()))
      if (ok(cur)) out.push(new Date(cur))
  }

  return out
}

// ── ICS range parser ──────────────────────────────────────────────────────────

function icsDateStr(d) {  // Date → 'YYYY-MM-DD'
  return d instanceof Date ? d.toLocaleDateString('en-CA') : d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)
}

function parseICSRange(raw, startStr, endStr) {
  const unfolded   = raw.replace(/\r?\n[ \t]/g, '')
  const rangeStart = new Date(startStr + 'T00:00:00')
  const rangeEnd   = new Date(endStr   + 'T23:59:59')
  const byDate     = {}

  const baseEvents = new Map()  // uid → event
  const overrides  = []         // events with RECURRENCE-ID

  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0]
    const prop = name => { const m = body.match(new RegExp(`^${name}[;:][^\\r\\n]*`, 'm')); return m ? m[0] : '' }

    const summary = prop('SUMMARY').replace(/^SUMMARY[;:]/, '').trim()
    if (!summary) continue
    if (prop('STATUS').includes('CANCELLED')) continue

    const dtStartProp = prop('DTSTART')
    const dtEndProp   = prop('DTEND')
    const tzid        = (dtStartProp.match(/TZID=([^:;]+)/) || [])[1] || ''
    const dtstart     = parseICSDate(dtStartProp.split(':').pop().trim(), tzid)
    const dtend       = dtEndProp ? parseICSDate(dtEndProp.split(':').pop().trim(), tzid) : null
    if (!dtstart) continue

    const uid      = prop('UID').replace(/^UID[;:]/, '').trim() || String(Math.random())
    const rruleProp = prop('RRULE')
    const recurProp = prop('RECURRENCE-ID')

    // Collect EXDATEs (can be multiple lines)
    const exdates = new Set()
    for (const line of body.match(/^EXDATE[;:][^\r\n]*/gm) || []) {
      const exTzid = (line.match(/TZID=([^:;]+)/) || [])[1] || tzid
      for (const val of line.split(':').pop().split(',')) {
        const d = parseICSDate(val.trim(), exTzid)
        if (d) exdates.add(icsDateStr(d))
      }
    }

    const confLine  = prop('X-GOOGLE-CONFERENCE')
    const zoomLine  = prop('X-ZOOM-JOIN-URL')
    const teamsLine = prop('X-MICROSOFT-ONLINEMEETINGCONFLINK')
    const locLine   = prop('LOCATION')
    const descLine  = prop('DESCRIPTION')
    const firstUrl  = str => { const m = str.match(/https?:\/\/\S+/); return m ? m[0].replace(/[,;<>"\\]+$/, '') : null }
    const isVideo   = str => /meet\.google\.com|zoom\.us|teams\.microsoft\.com|webex\.com|gotomeeting\.com/i.test(str)
    const meetUrl   = firstUrl(confLine)
      || firstUrl(zoomLine)
      || firstUrl(teamsLine)
      || (isVideo(locLine)  ? firstUrl(locLine)  : null)
      || (isVideo(descLine) ? firstUrl(descLine) : null)
      || null

    const ev = { uid, summary, dtstart, dtend, rruleProp, exdates, meetUrl }
    if (recurProp) {
      overrides.push({ ...ev, recurDate: parseICSDate(recurProp.split(':').pop().trim(), tzid) })
    } else {
      baseEvents.set(uid, ev)
    }
  }

  // Dates overridden by a RECURRENCE-ID event should be excluded from base expansion
  const overriddenByUid = new Map()
  for (const ov of overrides) {
    if (!overriddenByUid.has(ov.uid)) overriddenByUid.set(ov.uid, new Set())
    if (ov.recurDate) overriddenByUid.get(ov.uid).add(icsDateStr(ov.recurDate))
  }

  function timeStr(start, end) {
    if (!(start instanceof Date)) return 'All day'
    let t = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      .replace(':00 ', ' ').toLowerCase()
    if (end instanceof Date) {
      const m = Math.round((end - start) / 60000), h = Math.floor(m / 60), rem = m % 60
      const dur = (h ? `${h}hr ` : '') + (rem ? `${rem}min` : '')
      if (dur.trim()) t += ` (${dur.trim()})`
    }
    return t
  }

  function push(dateStr, summary, ts, sortKey, meetUrl) {
    if (dateStr < startStr || dateStr > endStr) return
    const entry = { summary, timeStr: ts, sortKey }
    if (meetUrl) entry.meetUrl = meetUrl
    ;(byDate[dateStr] = byDate[dateStr] || []).push(entry)
  }

  // Base events
  for (const ev of baseEvents.values()) {
    const { uid, summary, dtstart, dtend, rruleProp, exdates, meetUrl } = ev
    const allExcl = new Set([...exdates, ...(overriddenByUid.get(uid) || [])])

    if (rruleProp) {
      const startDt  = dtstart instanceof Date ? dtstart
        : new Date(dtstart.slice(0,4)+'-'+dtstart.slice(4,6)+'-'+dtstart.slice(6,8)+'T12:00:00')
      const isAllDay = !(dtstart instanceof Date)
      const duration = (dtstart instanceof Date && dtend instanceof Date) ? dtend - dtstart : null
      for (const occ of expandRRule(startDt, parseRRuleStr(rruleProp), allExcl, rangeStart, rangeEnd)) {
        const occEnd = duration ? new Date(occ.getTime() + duration) : null
        push(occ.toLocaleDateString('en-CA'), summary,
          isAllDay ? 'All day' : timeStr(occ, occEnd), occ.getTime(), meetUrl)
      }
    } else {
      const ds = icsDateStr(dtstart)
      if (!allExcl.has(ds)) push(ds, summary, timeStr(dtstart, dtend),
        dtstart instanceof Date ? dtstart.getTime() : 0, meetUrl)
    }
  }

  // Modified occurrences
  for (const ov of overrides) {
    const ds = icsDateStr(ov.dtstart)
    push(ds, ov.summary, timeStr(ov.dtstart, ov.dtend),
      ov.dtstart instanceof Date ? ov.dtstart.getTime() : 0, ov.meetUrl)
  }

  for (const d of Object.keys(byDate)) byDate[d].sort((a, b) => a.sortKey - b.sortKey)
  return byDate
}

// Windows timezone name → IANA
const WINDOWS_TZ = {
  'Eastern Standard Time':    'America/New_York',
  'Central Standard Time':    'America/Chicago',
  'Mountain Standard Time':   'America/Denver',
  'Pacific Standard Time':    'America/Los_Angeles',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'US Mountain Standard Time':'America/Phoenix',
  'Alaskan Standard Time':    'America/Anchorage',
  'Hawaiian Standard Time':   'Pacific/Honolulu',
  'GMT Standard Time':        'Europe/London',
  'Romance Standard Time':    'Europe/Paris',
  'W. Europe Standard Time':  'Europe/Berlin',
}

function tzidToIANA(tzid) {
  if (!tzid) return null
  if (tzid.includes('/')) return tzid          // already IANA (e.g. America/Chicago)
  return WINDOWS_TZ[tzid] || null
}

// Parse a local datetime string (YYYYMMDDTHHMMSS) as being in ianaTimezone, return UTC Date
function parseDateInZone(val, ianaTimezone) {
  const y = val.slice(0, 4), mo = val.slice(4, 6), d = val.slice(6, 8)
  const h = val.slice(9, 11), mi = val.slice(11, 13), s = val.slice(13, 15)

  // Treat as UTC temporarily so Intl can tell us the offset for that moment
  const assumedUTC = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(assumedUTC)
  const get = type => parts.find(p => p.type === type)?.value
  const tzAsUTC = new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`)
  return new Date(assumedUTC.getTime() + (assumedUTC - tzAsUTC))
}

function parseICSDate(val, tzid = '') {
  val = val.trim()
  if (!val) return null
  if (val.length === 8) return val   // all-day: return YYYYMMDD string

  const y = val.slice(0, 4), mo = val.slice(4, 6), d = val.slice(6, 8)
  const h = val.slice(9, 11), mi = val.slice(11, 13), s = val.slice(13, 15)

  if (val.endsWith('Z'))
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`)

  // Convert from the event's declared timezone to UTC
  const ianaZone = tzidToIANA(tzid)
  if (ianaZone) return parseDateInZone(val, ianaZone)

  // Floating time — treat as local
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`)
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Dock icon in dev (macOS only). The packaged app gets its icon from the
  // .icns that electron-builder generates from assets/icon.png.
  if (process.platform === 'darwin' && !app.isPackaged) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')))
    } catch (e) { console.error('[icon] failed to set dock icon:', e) }
  }

  createWindow()
  scheduleDailyRefresh()
  powerMonitor.on('resume', () => {
    const today = new Date().toLocaleDateString('en-CA')
    if (today !== lastLoadDate && mainWindow) {
      lastLoadDate = today
      mainWindow.webContents.reload()
    }
  })
})
app.on('before-quit', () => { if (db) db.close() })
app.on('window-all-closed', () => {
  if (fileWatcher) fileWatcher.close()
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
