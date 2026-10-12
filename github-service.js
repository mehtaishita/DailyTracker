/**
 * GitHub microservice — runs as a forked child process.
 * Only responds to two predetermined command types; ignores everything else.
 * No open ports, no arbitrary command execution.
 */
const { execFile } = require('child_process')

const FIELDS = 'title,url,number,isDraft,repository'

const COMMANDS = {
  'my-prs': [
    'search', 'prs', '--author=@me', '--state=open', '--json', FIELDS, '--limit', '200',
  ],
  'review-requested': [
    'search', 'prs', '--review-requested=@me', '--state=open', '--json', FIELDS, '--limit', '200',
  ],
  'my-approved': [
    'search', 'prs', '--author=@me', '--state=open', '--review=approved', '--json', FIELDS, '--limit', '50',
  ],
  // Unread notification threads only (GitHub tracks read state)
  'notifications': [
    'api', 'notifications?per_page=50',
  ],
}

process.on('message', ({ id, type, params = {} }) => {
  // pr-stats: fetch additions/deletions/changedFiles for a single PR
  if (type === 'pr-stats') {
    const { number, repo } = params
    if (!number || !repo) {
      process.send({ id, data: null })
      return
    }
    execFile(
      'gh', ['pr', 'view', String(number), '--repo', repo, '--json', 'additions,deletions,changedFiles,reviewDecision'],
      { timeout: 10000 },
      (err, stdout) => {
        if (err) { process.send({ id, data: null }); return }
        try { process.send({ id, data: JSON.parse(stdout) }) }
        catch { process.send({ id, data: null }) }
      }
    )
    return
  }

  // post-pr-review-comment: post a block review comment on a PR via gh pr review
  if (type === 'post-pr-review-comment') {
    const { number, repo, body } = params
    if (!number || !repo || !body) { process.send({ id, error: 'missing params' }); return }
    execFile(
      'gh', ['pr', 'review', String(number), '--comment', '-b', body, '-R', repo],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) { process.send({ id, error: stderr || err.message }); return }
        process.send({ id, data: true })
      }
    )
    return
  }

  // mark-thread-read: mark one notification thread as read on GitHub
  if (type === 'mark-thread-read') {
    const { threadId } = params
    if (!/^\d+$/.test(String(threadId || ''))) { process.send({ id, error: 'invalid threadId' }); return }
    execFile(
      'gh', ['api', '-X', 'PATCH', `notifications/threads/${threadId}`],
      { timeout: 10000 },
      (err, stdout, stderr) => {
        if (err) { process.send({ id, error: stderr || err.message }); return }
        process.send({ id, data: true })
      }
    )
    return
  }

  // repo-prs: fetch open PRs from a specific repo (dynamic, user-configured)
  if (type === 'repo-prs') {
    const { repo } = params
    if (!repo || !/^[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+$/.test(repo)) {
      process.send({ id, error: 'repo-prs: invalid repo format (expected owner/repo)' })
      return
    }
    execFile(
      'gh', ['search', 'prs', `--repo=${repo}`, '--state=open', '--json', FIELDS, '--limit', '200'],
      { timeout: 15000 },
      (err, stdout) => {
        if (err) { process.send({ id, error: err.message }); return }
        try { process.send({ id, data: JSON.parse(stdout) }) }
        catch { process.send({ id, error: 'JSON parse error' }) }
      }
    )
    return
  }

  // pr-diff: fetch raw unified diff for a specific PR
  if (type === 'pr-diff') {
    const { number, repo, allowedRepos } = params
    if (!number || !repo) {
      process.send({ id, error: 'pr-diff requires params.number and params.repo' })
      return
    }
    // GitHub owner/repo names are case-insensitive (the API returns "Carefeed/admin-portal"
    // while Settings may store "carefeed/admin-portal"), so compare case-insensitively.
    const allowed = Array.isArray(allowedRepos) ? allowedRepos.filter(r => typeof r === 'string') : []
    const repoLc = String(repo).toLowerCase()
    if (allowed.length === 0 || !allowed.some(r => r.toLowerCase() === repoLc)) {
      process.send({ id, error: `Blocked: repo must be one of ${allowed.join(', ')}` })
      return
    }
    execFile(
      'gh', ['pr', 'diff', String(number), '--repo', repo],
      { timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) { process.send({ id, error: stderr || err.message }); return }
        process.send({ id, data: stdout })
      }
    )
    return
  }

  const args = COMMANDS[type]
  if (!args) {
    process.send({ id, error: `unknown command: ${type}` })
    return
  }

  execFile('gh', args, { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) {
      process.send({ id, error: stderr || err.message })
      return
    }
    try {
      process.send({ id, data: JSON.parse(stdout) })
    } catch {
      process.send({ id, error: 'JSON parse error' })
    }
  })
})
