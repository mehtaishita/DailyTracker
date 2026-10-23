export const DEFAULT_DAYBOOK_TEMPLATE = `## One thing I worked on


## One thing I learned or struggled with


## One thing I'll tackle tomorrow

`

export async function loadDaybookTemplate(): Promise<string> {
  const saved = await window.tracker.getSetting('daybook_template')
  return saved ?? DEFAULT_DAYBOOK_TEMPLATE
}

// Drop the template's own lines (the questions) so search only matches what was written.
export function stripTemplate(text: string, template: string) {
  const prompts = new Set(template.split('\n').map(l => l.trim()).filter(Boolean))
  return text.split('\n').filter(l => !prompts.has(l.trim())).join('\n').trim()
}
