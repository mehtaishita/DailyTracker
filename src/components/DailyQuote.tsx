import React, { useState, useEffect } from 'react'
import type { DailyQuote as Quote } from '../types/tracker'

// Milliseconds until the next local midnight, when the quote should roll over
function msUntilMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime()
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; quote: Quote }

// libquotes.com's Quote of the Day, fetched by the main process (see quote-service.js)
export default function DailyQuote() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function load() {
      try {
        const res = await window.tracker.fetchDailyQuote()
        if (cancelled) return
        if (res.quote) {
          setState({ status: 'ready', quote: res.quote })
        } else {
          console.error('[DailyQuote] fetch failed:', res.error)
          setState({ status: 'error' })
        }
      } catch (e) {
        if (cancelled) return
        console.error('[DailyQuote] fetch failed:', e)
        setState({ status: 'error' })
      }
      timer = setTimeout(load, msUntilMidnight() + 1000)   // refresh once the day rolls over
    }

    load()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  if (state.status !== 'ready') {
    return (
      <div className="daily-quote daily-quote-muted">
        {state.status === 'loading' ? 'Loading…' : "Couldn't load today's quote"}
      </div>
    )
  }

  const { quote } = state
  const authorUrl = quote.authorUrl

  return (
    <figure className="daily-quote">
      <blockquote className="daily-quote-text">{quote.text}</blockquote>
      <figcaption className="daily-quote-attr">
        {authorUrl
          ? <a href={authorUrl} onClick={e => { e.preventDefault(); window.tracker.openUrl(authorUrl) }}>{quote.author}</a>
          : quote.author}
        {' · '}libquotes.com
      </figcaption>
    </figure>
  )
}
