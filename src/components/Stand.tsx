import React, { useState, useEffect, useCallback } from 'react'
import CollapsibleSection from './CollapsibleSection'
import type { Standup, StandupRepo, StandupCommit } from '../types/tracker'

// Standup days (Date#getDay) and how many days back each recap starts, at local midnight:
// Monday covers Thu, Fri and Monday so far; Tuesday covers Mon and Tue so far;
// Thursday covers Tue, Wed and Thu so far. On other days the block is hidden.
const WINDOWS: Record<number, number> = { 1: 4, 2: 1, 4: 2 }

function localDate(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// First day of today's recap window as YYYY-MM-DD, or null when today isn't a standup day
export function standupSince(now: Date): string | null {
  const back = WINDOWS[now.getDay()]
  if (back === undefined) return null
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back))
}

function msUntilMidnight(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
}

function weekdayName(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' })
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

// Jira key as written in a commit subject: "CORE-8354", "core-8354", "feat(CORE-8446):", or
// "core 8354:" at the very start. Normalised to upper case; null when there isn't one.
export function ticketOf(subject: string): string | null {
  const m = subject.match(/\b([A-Za-z][A-Za-z0-9]{1,9})-(\d{2,6})\b/)
         ?? subject.match(/^\W*([A-Za-z]{2,10}) (\d{2,6})\b/)
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null
}

// Drops the leading ticket reference the group header already shows, keeping any
// conventional-commit type: "feat(CORE-8446): land" -> "feat: land", "core 8354: fix" -> "fix"
export function stripTicket(subject: string, key: string): string {
  const [proj, num] = key.split('-')
  const ref = `${proj}[- ]?${num}(?!\\d)`
  const out = subject
    .replace(new RegExp(`^(\\w+)\\(${ref}\\)(!?):`, 'i'), '$1$2:')
    .replace(new RegExp(`^\\W*${ref}\\W*`, 'i'), '')
    .trim()
  return out || subject
}

// Squash-merge subjects end in the PR number, which the row shows as a link instead
function prTitle(subject: string) {
  return subject.replace(/\s*\(#\d+\)\s*$/, '')
}

interface Row   { repo: StandupRepo; commit: StandupCommit }
interface Group { key: string | null; rows: Row[] }

// One group per ticket, newest activity first, commits without a ticket last
function groupByTicket(repos: StandupRepo[]): Group[] {
  const byKey = new Map<string | null, Row[]>()
  for (const repo of repos) {
    for (const commit of repo.commits) {
      const key = ticketOf(commit.subject)
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key)!.push({ repo, commit })
    }
  }
  const latest = (rows: Row[]) => Math.max(...rows.map(r => Date.parse(r.commit.date)))
  return [...byKey.entries()]
    .map(([key, rows]) => ({ key, rows: rows.sort((a, b) => Date.parse(b.commit.date) - Date.parse(a.commit.date)) }))
    .sort((a, b) => (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || latest(b.rows) - latest(a.rows))
}

const ERROR_TEXT: Record<string, React.ReactNode> = {
  not_installed: <>git-standup isn't installed · <code>brew install git-standup</code></>,
}

// What you committed since the last standup, grouped by Jira ticket, via git-standup
// (see standup-service.js)
export default function Stand() {
  const [since,      setSince]      = useState<string | null>(() => standupSince(new Date()))
  const [standup,    setStandup]    = useState<Standup | null>(null)
  const [error,      setError]      = useState<string | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [jiraDomain, setJiraDomain] = useState<string | null>(null)

  useEffect(() => { window.tracker.getSetting('jira_domain').then(setJiraDomain) }, [])

  // Re-evaluate the window when the day rolls over, so the block appears and hides on schedule
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      timer = setTimeout(() => { setSince(standupSince(new Date())); schedule() }, msUntilMidnight(new Date()) + 1000)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])

  const load = useCallback(async () => {
    if (!since) return
    setLoading(true)
    try {
      const res = await window.tracker.fetchStandup(since)
      if (res.standup) {
        setStandup(res.standup)
        setError(null)
      } else {
        console.error('[Stand] fetchStandup failed:', res.error)
        setError(res.error ?? 'failed')
      }
    } catch (e) {
      console.error('[Stand] fetchStandup failed:', e)
      setError(String(e))
    }
    setLoading(false)
  }, [since])

  useEffect(() => { setStandup(null); load() }, [load])

  if (!since) return null

  const sinceDay  = weekdayName(since)
  const groups    = standup ? groupByTicket(standup.repos) : []

  function openTicket(key: string) {
    if (jiraDomain) window.tracker.openUrl(`https://${jiraDomain}/browse/${key}`)
  }

  function openPr(repo: StandupRepo, pr: number) {
    window.tracker.openUrl(`https://github.com/${repo.full}/pull/${pr}`)
  }

  return (
    <CollapsibleSection label="Stand" colorClass="group-testing" defaultCollapsed>
      <div className="needs-you-toolbar">
        <span className="needs-you-sub">Since {sinceDay}</span>
        <button className={`refresh-btn${loading ? ' spinning' : ''}`} onClick={load} title="Refresh">↻</button>
      </div>
      {loading && !standup ? (
        <div className="cal-none">Loading…</div>
      ) : error ? (
        <div className="cal-none">{ERROR_TEXT[error] ?? "Couldn't run git-standup"}</div>
      ) : groups.length === 0 ? (
        <div className="cal-none">No commits since {sinceDay}</div>
      ) : groups.map(({ key, rows }) => (
        <div key={key ?? '(none)'} className="stand-group">
          <div className="stand-group-name">
            {key
              ? <span className={jiraDomain ? 'stand-ticket-link' : undefined} onClick={() => openTicket(key)}>{key}</span>
              : 'No ticket'}
            <span className="stand-count">{rows.length}</span>
          </div>
          {rows.map(({ repo, commit }) => {
            const base  = commit.pr !== null ? prTitle(commit.subject) : commit.subject
            const title = key ? stripTicket(base, key) : base
            return (
              <div
                key={commit.hash}
                className={`stand-row${commit.pr !== null ? ' stand-row-pr' : ''}`}
                title={commit.subject}
                onClick={commit.pr !== null ? () => openPr(repo, commit.pr!) : undefined}
              >
                {commit.pr !== null
                  ? <span className="stand-ref review-pr-link">#{commit.pr}</span>
                  : <span className="stand-ref stand-hash">{commit.hash.slice(0, 7)}</span>}
                <span className="stand-subject">{title}</span>
                {commit.pr !== null && <span className="pr-draft">merged</span>}
                <span className="needs-you-time">{formatWhen(commit.date)}</span>
              </div>
            )
          })}
        </div>
      ))}
    </CollapsibleSection>
  )
}
