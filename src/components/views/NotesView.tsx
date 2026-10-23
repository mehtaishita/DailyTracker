import React, { useState, useEffect, useRef } from 'react'
import { loadDaybookTemplate, stripTemplate, WORKDAY_GIFS, WEEKEND_GIFS, pickRandom, isWeekend, giphyUrl } from '../../daybook'

const TODAY_STR = new Date().toLocaleDateString('en-CA')

interface Props {
  notesData:      Record<string, string>
  onUpdateNote:   (date: string, text: string) => void
}

function getSnippet(text: string, query: string, maxLen = 120) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '')
  const start = Math.max(0, idx - 40)
  const end   = Math.min(text.length, idx + query.length + 80)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

function dateLabel(dStr: string) {
  const d = new Date(dStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function NotesView({ notesData, onUpdateNote }: Props) {
  const [notesDate,  setNotesDate]  = useState(TODAY_STR)
  const [textValue,  setTextValue]  = useState('')
  const [query,      setQuery]      = useState('')
  const [template,   setTemplate]   = useState<string | null>(null)
  const [gif]                       = useState(() => pickRandom(WORKDAY_GIFS))
  const [weekendGif]                = useState(() => pickRandom(WEEKEND_GIFS))
  const [gifFailed,  setGifFailed]  = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { loadDaybookTemplate().then(setTemplate) }, [])

  // Sync textarea to notesDate; days without a note start from the template
  useEffect(() => {
    if (template === null) return
    setTextValue(notesData[notesDate] || template)
  }, [notesDate, notesData, template])

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const cleaned = e.target.value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    setTextValue(cleaned)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    // An untouched template isn't a note, so it saves as empty (no file)
    const toSave = cleaned === template ? '' : cleaned
    saveTimerRef.current = setTimeout(async () => {
      onUpdateNote(notesDate, toSave)
      await window.tracker.writeNote(notesDate, toSave)
    }, 700)
  }

  function navDate(delta: number) {
    const d = new Date(notesDate + 'T12:00:00')
    d.setDate(d.getDate() + delta)
    setNotesDate(d.toLocaleDateString('en-CA'))
  }

  const matches = query
    ? Object.entries(notesData)
        .map(([d, t]) => [d, stripTemplate(t, template || '')] as [string, string])
        .filter(([, t]) => t.toLowerCase().includes(query.toLowerCase()))
        .sort(([a], [b]) => b.localeCompare(a))
    : []

  const showSearch = query.length > 0

  return (
    <div id="view-notes" className="view">
      <div className="view-card">
      <div className="notes-search-wrap">
        <span className="notes-search-icon">⌕</span>
        <input
          className="notes-search-input"
          type="text"
          placeholder="Search daybook…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button className="notes-search-clear" onClick={() => setQuery('')}>×</button>
        )}
      </div>

      {!showSearch && (
        <div id="notes-editor">
          <div className="tab-toolbar">
            <button className="cal-arrow" onClick={() => navDate(-1)}>‹</button>
            <span className="notes-tab-date">{dateLabel(notesDate)}</span>
            <button className="cal-arrow" onClick={() => navDate(1)}>›</button>
          </div>
          {isWeekend(notesDate) ? (
            <div className="daybook-weekend">
              <div className="daybook-weekend-caption">Enjoy your weekend slut</div>
              <img src={giphyUrl(weekendGif.id, 'full')} alt={weekendGif.label} />
            </div>
          ) : <>
            <textarea
              className="notes-textarea"
              placeholder="Write today's entry…"
              value={textValue}
              onChange={onInput}
              spellCheck={true}
            />
            {!gifFailed && (
              <div className="daybook-gif">
                <img src={giphyUrl(gif.id)} alt={gif.label} title={gif.label} onError={() => setGifFailed(true)} />
              </div>
            )}
          </>}
        </div>
      )}

      {showSearch && (
        <div className="notes-search-results" style={{ display: 'block' }}>
          {matches.length === 0 ? (
            <div className="notes-search-empty">No entries match your search</div>
          ) : matches.map(([dStr, text]) => (
            <div
              key={dStr}
              className="notes-result-row"
              onClick={() => { setQuery(''); setNotesDate(dStr) }}
            >
              <div className="notes-result-date">{dateLabel(dStr)}</div>
              <div className="notes-result-snippet">{getSnippet(text, query)}</div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
