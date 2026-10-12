import React, { useState, useEffect, useRef } from 'react'
import CollapsibleSection from '../CollapsibleSection'
import type { JiraIssue, JiraFilter } from '../../types/tracker'

interface Group {
  key:   string
  label: string
  match: (s: string) => boolean
}

const GROUPS: Group[] = [
  { key: 'progress', label: 'In Progress',  match: s => /progress|development|doing/i.test(s) },
  { key: 'review',   label: 'Code Review',  match: s => /review/i.test(s) },
  { key: 'testing',  label: 'Testing',      match: s => /test|qa|verif/i.test(s) },
  { key: 'todo',     label: 'To Do',        match: s => /to.?do|backlog|open|new|selected/i.test(s) },
  { key: 'done',     label: 'Done',         match: s => /done|closed|complete|released|merged/i.test(s) },
]

function getGroup(status: string) {
  for (const g of GROUPS) if (g.match(status)) return g
  return { key: 'other', label: status }
}

function filterIdFromUrl(url: string): string | null {
  const m = url.match(/[?&]filter=(\d+)/)
  return m ? m[1] : null
}

type Mode = 'sprint' | 'filter'

export default function JiraView() {
  const [mode,     setMode]     = useState<Mode>('sprint')

  // Sprint state
  const [sprintLoaded,   setSprintLoaded]   = useState(false)
  const [sprintSpinning, setSprintSpinning] = useState(false)
  const [sprintError,    setSprintError]    = useState<string | null>(null)
  const [grouped,        setGrouped]        = useState<Map<string, { label: string; items: JiraIssue[] }>>(new Map())

  // Filter state
  const [filters,          setFilters]          = useState<JiraFilter[]>([])
  const [selectedFilterIdx, setSelectedFilterIdx] = useState(0)
  const [filterIssues,     setFilterIssues]     = useState<JiraIssue[]>([])
  const [nextPageToken,    setNextPageToken]    = useState<string | null>(null)
  const [filterLoading,    setFilterLoading]    = useState(false)
  const [filterLoadingMore, setFilterLoadingMore] = useState(false)
  const [filterError,      setFilterError]      = useState<string | null>(null)
  const filterFetchId = useRef(0)

  // Load saved filters from settings
  useEffect(() => {
    window.tracker.getSetting('jira_filters').then(raw => {
      if (!raw) return
      try { setFilters(JSON.parse(raw)) } catch {}
    })
  }, [])

  // ── Sprint ──────────────────────────────────────────────────────────────────

  async function loadSprint() {
    setSprintSpinning(true)
    const { issues, error: err } = await window.tracker.fetchJiraSprint()
    setSprintSpinning(false)
    setSprintLoaded(true)
    if (err) { setSprintError(err); return }
    const map = new Map<string, { label: string; items: JiraIssue[] }>()
    for (const issue of issues ?? []) {
      const g = getGroup(issue.status)
      if (!map.has(g.key)) map.set(g.key, { label: g.label, items: [] })
      map.get(g.key)!.items.push(issue)
    }
    setGrouped(map)
    setSprintError(null)
  }

  useEffect(() => { if (!sprintLoaded && mode === 'sprint') loadSprint() }, [mode])

  // ── Filter ──────────────────────────────────────────────────────────────────

  async function loadFilter(filterId: string, append = false) {
    const fetchId = ++filterFetchId.current
    if (append) setFilterLoadingMore(true)
    else        setFilterLoading(true)

    const token = append ? nextPageToken : null
    const result = await window.tracker.fetchJiraFilterIssues(filterId, token)

    if (fetchId !== filterFetchId.current) return // stale fetch
    setFilterLoading(false)
    setFilterLoadingMore(false)

    if (result.error) { setFilterError(result.error); return }
    setFilterError(null)
    setFilterIssues(prev => append ? [...prev, ...(result.issues ?? [])] : (result.issues ?? []))
    setNextPageToken(result.nextPageToken ?? null)
  }

  useEffect(() => {
    if (mode !== 'filter' || filters.length === 0) return
    const filter = filters[selectedFilterIdx]
    if (!filter) return
    const id = filterIdFromUrl(filter.url)
    if (!id) { setFilterError('Could not parse filter ID from URL'); return }
    setFilterIssues([])
    setNextPageToken(null)
    loadFilter(id)
  }, [mode, selectedFilterIdx, filters])

  function handleLoadMore() {
    const filter = filters[selectedFilterIdx]
    if (!filter) return
    const id = filterIdFromUrl(filter.url)
    if (!id) return
    loadFilter(id, true)
  }

  function switchMode(next: Mode) {
    setMode(next)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const orderedKeys = [...GROUPS.map(g => g.key), 'other']

  return (
    <div id="view-jira" className="view">
      <div className="view-card">
        <div className="tab-toolbar">
          <span className="toolbar-title">{mode === 'sprint' ? 'Sprint' : 'Filter'}</span>
          <div className="jira-mode-toggle">
            <button
              className={`jira-mode-btn${mode === 'sprint' ? ' active' : ''}`}
              onClick={() => switchMode('sprint')}
            >My Sprint</button>
            <button
              className={`jira-mode-btn${mode === 'filter' ? ' active' : ''}`}
              onClick={() => switchMode('filter')}
            >Filters</button>
          </div>
          <button
            className={`refresh-btn${(mode === 'sprint' ? sprintSpinning : filterLoading) ? ' spinning' : ''}`}
            onClick={mode === 'sprint' ? loadSprint : () => {
              const filter = filters[selectedFilterIdx]
              if (!filter) return
              const id = filterIdFromUrl(filter.url)
              if (id) { setFilterIssues([]); setNextPageToken(null); loadFilter(id) }
            }}
          >↻</button>
        </div>

        {/* ── Filter dropdown ─────────────────────────────────────── */}
        {mode === 'filter' && (
          <div className="jira-filter-bar">
            {filters.length === 0 ? (
              <span className="config-hint-inline">No filters saved — add them in <strong>Settings → Jira</strong>.</span>
            ) : (
              <select
                className="jira-filter-select"
                value={selectedFilterIdx}
                onChange={e => setSelectedFilterIdx(Number(e.target.value))}
              >
                {filters.map((f, i) => (
                  <option key={i} value={i}>{f.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className={`issue-list${mode === 'filter' ? ' filter-view' : ''}`}>

          {/* ── Sprint view ─────────────────────────────────────────── */}
          {mode === 'sprint' && (
            <>
              {!sprintLoaded && <div className="loading-state">Loading…</div>}
              {sprintError === 'not_configured' && (
                <div className="config-hint">
                  Configure your Jira credentials in <strong>Settings</strong>.
                </div>
              )}
              {sprintError && sprintError !== 'not_configured' && (
                <div className="config-hint">Error: {sprintError}</div>
              )}
              {sprintLoaded && !sprintError && grouped.size === 0 && (
                <div className="loading-state">No issues in current sprint</div>
              )}
              {orderedKeys.map(key => {
                const group = grouped.get(key)
                if (!group) return null
                return (
                  <CollapsibleSection key={key} label={group.label} colorClass={`group-${key}`}>
                    {group.items.map(issue => (
                      <div
                        key={issue.key}
                        className="issue-row"
                        onClick={() => { window.tracker.markJiraSeen(issue.key); window.tracker.openUrl(issue.url) }}
                      >
                        <span className="jira-key">{issue.key}</span>
                        <span className="issue-title">{issue.title}</span>
                      </div>
                    ))}
                  </CollapsibleSection>
                )
              })}
            </>
          )}

          {/* ── Filter view ─────────────────────────────────────────── */}
          {mode === 'filter' && (
            <>
              {filterLoading && <div className="loading-state">Loading…</div>}
              {filterError === 'not_configured' && (
                <div className="config-hint">
                  Configure your Jira credentials in <strong>Settings</strong>.
                </div>
              )}
              {filterError && filterError !== 'not_configured' && (
                <div className="config-hint">Error: {filterError}</div>
              )}
              {!filterLoading && !filterError && filterIssues.length === 0 && filters.length > 0 && (
                <div className="loading-state">No issues found</div>
              )}
              {filterIssues.map(issue => (
                <div key={issue.key} className="issue-row">
                  <span className="jira-key">{issue.key}</span>
                  <button
                    className="issue-title issue-title-link"
                    onClick={() => { window.tracker.markJiraSeen(issue.key); window.tracker.openUrl(issue.url) }}
                  >
                    {issue.title}
                  </button>
                  {issue.assignee && (
                    <span className="jira-assignee">{issue.assignee}</span>
                  )}
                  <span className={`jira-status-badge status-${issue.status.toLowerCase().replace(/\s+/g, '-')}`}>
                    {issue.status}
                  </span>
                </div>
              ))}
              {nextPageToken && (
                <div className="load-more-row">
                  <button
                    className="load-more-btn"
                    onClick={handleLoadMore}
                    disabled={filterLoadingMore}
                  >
                    {filterLoadingMore ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
