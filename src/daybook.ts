export const DEFAULT_DAYBOOK_TEMPLATE = `## One thing I worked on


## One thing I learned or struggled with


## One thing I'll tackle tomorrow

`

// Hand-picked end-of-workday GIFs from GIPHY, one shown at random under the editor
export const WORKDAY_GIFS: { id: string; label: string }[] = [
  { id: '3o6wNTpBB9jap7UjK0', label: 'SpongeBob clocking out' },
  { id: 'FK5wchaRo1qUM',      label: 'Off the clock' },
  { id: 'l1AsGvHmkmJtvLPgY', label: 'SpongeBob leaving work' },
  { id: '7DzlajZNY5D0I',      label: 'SpongeBob finger guns backing out' },
  { id: 'l3q2JdGcDC7agGz16', label: 'Vintage dinosaur' },
  { id: '7zuzoS2MJ6ESMhqCR0', label: "Friday I'm free" },
  { id: '0DsScTDpSJSvetGFU1', label: 'Closing time' },
  { id: 'beBy7w1gklos0',      label: "George Costanza: I'm out" },
  { id: 'klAhszJ8Ht9XG0k3Bt', label: "Schitt's Creek: leaving" },
  { id: 'wdPUPikG3lEr2hqXMb', label: 'Ready for the weekend' },
  { id: '229JJf0rG2wZKAoMhT', label: "Schitt's Creek: goodbye" },
  { id: '188pTFRu3nHDxbNVhz', label: "It's over" },
  { id: '8J5SqqfG8V2ByhQljK', label: 'Pokémon: tired at the end of the day' },
  { id: '3V2lZUbiy2DR4myM3R', label: 'Going home cat' },
  { id: 'DHffwPMJIgKAc0v6Av', label: "Log off, I'm out of here" },
  { id: '8buM8ZQ9naxQptpCmM', label: 'Leaving, see ya' },
  { id: '1Rh1547MPKEEDpN3P9', label: 'Over it, goodbye' },
  { id: 'XqoisoDHmDYFauS2FR', label: "The Office: I'm out" },
  { id: '679Ds2xxxKiDvxe4y4', label: 'Unwinding, coming home' },
  { id: '3ogwFIeUXV57hw3XJC', label: 'SpongeBob heading home' },
  { id: 'ILgtIcrpEeKU8',      label: 'Go home' },
  { id: 'Wq43BlCpeeoUFL0al2', label: "Bob's Burgers: time to go home" },
  { id: 'rXVVRYt2W7wi9y5eoB', label: 'Happy hour' },
]

// Shown instead of the editor on Saturdays and Sundays
export const WEEKEND_GIFS: { id: string; label: string }[] = [
  { id: 'W2b8JkhIwnVH7Sr1zl', label: 'Stretching cat' },
  { id: 'W1NfXXbHHGK0F8A8MC', label: 'Happy dance' },
  { id: 'lqFY9hBTLX7os',      label: 'The weekend' },
  { id: 'Kx2x4ioSvnh8katw16', label: 'Have a relaxing weekend' },
  { id: 'FQLKJKMUrGxU3iRRVb', label: 'Friday weekend' },
  { id: 'Q7FBUo2cYjPOiWEXtY', label: 'Ready for the weekend dance' },
]

export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

export function isWeekend(dateStr: string) {
  const day = new Date(dateStr + 'T12:00:00').getDay()
  return day === 0 || day === 6
}

// Animated WebP, about half the size of the .gif. 'small' is GIPHY's 200px-tall
// rendition for the strip under the editor; 'full' is the original for the weekend screen.
export function giphyUrl(id: string, size: 'small' | 'full' = 'small') {
  return `https://media.giphy.com/media/${id}/${size === 'small' ? '200' : 'giphy'}.webp`
}

export async function loadDaybookTemplate(): Promise<string> {
  const saved = await window.tracker.getSetting('daybook_template')
  return saved ?? DEFAULT_DAYBOOK_TEMPLATE
}

// Drop the template's own lines (the questions) so search only matches what was written.
export function stripTemplate(text: string, template: string) {
  const prompts = new Set(template.split('\n').map(l => l.trim()).filter(Boolean))
  return text.split('\n').filter(l => !prompts.has(l.trim())).join('\n').trim()
}
