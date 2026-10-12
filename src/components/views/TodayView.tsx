import React, { useState, useEffect } from 'react'
import CollapsibleSection from '../CollapsibleSection'
import type { Meeting, NeedsYouPR, NeedsYouJira } from '../../types/tracker'

// A meeting that started this recently still counts as "now" for the Next up card
const IN_PROGRESS_MS = 10 * 60 * 1000

interface Props {
  meetings: Meeting[]
}

function formatCountdown(ms: number) {
  const mins = Math.max(0, Math.round(ms / 60000))
  if (mins < 1)  return 'now'
  if (mins < 60) return `in ${mins} min`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `in ${h}h ${m}m` : `in ${h}h`
}

function formatAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24)    return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function NextUp({ meetings }: { meetings: Meeting[] }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const timed   = meetings.filter(m => m.sortKey > 0).sort((a, b) => a.sortKey - b.sortKey)
  const current = [...timed].reverse().find(m => m.sortKey <= now && now - m.sortKey < IN_PROGRESS_MS)
  const meeting = current || timed.find(m => m.sortKey > now)

  if (!meeting) return <div className="next-up next-up-empty">No more meetings today</div>

  const when = current
    ? `Started ${Math.max(1, Math.round((now - meeting.sortKey) / 60000))} min ago`
    : formatCountdown(meeting.sortKey - now)

  return (
    <div className={`next-up${current ? ' next-up-live' : ''}`}>
      <div className="next-up-info">
        <div className="next-up-label">Next up · {meeting.timeStr}</div>
        <div className="next-up-title">{meeting.summary}</div>
      </div>
      <div className="next-up-right">
        <span className="next-up-when">{when}</span>
        {meeting.meetUrl && (
          <button className="cal-join-btn next-up-join" onClick={() => window.tracker.openUrl(meeting.meetUrl!)}>
            Join ↗
          </button>
        )}
      </div>
    </div>
  )
}

interface Stream<T> {
  items:   T[]
  error:   string | null
  loading: boolean
}

function emptyStream<T>(): Stream<T> {
  return { items: [], error: null, loading: true }
}

// Runs a fetch and keeps its items/error/loading together in one state object
async function loadStream<T>(
  fetch: () => Promise<{ items: T[]; error: string | null }>,
  set:   React.Dispatch<React.SetStateAction<Stream<T>>>,
  label: string,
) {
  set(prev => ({ ...prev, loading: true }))
  try {
    const { items, error } = await fetch()
    set({ items, error, loading: false })
  } catch (e) {
    console.error(`[TodayView] ${label} failed:`, e)
    set(prev => ({ ...prev, error: String(e), loading: false }))
  }
}

function MarkReadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="needs-you-read-btn"
      title="Mark as read"
      onClick={e => { e.stopPropagation(); onClick() }}
    >✓</button>
  )
}

function NeedsYou() {
  const [github, setGithub] = useState<Stream<NeedsYouPR>>(emptyStream)
  const [jira,   setJira]   = useState<Stream<NeedsYouJira>>(emptyStream)

  function load() {
    loadStream(() => window.tracker.fetchNeedsYou().then(r => ({ items: r.prs || [], error: r.error })), setGithub, 'fetchNeedsYou')
    loadStream(() => window.tracker.fetchJiraNeedsYou().then(r => ({ items: r.issues || [], error: r.error })), setJira, 'fetchJiraNeedsYou')
  }

  useEffect(() => { load() }, [])

  // Drop the notification's tags; keep the row if it's still awaiting review or merge
  async function markPrRead(pr: NeedsYouPR) {
    if (!pr.threadId) return
    const res = await window.tracker.markGithubRead(pr.threadId)
    if (res.error) { console.error('[TodayView] markGithubRead failed:', res.error); return }
    setGithub(prev => ({
      ...prev,
      items: prev.items.flatMap(p => p.url !== pr.url ? [p]
        : p.searchReasons.length === 0 ? []
        : [{ ...p, reasons: p.searchReasons, unread: false, threadId: null, updatedAt: null }]),
    }))
  }

  function markJiraSeen(issue: NeedsYouJira) {
    window.tracker.markJiraSeen(issue.key)
    setJira(prev => ({ ...prev, items: prev.items.filter(i => i.key !== issue.key) }))
  }

  function openJira(issue: NeedsYouJira) {
    markJiraSeen(issue)
    window.tracker.openUrl(issue.url)
  }

  const loading = github.loading || jira.loading

  return (
    <div>
      <div className="needs-you-toolbar">
        <span className="needs-you-sub">GitHub</span>
        <button className={`refresh-btn${loading ? ' spinning' : ''}`} onClick={load} title="Refresh">↻</button>
      </div>
      {github.loading && github.items.length === 0 ? (
        <div className="cal-none">Loading…</div>
      ) : github.error ? (
        <div className="cal-none">Couldn't load GitHub — is <code>gh</code> signed in?</div>
      ) : github.items.length === 0 ? (
        <div className="cal-none">You're all caught up</div>
      ) : github.items.map(pr => (
        <div key={pr.url} className="needs-you-row" onClick={() => window.tracker.openUrl(pr.url)}>
          <span className={`needs-you-dot${pr.unread ? ' unread' : ''}`} />
          <span className="review-pr-link">{pr.repo.split('/').pop()}#{pr.number}</span>
          <span className="needs-you-title">{pr.title}</span>
          {pr.reasons.map(r => <span key={r} className="pr-draft">{r}</span>)}
          {pr.updatedAt && <span className="needs-you-time">{formatAgo(pr.updatedAt)}</span>}
          {pr.threadId && <MarkReadButton onClick={() => markPrRead(pr)} />}
        </div>
      ))}

      <div className="needs-you-toolbar needs-you-toolbar-next">
        <span className="needs-you-sub">Jira</span>
      </div>
      {jira.loading && jira.items.length === 0 ? (
        <div className="cal-none">Loading…</div>
      ) : jira.error === 'not_configured' ? (
        <div className="cal-none">Add your Jira credentials in Settings</div>
      ) : jira.error ? (
        <div className="cal-none">Couldn't load Jira</div>
      ) : jira.items.length === 0 ? (
        <div className="cal-none">No new comments</div>
      ) : jira.items.map(issue => (
        <div key={issue.key} className="needs-you-row" onClick={() => openJira(issue)}>
          <span className="needs-you-dot unread" />
          <span className="review-pr-link">{issue.key}</span>
          <span className="needs-you-title">{issue.title}</span>
          <span className="pr-draft">{issue.newCount} new comment{issue.newCount === 1 ? '' : 's'}</span>
          {issue.status && <span className="pr-draft">{issue.status}</span>}
          <span className="needs-you-time">
            {issue.latestAuthor ? `${issue.latestAuthor.split(' ')[0]} · ` : ''}{formatAgo(issue.latestAt)}
          </span>
          <MarkReadButton onClick={() => markJiraSeen(issue)} />
        </div>
      ))}
    </div>
  )
}

export default function TodayView({ meetings }: Props) {
  const now = Date.now()

  return (
    <div id="view-today" className="view">
      <div className="view-card">
      <div className="list-wrap">
        <NextUp meetings={meetings} />

        <CollapsibleSection label="Needs you" colorClass="group-progress">
          <NeedsYou />
        </CollapsibleSection>

        {meetings.length > 0 && (
          <CollapsibleSection label="Meetings" colorClass="group-review">
            {meetings.map((m, i) => {
              const isPast = m.sortKey > 0 && m.sortKey < now
              return (
                <div key={i} className={`meeting-item${isPast ? ' past' : ''}`}>
                  <span className="meeting-title">{m.summary}</span>
                  <span className="meeting-time">{m.timeStr || ''}</span>
                </div>
              )
            })}
          </CollapsibleSection>
        )}
      </div>
      </div>
    </div>
  )
}
