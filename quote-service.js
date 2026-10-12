/**
 * Daily quote — fetches libquotes.com's "Quote of the Day" widget and extracts the quote.
 * Required directly by main.js (not forked like the GitHub/Sentry services).
 *
 * The widget is a document.writeln script meant for a <script> tag on a web page:
 *   var libq=document;libq.writeln("<b>Quote of the Day</b><br><br>");
 *   libq.writeln("Professional men, they have no cares; Whatever happens, they get theirs.<br>");
 *   libq.writeln("<a href=\"https://libquotes.com/ogden-nash\" target=\"_blank\" rel=\"nofollow\">Ogden Nash</a><br><br>");
 * The renderer can't document.write after load and shouldn't execute remote JS, so we fetch the
 * script text here and pull the quote and author out of what it would have written.
 */
const http  = require('http')
const https = require('https')

const WIDGET_URL = 'https://libquotes.com/widget/qotd.js?qt=1'
const USER_AGENT = 'daily-tracker/1.0 (personal use)'

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', ndash: '–', mdash: '—',
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex)  => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g,         (_, dec)  => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi,      (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

// Undo the escaping inside a double-quoted JS string literal
function unescapeJsString(s) {
  const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, esc) => {
    if (esc[0] === 'u' || esc[0] === 'x') return String.fromCharCode(parseInt(esc.slice(1), 16))
    return simple[esc] ?? esc
  })
}

// Strip tags, decode entities, collapse whitespace
function textOf(html) {
  const noTags = html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim()
}

// Returns { text, author, authorUrl } or null when the script doesn't look like the widget
function parseQotdWidget(script) {
  const parts = [...script.matchAll(/writeln\("((?:[^"\\]|\\.)*)"\)/g)].map(m => unescapeJsString(m[1]))
  if (parts.length === 0) return null

  const html   = parts.join('').replace(/<b>\s*Quote of the Day\s*<\/b>/i, '')
  const anchor = html.match(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
  const text   = textOf(anchor ? html.slice(0, anchor.index) : html)
  if (!text) return null

  const author    = anchor ? textOf(anchor[2]) : ''
  const authorUrl = anchor && /^https:\/\/libquotes\.com\//.test(anchor[1]) ? anchor[1] : null
  return { text, author, authorUrl }
}

// GET a URL as text; null on any failure. Follows up to 3 redirects, 10s timeout.
function getText(url, redirects = 0) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirects < 3) {
        res.resume()
        getText(new URL(res.headers.location, url).href, redirects + 1).then(resolve)
        return
      }
      if (res.statusCode !== 200) { res.resume(); resolve(null); return }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
    })
    req.on('error', () => resolve(null))
    req.setTimeout(10000, () => { req.destroy(); resolve(null) })
  })
}

function localDay(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// One fetch per local day. The CDN caches the script for weeks, so the date param asks for today's copy.
const cache = { day: null, quote: null }

async function fetchDailyQuote() {
  const day = localDay()
  if (cache.day === day && cache.quote) return { quote: cache.quote }

  const script = await getText(`${WIDGET_URL}&_=${day}`)
  if (script === null) return { error: 'network' }

  const quote = parseQotdWidget(script)
  if (!quote) return { error: 'parse' }

  cache.day   = day
  cache.quote = quote
  return { quote }
}

module.exports = { fetchDailyQuote, parseQotdWidget, WIDGET_URL }
