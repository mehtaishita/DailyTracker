import React, { useState, useEffect } from 'react'
import type { AlertMode, ThemeId, SentryPreset, SentrySkill, JiraFilter } from '../../types/tracker'

interface IcsCalendar {
  url:      string
  nickname: string
}

interface Props {
  alertMode:         AlertMode
  onAlertModeChange: (mode: AlertMode) => void
  theme:             ThemeId
  onThemeChange:     (t: ThemeId) => void
}

const THEMES: { id: ThemeId; label: string; swatches: string[] }[] = [
  { id: 'default',    label: 'Default',      swatches: ['#2a2245', '#4dd9d0', '#f472b6', '#c4b5fd'] },
  { id: 'coastal',    label: 'Coastal',      swatches: ['#031624', '#7bbfe0', '#ff7744', '#44dd80'] },
  { id: 'pan-yellow', label: 'Pan · Yellow', swatches: ['#fffbe6', '#FF218C', '#FFD800', '#21B1FF'] },
  { id: 'pan-glass',  label: 'Pan · Glass',  swatches: ['#3d5f63', '#FF218C', '#FFD800', '#21B1FF'] },
]

type SettingsTab = 'github' | 'jira' | 'sentry' | 'appearance' | 'calendars'

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'github',     label: 'GitHub' },
  { id: 'jira',       label: 'Jira'            },
  { id: 'sentry',     label: 'Sentry'          },
  { id: 'appearance', label: 'Display' },
  { id: 'calendars',  label: 'Calendars'       },
]

export default function SettingsView({ alertMode, onAlertModeChange, theme, onThemeChange }: Props) {
  const [activeTab,        setActiveTab]        = useState<SettingsTab>('github')
  const [calendars,        setCalendars]        = useState<IcsCalendar[]>([])
  const [newUrl,           setNewUrl]           = useState('')
  const [newNick,          setNewNick]          = useState('')
  const [repos,            setRepos]            = useState<string[]>([])
  const [newRepo,          setNewRepo]          = useState('')
  const [sentryProjects,      setSentryProjects]      = useState<string[]>([])
  const [newSentryProject,    setNewSentryProject]    = useState('')
  const [sentryPresets,       setSentryPresets]       = useState<SentryPreset[]>([])
  const [sentryDefaultPreset, setSentryDefaultPreset] = useState('')
  const [newPresetName,       setNewPresetName]       = useState('')
  const [newPresetFlags,      setNewPresetFlags]      = useState('')
  const [sentrySkills,        setSentrySkills]        = useState<SentrySkill[]>([])
  const [newSkillName,        setNewSkillName]        = useState('')
  const [newSkillCommand,     setNewSkillCommand]     = useState('')
  const [jiraDomain,       setJiraDomain]       = useState('')
  const [jiraEmail,        setJiraEmail]        = useState('')
  const [jiraToken,        setJiraToken]        = useState('')
  const [jiraProjectKey,   setJiraProjectKey]   = useState('')
  const [jiraSaved,        setJiraSaved]        = useState(false)
  const [jiraSaveFlash,    setJiraSaveFlash]    = useState(false)
  const [jiraFilters,      setJiraFilters]      = useState<JiraFilter[]>([])
  const [newFilterName,    setNewFilterName]    = useState('')
  const [newFilterUrl,     setNewFilterUrl]     = useState('')
  const [editingFilterIdx, setEditingFilterIdx] = useState<number | null>(null)
  const [editFilterName,   setEditFilterName]   = useState('')
  const [editFilterUrl,    setEditFilterUrl]    = useState('')
  const [reviewSkill,      setReviewSkill]      = useState('')
  const [skillSaved,       setSkillSaved]       = useState(false)

  useEffect(() => {
    window.tracker.getSetting('ics_calendars').then(async v => {
      if (v) {
        try { setCalendars(JSON.parse(v)) } catch {}
      } else {
        const legacy = await window.tracker.getSetting('ics_url')
        if (legacy) {
          const migrated = [{ url: legacy, nickname: 'Calendar' }]
          setCalendars(migrated)
          await window.tracker.setSetting('ics_calendars', JSON.stringify(migrated))
        }
      }
    })
    Promise.all([
      window.tracker.getSetting('jira_domain'),
      window.tracker.getSetting('jira_email'),
      window.tracker.getSetting('jira_api_token'),
      window.tracker.getSetting('jira_project_key'),
    ]).then(([d, e, t, p]) => {
      if (d) { setJiraDomain(d); setJiraSaved(true) }
      if (e) setJiraEmail(e)
      if (t) setJiraToken(t)
      if (p) setJiraProjectKey(p)
    })
    window.tracker.getSetting('jira_filters').then(v => {
      if (!v) return
      try {
        const parsed = JSON.parse(v)
        if (Array.isArray(parsed)) setJiraFilters(parsed)
      } catch {}
    })
    window.tracker.getSetting('review_skill').then(v => {
      if (v) { setReviewSkill(v); setSkillSaved(true) }
    })
    window.tracker.getSetting('sentry_projects').then(v => {
      if (!v) return
      try {
        const parsed = JSON.parse(v)
        if (Array.isArray(parsed)) { setSentryProjects(parsed); return }
      } catch {}
    })
    window.tracker.getSetting('sentry_presets').then(v => {
      if (!v) return
      try {
        const parsed = JSON.parse(v)
        if (Array.isArray(parsed)) setSentryPresets(parsed)
      } catch {}
    })
    window.tracker.getSetting('sentry_default_preset').then(v => {
      if (v) setSentryDefaultPreset(v)
    })
    Promise.all([
      window.tracker.getSetting('sentry_claude_skills'),
      window.tracker.getSetting('sentry_claude_skill'),
    ]).then(([skillsRaw, oldSkill]) => {
      let skills: SentrySkill[] = []
      try { if (skillsRaw) skills = JSON.parse(skillsRaw) } catch {}
      if (skills.length === 0 && oldSkill) skills = [{ name: oldSkill, command: oldSkill }]
      setSentrySkills(skills)
    })
    window.tracker.getSetting('github_repos').then(v => {
      if (!v) return
      try {
        const parsed = JSON.parse(v)
        if (Array.isArray(parsed)) { setRepos(parsed); return }
      } catch {}
      const migrated = v.split(',').map((s: string) => s.trim()).filter(Boolean)
      setRepos(migrated)
      window.tracker.setSetting('github_repos', JSON.stringify(migrated))
    })
  }, [])

  // ── Calendar handlers ────────────────────────────────────────────────────
  async function addCalendar() {
    const url  = newUrl.trim()
    const nick = newNick.trim() || 'Calendar'
    if (!url || !/^https?:\/\//i.test(url)) {
      alert('Invalid URL — must start with https://')
      return
    }
    const next = [...calendars, { url, nickname: nick }]
    setCalendars(next)
    setNewUrl('')
    setNewNick('')
    await window.tracker.setSetting('ics_calendars', JSON.stringify(next))
  }

  async function removeCalendar(idx: number) {
    const next = calendars.filter((_, i) => i !== idx)
    setCalendars(next)
    await window.tracker.setSetting('ics_calendars', JSON.stringify(next))
  }

  function handleCalKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') addCalendar()
  }

  // ── GitHub handlers ──────────────────────────────────────────────────────
  async function addRepo() {
    const val = newRepo.trim()
    if (!val || !/^[^/]+\/[^/]+$/.test(val)) {
      alert('Enter a repo in owner/repo format')
      return
    }
    if (repos.includes(val)) { setNewRepo(''); return }
    const next = [...repos, val]
    setRepos(next)
    setNewRepo('')
    await window.tracker.setSetting('github_repos', JSON.stringify(next))
  }

  async function removeRepo(idx: number) {
    const next = repos.filter((_, i) => i !== idx)
    setRepos(next)
    await window.tracker.setSetting('github_repos', JSON.stringify(next))
  }

  function handleRepoKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') addRepo()
  }

  // ── Sentry handlers ──────────────────────────────────────────────────────
  async function addSentryProject() {
    const val = newSentryProject.trim()
    if (!val || !/^[^/]+\/[^/]+$/.test(val)) {
      alert('Enter a project in org/project format')
      return
    }
    if (sentryProjects.includes(val)) { setNewSentryProject(''); return }
    const next = [...sentryProjects, val]
    setSentryProjects(next)
    setNewSentryProject('')
    await window.tracker.setSetting('sentry_projects', JSON.stringify(next))
  }

  async function removeSentryProject(idx: number) {
    const next = sentryProjects.filter((_, i) => i !== idx)
    setSentryProjects(next)
    await window.tracker.setSetting('sentry_projects', JSON.stringify(next))
  }

  function handleSentryKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') addSentryProject()
  }

  async function addSentryPreset() {
    const name  = newPresetName.trim()
    const flags = newPresetFlags.trim()
    if (!name)  { alert('Enter a preset name'); return }
    if (!flags) { alert('Enter a flags string'); return }
    if (sentryPresets.some(p => p.name === name)) { alert('A preset with that name already exists'); return }
    const next = [...sentryPresets, { name, flags }]
    setSentryPresets(next)
    setNewPresetName('')
    setNewPresetFlags('')
    await window.tracker.setSetting('sentry_presets', JSON.stringify(next))
    // auto-select as default if it's the first preset
    if (next.length === 1) {
      setSentryDefaultPreset(name)
      await window.tracker.setSetting('sentry_default_preset', name)
    }
  }

  async function removeSentryPreset(name: string) {
    const next = sentryPresets.filter(p => p.name !== name)
    setSentryPresets(next)
    await window.tracker.setSetting('sentry_presets', JSON.stringify(next))
    if (sentryDefaultPreset === name) {
      const newDefault = next[0]?.name || ''
      setSentryDefaultPreset(newDefault)
      await window.tracker.setSetting('sentry_default_preset', newDefault)
    }
  }

  async function setSentryDefault(name: string) {
    setSentryDefaultPreset(name)
    await window.tracker.setSetting('sentry_default_preset', name)
  }

  async function addSentrySkill() {
    const name    = newSkillName.trim()
    const command = newSkillCommand.trim()
    if (!name || !command) return
    const next = [...sentrySkills, { name, command }]
    setSentrySkills(next)
    setNewSkillName('')
    setNewSkillCommand('')
    await window.tracker.setSetting('sentry_claude_skills', JSON.stringify(next))
  }

  async function removeSentrySkill(name: string) {
    const next = sentrySkills.filter(s => s.name !== name)
    setSentrySkills(next)
    await window.tracker.setSetting('sentry_claude_skills', JSON.stringify(next))
  }

  // ── Jira filter handlers ────────────────────────────────────────────────
  async function addJiraFilter() {
    const name = newFilterName.trim()
    const url  = newFilterUrl.trim()
    if (!name) { alert('Enter a filter name'); return }
    if (!url || !/^https?:\/\/.+[?&]filter=\d+/.test(url)) {
      alert('Enter a valid filter URL (e.g. https://company.atlassian.net/issues?filter=12345)')
      return
    }
    if (jiraFilters.some(f => f.name === name)) { alert('A filter with that name already exists'); return }
    const next = [...jiraFilters, { name, url }]
    setJiraFilters(next)
    setNewFilterName('')
    setNewFilterUrl('')
    await window.tracker.setSetting('jira_filters', JSON.stringify(next))
  }

  async function removeJiraFilter(idx: number) {
    const next = jiraFilters.filter((_, i) => i !== idx)
    setJiraFilters(next)
    await window.tracker.setSetting('jira_filters', JSON.stringify(next))
  }

  function startEditJiraFilter(idx: number) {
    setEditingFilterIdx(idx)
    setEditFilterName(jiraFilters[idx].name)
    setEditFilterUrl(jiraFilters[idx].url)
  }

  async function saveEditJiraFilter(idx: number) {
    const name = editFilterName.trim()
    const url  = editFilterUrl.trim()
    if (!name) { alert('Enter a filter name'); return }
    if (!url || !/^https?:\/\/.+[?&]filter=\d+/.test(url)) {
      alert('Enter a valid filter URL (e.g. https://company.atlassian.net/issues?filter=12345)')
      return
    }
    const next = jiraFilters.map((f, i) => i === idx ? { name, url } : f)
    setJiraFilters(next)
    setEditingFilterIdx(null)
    await window.tracker.setSetting('jira_filters', JSON.stringify(next))
  }

  function cancelEditJiraFilter() {
    setEditingFilterIdx(null)
  }

  // ── Jira / Claude handlers ───────────────────────────────────────────────
  async function saveSkill() {
    const val = reviewSkill.trim()
    await window.tracker.setSetting('review_skill', val)
    setSkillSaved(!!val)
  }

  async function saveJira() {
    await Promise.all([
      window.tracker.setSetting('jira_domain',      jiraDomain.trim()),
      window.tracker.setSetting('jira_email',       jiraEmail.trim()),
      window.tracker.setSetting('jira_api_token',   jiraToken.trim()),
      window.tracker.setSetting('jira_project_key', jiraProjectKey.trim()),
    ])
    setJiraSaved(true)
    setJiraSaveFlash(true)
    setTimeout(() => setJiraSaveFlash(false), 2000)
  }

  return (
    <div id="view-settings" className="view">
      <div className="view-card">

        <div className="settings-inner-tabs">
          {SETTINGS_TABS.map(t => (
            <button
              key={t.id}
              className={`settings-inner-tab${activeTab === t.id ? ' active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-scroll">

          {/* ── GitHub & Claude ── */}
          {activeTab === 'github' && <>
            <div className="settings-section">
              <div className="settings-section-title">GitHub</div>
              <div className="settings-row">
                <label className="settings-label">Watched Repos</label>
                <div className="settings-ics-add">
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="owner/repo"
                    value={newRepo}
                    onChange={e => setNewRepo(e.target.value)}
                    onKeyDown={handleRepoKeyDown}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="settings-save-btn" onClick={addRepo}>Add</button>
                </div>
                {repos.length > 0 && (
                  <div className="settings-cal-badges">
                    {repos.map((repo, i) => (
                      <span key={i} className="settings-cal-badge">
                        {repo}
                        <button onClick={() => removeRepo(i)} aria-label={`Remove ${repo}`}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="settings-hint">
                GitHub access is handled by the <code>gh</code> CLI. Run <code>gh auth login</code> in your terminal to authenticate.
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Claude</div>
              <div className="settings-row">
                <label className="settings-label">Review skill</label>
                <div className="settings-input-row">
                  <input
                    className={`settings-input${skillSaved ? ' saved' : ''}`}
                    type="text"
                    placeholder="/your-review-skill"
                    value={reviewSkill}
                    onChange={e => { setReviewSkill(e.target.value); setSkillSaved(false) }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="settings-save-btn" onClick={saveSkill}>Save</button>
                </div>
                <div className="settings-hint">
                  When you trigger a PR review, the app fetches the git diff and passes it to this Claude Code skill for analysis.
                </div>
              </div>
            </div>
          </>}

          {/* ── Jira ── */}
          {activeTab === 'jira' && <>
            <div className="settings-section">
              <div className="settings-section-title">Jira</div>
              <div className="settings-row">
                <div className="settings-jira-fields">
                  <div className="settings-jira-field">
                    <label className="settings-label">Domain</label>
                    <input
                      className={`settings-input${jiraSaved && jiraDomain ? ' saved' : ''}`}
                      type="text"
                      placeholder="yourcompany.atlassian.net"
                      value={jiraDomain}
                      onChange={e => { setJiraDomain(e.target.value); setJiraSaved(false) }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <div className="settings-jira-field">
                    <label className="settings-label">Email</label>
                    <input
                      className="settings-input"
                      type="email"
                      placeholder="you@company.com"
                      value={jiraEmail}
                      onChange={e => { setJiraEmail(e.target.value); setJiraSaved(false) }}
                      autoComplete="off"
                    />
                  </div>
                  <div className="settings-jira-field">
                    <label className="settings-label">API Token</label>
                    <input
                      className="settings-input"
                      type="password"
                      placeholder="••••••••••••"
                      value={jiraToken}
                      onChange={e => { setJiraToken(e.target.value); setJiraSaved(false) }}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="settings-jira-field">
                    <label className="settings-label">Project key</label>
                    <input
                      className="settings-input"
                      type="text"
                      placeholder="PROJ"
                      value={jiraProjectKey}
                      onChange={e => { setJiraProjectKey(e.target.value.toUpperCase()); setJiraSaved(false) }}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div className="settings-jira-save-row">
                  <button className="settings-save-btn settings-save-jira" onClick={saveJira}>
                    {jiraSaveFlash ? 'Saved!' : 'Save'}
                  </button>
                  {jiraSaved && jiraProjectKey && (
                    <span className="jira-project-badge">{jiraProjectKey}</span>
                  )}
                </div>
                <div className="settings-hint">
                  Create a token at <strong>id.atlassian.com → Security → API tokens</strong>.
                </div>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Saved Filters</div>
              <div className="settings-hint" style={{ marginBottom: 10 }}>
                Add Jira filter URLs to use in the Filters view on the Jira tab.
              </div>

              {jiraFilters.length > 0 && (
                <div className="sentry-preset-list">
                  {jiraFilters.map((filter, i) =>
                    editingFilterIdx === i ? (
                      <div key={i} className="sentry-preset-row jira-filter-editing">
                        <div className="jira-filter-edit-fields">
                          <input
                            className="settings-input"
                            type="text"
                            value={editFilterName}
                            onChange={e => setEditFilterName(e.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <input
                            className="settings-input"
                            type="text"
                            value={editFilterUrl}
                            onChange={e => setEditFilterUrl(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveEditJiraFilter(i) }}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </div>
                        <button className="settings-save-btn" onClick={() => saveEditJiraFilter(i)}>Save</button>
                        <button className="sentry-preset-remove" onClick={cancelEditJiraFilter} aria-label="Cancel edit">✕</button>
                      </div>
                    ) : (
                      <div key={i} className="sentry-preset-row">
                        <div className="sentry-preset-info">
                          <span className="sentry-preset-name">{filter.name}</span>
                          <span className="sentry-preset-flags">{filter.url}</span>
                        </div>
                        <button className="jira-filter-edit-btn" onClick={() => startEditJiraFilter(i)} aria-label={`Edit ${filter.name}`}>Edit</button>
                        <button className="sentry-preset-remove" onClick={() => removeJiraFilter(i)} aria-label={`Remove ${filter.name}`}>×</button>
                      </div>
                    )
                  )}
                </div>
              )}

              <div className="sentry-preset-add">
                <input
                  className="settings-input"
                  type="text"
                  placeholder="Filter name"
                  value={newFilterName}
                  onChange={e => setNewFilterName(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  className="settings-input"
                  type="text"
                  placeholder="https://company.atlassian.net/issues?filter=12345"
                  value={newFilterUrl}
                  onChange={e => setNewFilterUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addJiraFilter() }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="settings-save-btn" onClick={addJiraFilter}>Add</button>
              </div>
            </div>
          </>}

          {/* ── Sentry ── */}
          {activeTab === 'sentry' && <>
            <div className="settings-section">
              <div className="settings-section-title">Sentry</div>
              <div className="settings-row">
                <label className="settings-label">Watched Projects</label>
                <div className="settings-ics-add">
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="org/project"
                    value={newSentryProject}
                    onChange={e => setNewSentryProject(e.target.value)}
                    onKeyDown={handleSentryKeyDown}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="settings-save-btn" onClick={addSentryProject}>Add</button>
                </div>
                {sentryProjects.length > 0 && (
                  <div className="settings-cal-badges">
                    {sentryProjects.map((proj, i) => (
                      <span key={i} className="settings-cal-badge">
                        {proj}
                        <button onClick={() => removeSentryProject(i)} aria-label={`Remove ${proj}`}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="settings-hint">
                Run <code>sentry auth login</code> in your terminal to authenticate.
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Filter Presets</div>
              <div className="settings-hint" style={{ marginBottom: 10 }}>
                Save named flag strings to use as quick filters on the Sentry tab. The selected preset is the default shown in the dropdown.
              </div>

              {sentryPresets.length > 0 && (
                <div className="sentry-preset-list">
                  {sentryPresets.map(preset => (
                    <div key={preset.name} className="sentry-preset-row">
                      <input
                        type="radio"
                        className="sentry-preset-radio"
                        name="sentry-default-preset"
                        checked={sentryDefaultPreset === preset.name}
                        onChange={() => setSentryDefault(preset.name)}
                      />
                      <div className="sentry-preset-info">
                        <span className="sentry-preset-name">{preset.name}</span>
                        <span className="sentry-preset-flags">{preset.flags}</span>
                      </div>
                      <button
                        className="sentry-preset-remove"
                        onClick={() => removeSentryPreset(preset.name)}
                        aria-label={`Remove ${preset.name}`}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="sentry-preset-add">
                <input
                  className="settings-input"
                  type="text"
                  placeholder="Preset name"
                  value={newPresetName}
                  onChange={e => setNewPresetName(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  className="settings-input"
                  type="text"
                  placeholder='--sort new -t 7d --query "assigned:[none,me] is:unresolved"'
                  value={newPresetFlags}
                  onChange={e => setNewPresetFlags(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addSentryPreset() }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="settings-save-btn" onClick={addSentryPreset}>Add</button>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Claude Skills</div>
              <div className="settings-hint" style={{ marginBottom: 10 }}>
                Each skill adds a button to every issue card that runs <code>/command ISSUE-TAG</code> via Claude Code and shows the output inline.
              </div>

              {sentrySkills.length > 0 && (
                <div className="sentry-preset-list">
                  {sentrySkills.map(skill => (
                    <div key={skill.name} className="sentry-preset-row">
                      <div className="sentry-preset-info">
                        <span className="sentry-preset-name">{skill.name}</span>
                        <span className="sentry-preset-flags">/{skill.command}</span>
                      </div>
                      <button
                        className="sentry-preset-remove"
                        onClick={() => removeSentrySkill(skill.name)}
                        aria-label={`Remove ${skill.name}`}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="sentry-preset-add">
                <input
                  className="settings-input"
                  type="text"
                  placeholder="Label (e.g. File Bug)"
                  value={newSkillName}
                  onChange={e => setNewSkillName(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  className="settings-input"
                  type="text"
                  placeholder="Command (e.g. file-bug, without the /)"
                  value={newSkillCommand}
                  onChange={e => setNewSkillCommand(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addSentrySkill() }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="settings-save-btn" onClick={addSentrySkill}>Add</button>
              </div>
            </div>
          </>}

          {/* ── Appearance & Alerts ── */}
          {activeTab === 'appearance' && <>
            <div className="settings-section">
              <div className="settings-section-title">Appearance</div>
              <div className="settings-row">
                <label className="settings-label">Theme</label>
                <div className="settings-theme-options">
                  {THEMES.map(t => (
                    <button
                      key={t.id}
                      className={`settings-theme-btn${theme === t.id ? ' active' : ''}`}
                      onClick={() => onThemeChange(t.id)}
                    >
                      <div className="settings-theme-swatches">
                        {t.swatches.map((c, i) => (
                          <span key={i} className="settings-theme-swatch" style={{ background: c }} />
                        ))}
                      </div>
                      <span className="settings-theme-label">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Meeting Alerts</div>
              <div className="settings-row">
                <label className="settings-label">Alert style</label>
                <div className="settings-radio-group">
                  {(['alarm', 'flash', 'none'] as AlertMode[]).map(mode => (
                    <label key={mode} className="settings-radio-label">
                      <input
                        type="radio"
                        name="alert-mode"
                        value={mode}
                        checked={alertMode === mode}
                        onChange={() => onAlertModeChange(mode)}
                      />
                      <span className="settings-radio-custom" />
                      <div>
                        <div className="settings-radio-title">
                          {mode === 'alarm' ? 'Alarm' : mode === 'flash' ? 'Flash only' : 'No alerts'}
                        </div>
                        <div className="settings-radio-desc">
                          {mode === 'alarm' ? 'Visual flash + audio chime'
                            : mode === 'flash' ? 'Visual flash, no sound'
                            : 'Meetings are silent — no flash or sound'}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </>}

          {/* ── Calendars ── */}
          {activeTab === 'calendars' && (
            <div className="settings-section">
              <div className="settings-section-title">Calendars</div>
              <div className="settings-row">
                <div className="settings-ics-add">
                  <input
                    className="settings-input"
                    type="url"
                    placeholder="https://…/calendar.ics"
                    value={newUrl}
                    onChange={e => setNewUrl(e.target.value)}
                    onKeyDown={handleCalKeyDown}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <input
                    className="settings-input settings-input-nick"
                    type="text"
                    placeholder="Nickname"
                    value={newNick}
                    onChange={e => setNewNick(e.target.value)}
                    onKeyDown={handleCalKeyDown}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="settings-save-btn" onClick={addCalendar}>Add</button>
                </div>
                {calendars.length > 0 && (
                  <div className="settings-cal-badges">
                    {calendars.map((cal, i) => (
                      <span key={i} className="settings-cal-badge">
                        {cal.nickname}
                        <button onClick={() => removeCalendar(i)} aria-label={`Remove ${cal.nickname}`}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
