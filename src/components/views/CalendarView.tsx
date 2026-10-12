import React, { useState, useEffect, useRef } from 'react'
import type { Todo, Meeting, HistoryDay } from '../../types/tracker'

const TODAY_STR = new Date().toLocaleDateString('en-CA')
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

interface Props {
  todos:      Todo[]
  notesData:  Record<string, string>
  calHistory: Record<string, HistoryDay>
  onHistoryLoaded: (h: Record<string, HistoryDay>) => void
}

type ICSCache = Record<string, Meeting[]>

export default function CalendarView({ todos, notesData, calHistory, onHistoryLoaded }: Props) {
  const now          = new Date()
  const [year,       setYear]       = useState(now.getFullYear())
  const [month,      setMonth]      = useState(now.getMonth())
  const [selected,   setSelected]   = useState<string | null>(TODAY_STR)
  const [weekMode,   setWeekMode]   = useState(true)
  const [weekAnchor, setWeekAnchor] = useState(() => {
    const d = new Date(now); d.setDate(d.getDate() - d.getDay())
    return d.toLocaleDateString('en-CA')
  })
  const [icsCache,   setIcsCache]   = useState<ICSCache>({})
  const [syncing,    setSyncing]    = useState(false)
  const [loadingICS, setLoadingICS] = useState(true)
  const fetchingRef  = useRef<string>('')

  async function fetchICSForMonth(y: number, m: number) {
    const first = new Date(y, m, 1)
    const last  = new Date(y, m + 1, 0)
    const start = new Date(first); start.setDate(start.getDate() - 7)
    const end   = new Date(last);  end.setDate(end.getDate() + 7)
    const startStr = start.toLocaleDateString('en-CA')
    const endStr   = end.toLocaleDateString('en-CA')
    const key = `${startStr}/${endStr}`
    if (fetchingRef.current === key) return
    fetchingRef.current = key
    setLoadingICS(true)
    try {
      const result = await window.tracker.fetchICSRange(startStr, endStr)
      setIcsCache(prev => ({ ...prev, ...result }))
    } finally {
      // Only clear if a newer fetch hasn't started in the meantime
      if (fetchingRef.current === key) setLoadingICS(false)
    }
  }

  useEffect(() => {
    fetchICSForMonth(year, month)
  }, [year, month])

  useEffect(() => {
    window.tracker.readHistory().then(h => onHistoryLoaded(h))
  }, [])

  async function resync() {
    setSyncing(true)
    fetchingRef.current = ''
    setIcsCache({})
    await fetchICSForMonth(year, month)
    setSyncing(false)
  }

  function prevNav() {
    if (weekMode) {
      const d = new Date(weekAnchor + 'T12:00:00')
      d.setDate(d.getDate() - 7)
      const anchor = d.toLocaleDateString('en-CA')
      setWeekAnchor(anchor)
      setYear(d.getFullYear()); setMonth(d.getMonth())
      fetchICSForMonth(d.getFullYear(), d.getMonth())
    } else {
      if (month === 0) { setYear(y => y - 1); setMonth(11) }
      else             { setMonth(m => m - 1) }
    }
  }

  function nextNav() {
    if (weekMode) {
      const d = new Date(weekAnchor + 'T12:00:00')
      d.setDate(d.getDate() + 7)
      const anchor = d.toLocaleDateString('en-CA')
      setWeekAnchor(anchor)
      setYear(d.getFullYear()); setMonth(d.getMonth())
      fetchICSForMonth(d.getFullYear(), d.getMonth())
    } else {
      if (month === 11) { setYear(y => y + 1); setMonth(0) }
      else              { setMonth(m => m + 1) }
    }
  }

  function toggleWeekMode() {
    if (!weekMode) {
      const anchor = selected || TODAY_STR
      const d = new Date(anchor + 'T12:00:00')
      d.setDate(d.getDate() - d.getDay())
      setWeekAnchor(d.toLocaleDateString('en-CA'))
    }
    setWeekMode(w => !w)
  }

  // Build grid cells
  let cells: Date[]
  let dowLabels: string[] = DOW

  if (weekMode && weekAnchor) {
    const ws = new Date(weekAnchor + 'T12:00:00')
    cells = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ws); d.setDate(ws.getDate() + i); return d
    })
    // In week mode, show date numbers as the header instead of day abbreviations
    dowLabels = cells.map(d => DOW[d.getDay()])
  } else {
    const firstDay  = new Date(year, month, 1)
    const startDate = new Date(firstDay)
    startDate.setDate(1 - firstDay.getDay())
    cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(startDate); d.setDate(startDate.getDate() + i); return d
    })
  }

  const monthLabel = weekMode && weekAnchor
    ? (() => {
        const ws = new Date(weekAnchor + 'T12:00:00')
        const we = new Date(ws); we.setDate(ws.getDate() + 6)
        return ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          + ' – ' + we.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      })()
    : new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const activeTodos = todos.filter(t => !['done', 'skipped'].includes(t.status))

  return (
    <div id="view-calendar" className="view">
      <div className="view-card">
      <div className="cal-grid-pane">

        <div className="cal-nav">
          <div className="cal-nav-controls">
            <button className="cal-arrow" onClick={prevNav}>‹</button>
            <span className="cal-month-label">{monthLabel}</span>
            <button className="cal-arrow" onClick={nextNav}>›</button>
          </div>
          <button
            className={`cal-view-toggle${weekMode ? ' week-active' : ''}`}
            onClick={toggleWeekMode}
          >
            {weekMode ? 'Month' : 'Week'}
          </button>
        </div>

        <div className="cal-dow-row">
          {dowLabels.map((d, i) => <span key={i}>{d}</span>)}
        </div>

        <div className={`cal-grid${weekMode ? ' cal-grid-week' : ''}`}>
          {cells.map((d, i) => {
            const dStr         = d.toLocaleDateString('en-CA')
            const isToday      = dStr === TODAY_STR
            const isThisMonth  = d.getMonth() === month
            const isWeekend    = d.getDay() === 0 || d.getDay() === 6
            const isSel        = dStr === selected
            const hist         = calHistory[dStr]
            const meetings     = icsCache[dStr] || []
            const hasCompleted = (hist?.completed?.length ?? 0) > 0
            const hasMeetings  = meetings.length > 0 || (hist?.meetings?.length ?? 0) > 0
            const hasPending   = isToday && activeTodos.length > 0

            return (
              <div
                key={i}
                className={[
                  'cal-day',
                  (!isThisMonth && !weekMode) ? 'other-month' : '',
                  isWeekend  ? 'weekend'  : '',
                  isToday    ? 'is-today' : '',
                  isSel      ? 'selected' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setSelected(dStr)}
              >
                <div className="cal-day-num">{d.getDate()}</div>
                {(hasCompleted || hasMeetings || hasPending) && (
                  <div className="cal-dots">
                    {hasCompleted && <div className="cal-dot dot-teal" />}
                    {hasMeetings  && <div className="cal-dot dot-lavender" />}
                    {hasPending   && <div className="cal-dot dot-pink" />}
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>

      {selected && (
        <DayDetail
          dStr={selected}
          todos={todos}
          notesData={notesData}
          calHistory={calHistory}
          icsCache={icsCache}
          currentMonth={month}
          onResync={resync}
          syncing={syncing}
          loading={loadingICS}
        />
      )}
      </div>
    </div>
  )
}

function DayDetail({
  dStr, todos, notesData, calHistory, icsCache, onResync, syncing, loading,
}: {
  dStr:         string
  todos:        Todo[]
  notesData:    Record<string, string>
  calHistory:   Record<string, HistoryDay>
  icsCache:     ICSCache
  currentMonth: number
  onResync:     () => void
  syncing:      boolean
  loading:      boolean
}) {
  const d         = new Date(dStr + 'T12:00:00')
  const label     = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const isPast    = dStr < TODAY_STR
  const isToday   = dStr === TODAY_STR
  const isFuture  = dStr > TODAY_STR
  const isWeekend = d.getDay() === 0 || d.getDay() === 6

  const hist         = calHistory[dStr]
  const completed    = hist?.completed || []
  const histMeetings = hist?.meetings  || []
  const icsMeetings  = icsCache[dStr]  || []
  const meetings     = icsMeetings.length > 0 ? icsMeetings : histMeetings
  const noteText     = notesData[dStr]

  const doneTodayItems = isToday ? todos.filter(t => t.status === 'done') : completed
  const activeTodos    = isToday ? todos.filter(t => !['done', 'skipped'].includes(t.status)) : []

  if (isWeekend && !completed.length && !meetings.length) {
    return (
      <div className="cal-detail">
        <div className="cal-detail-header">
          <div className="cal-detail-date">{label}</div>
          <button className={`refresh-btn${syncing ? ' spinning' : ''}`} onClick={onResync} title="Resync calendars">↻</button>
        </div>
        <div className="cal-none">Enjoy your weekend slut!</div>
      </div>
    )
  }

  return (
    <div className="cal-detail">
      <div className="cal-detail-header">
        <div className="cal-detail-date">{label}</div>
        <button className={`refresh-btn${syncing ? ' spinning' : ''}`} onClick={onResync} title="Resync calendars">↻</button>
      </div>

      {(isPast || isToday) && (
        <>
          <div className="cal-section-title">{isToday ? 'Done today' : 'Completed'}</div>
          {doneTodayItems.length === 0 ? (
            <div className="cal-none">{isPast ? 'Nothing completed' : 'Nothing done yet'}</div>
          ) : doneTodayItems.map((item, i) => (
            <div key={i} className="cal-row">
              <span className="cal-row-icon">✅</span>
              <span>{item.title}</span>
            </div>
          ))}
        </>
      )}

      {meetings.length > 0 ? (
        <>
          <div className="cal-section-title">Meetings</div>
          {meetings.map((m, i) => (
            <div key={i} className="cal-row">
              <span className="cal-row-icon">📅</span>
              <span className="cal-row-summary">{m.summary}</span>
              <div className="cal-row-right">
                <span className="cal-row-time">{m.timeStr || ''}</span>
                {m.meetUrl && (
                  <button className="cal-join-btn" onClick={() => window.tracker.openUrl(m.meetUrl!)}>Join ↗</button>
                )}
              </div>
            </div>
          ))}
        </>
      ) : isToday && loading ? (
        <>
          <div className="cal-section-title">Meetings</div>
          <div className="cal-none">Loading meetings…</div>
        </>
      ) : isFuture && !isWeekend ? (
        <>
          <div className="cal-section-title">Meetings</div>
          <div className="cal-none">No meetings</div>
        </>
      ) : null}

      {isToday && activeTodos.length > 0 && (
        <>
          <div className="cal-section-title">Still in progress</div>
          {activeTodos.map((item, i) => (
            <div key={i} className="cal-row">
              <span className="cal-row-icon">☐</span>
              <span>{item.title}</span>
            </div>
          ))}
        </>
      )}

      {noteText && (
        <>
          <div className="cal-section-title">Notes</div>
          <div className="cal-notes-text">{noteText}</div>
        </>
      )}
    </div>
  )
}
