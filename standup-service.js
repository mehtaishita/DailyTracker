/**
 * Stand — recaps your commits in the watched repos via git-standup
 * (https://github.com/nilbuild/git-standup, `brew install git-standup`).
 * Required directly by main.js (not forked like the GitHub/Sentry services).
 *
 * Each watched "owner/repo" is expected to be checked out at ~/code/<repo>. git-standup runs
 * once per checkout; its piped (non-TTY) output looks like:
 *   /Users/me/code/some-repo
 *   bbcca57 - subject line (2026-10-12T15:32:55-05:00) <Author Name> \n
 * The trailing backslash-n is literal, an artifact of the tool's uncolored format string.
 */
const { execFile } = require('child_process')
const fs   = require('fs')
const os   = require('os')
const path = require('path')

const CODE_DIR = path.join(os.homedir(), 'code')

// Bookkeeping commits that `git stash` creates; they show up because git-standup logs --all
const STASH_SUBJECT = /^(index on |untracked files on |WIP on )/

const COMMIT_LINE = /^([0-9a-f]{7,40}) - (.*) \(([^()]+)\) <([^<>]*)>\s*(?:\\n)?\s*$/

// GitHub appends the PR number to a squash-merge commit's subject: "Title (#1234)"
const PR_SUFFIX = /\(#(\d+)\)\s*$/

// git must never wait for a password or host-key answer; there is no terminal to type into
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' }

// Commit lines from one checkout's git-standup output
function parseCommits(out) {
  const commits = []
  for (const raw of out.split('\n')) {
    const m = raw.trimEnd().match(COMMIT_LINE)
    if (!m) continue                        // repo header, blank line, or a warning
    const [, hash, subject, date, author] = m
    if (STASH_SUBJECT.test(subject)) continue
    const pr = subject.match(PR_SUFFIX)
    commits.push({ hash, subject, date, author, pr: pr ? Number(pr[1]) : null })
  }
  return commits
}

// git-standup inside one checkout, fetching first (-f) so PRs merged on GitHub are included.
// Resolves { commits } or { error: 'not_installed' | 'failed' }.
function runGitStandup(cwd, since) {
  const args = ['-f', '-A', `${since} 00:00:00`, '-D', 'iso-strict', '-s']
  return new Promise((resolve) => {
    execFile('git-standup', args, { cwd, env: GIT_ENV, timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return resolve({ error: 'not_installed' })
      if (err) {
        console.error(`[standup] git-standup failed in ${cwd}:`, stderr || err.message)
        return resolve({ error: 'failed' })
      }
      resolve({ commits: parseCommits(String(stdout)) })
    })
  })
}

// Commits by the local git user since local midnight of `since` (YYYY-MM-DD) in each watched
// "owner/repo" checked out under ~/code. Repos with no checkout or no commits are left out.
// Resolves { since, repos } or { error: 'not_installed' }.
async function fetchStandup(since, watched) {
  const results = await Promise.all(watched.map(async (full) => {
    const name = full.split('/').pop()
    const dir  = path.join(CODE_DIR, name)
    if (!fs.existsSync(path.join(dir, '.git'))) return null
    return { full, name, path: dir, ...(await runGitStandup(dir, since)) }
  }))

  const repos = []
  for (const r of results) {
    if (!r) continue
    if (r.error === 'not_installed') return { error: r.error }
    if (r.error) continue                    // already logged; the other repos still show
    if (r.commits.length > 0) repos.push({ full: r.full, name: r.name, path: r.path, commits: r.commits })
  }
  return { since, repos }
}

module.exports = { fetchStandup, parseCommits, CODE_DIR }
