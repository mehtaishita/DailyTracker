export interface Todo {
  title: string
  status: 'todo' | 'in_progress' | 'done' | 'skipped'
  note: string
  completed_date: string | null
}

export interface Meeting {
  summary: string
  timeStr: string
  sortKey: number
  meetUrl?: string
}

export interface HistoryDay {
  completed: { title: string; status: string }[]
  meetings:  Meeting[]
}

export interface JiraIssue {
  key:      string
  title:    string
  status:   string
  url:      string
  assignee?: string | null
}

export interface JiraFilter {
  name: string
  url:  string   // e.g. https://company.atlassian.net/issues?filter=12345
}

export interface PR {
  title:          string
  url:            string
  repo:           string
  number:         number
  draft:          boolean
  additions:      number | null
  deletions:      number | null
  changedFiles:   number | null
  reviewDecision: string | null
  jiraKey:        string | null
  jiraUrl:        string | null
}

export interface NeedsYouPR {
  url:       string
  title:     string
  repo:      string
  number:    number
  reasons:       string[]
  searchReasons: string[]   // reasons that remain after the notification is read
  unread:        boolean
  threadId:      string | null
  updatedAt: string | null
}

export interface NeedsYouJira {
  key:          string
  title:        string
  status:       string
  url:          string
  newCount:     number
  latestAt:     string
  latestAuthor: string
}

export interface SentryPreset {
  name:  string
  flags: string
}

export interface SentrySkill {
  name:    string
  command: string
}

export interface SentryIssue {
  shortId: string
  title:   string
  seen:    string
  age:     string
  trend:   string | null
  events:  string
  triage:  string
}

export interface SentryProjectResult {
  project: string
  issues:  SentryIssue[] | string | null
  error:   string | null
}

export interface StackFrame {
  location:  string
  file:      string
  line:      number | null
  code:      { num: number; text: string; highlight: boolean }[]
  isInApp:   boolean
}

export interface IssueDetail {
  shortId:   string
  title:     string
  status:    string
  priority:  string
  level:     string
  assignee:  string
  events:    string
  firstSeen: string
  lastSeen:  string
  link:      string
  message:   string
  frames:    StackFrame[]
  breadcrumbs: { time: string; level: string; category: string; message: string }[]
  tags:      { key: string; value: string }[]
}

export type AlertMode = 'alarm' | 'flash' | 'none'
export type TabId    = 'today' | 'tasks' | 'calendar' | 'jira' | 'github' | 'sentry' | 'notes' | 'settings'
export type ThemeId  = 'default' | 'ocean' | 'terminal' | 'coastal'

export interface ReviewIssue {
  id:          string
  severity:    string
  sectionType: string
  file:        string | null
  line:        number | null
  description: string
  rawLine:     string
}

declare global {
  interface Window {
    tracker: {
      readTodos:            ()                             => Promise<Todo[]>
      writeTodos:           (todos: Todo[])                => Promise<boolean>
      readHistory:          ()                             => Promise<Record<string, HistoryDay>>
      fetchICSRange:        (start: string, end: string)  => Promise<Record<string, Meeting[]>>
      readNotes:            ()                             => Promise<Record<string, string>>
      writeNote:            (date: string, text: string)  => Promise<boolean>
      fetchJiraSprint:           ()                                              => Promise<{ issues?: JiraIssue[]; error?: string }>
      fetchJiraFilterIssues:     (filterId: string, nextPageToken: string | null) => Promise<{ issues?: JiraIssue[]; nextPageToken?: string | null; error?: string }>
      fetchGithub:          ()                             => Promise<{ myPRs?: PR[]; reviews?: PR[]; openPRs?: PR[]; error?: string | null }>
      fetchNeedsYou:        ()                             => Promise<{ prs: NeedsYouPR[]; error: string | null }>
      markGithubRead:       (threadId: string)             => Promise<{ error: string | null }>
      fetchJiraNeedsYou:    ()                             => Promise<{ issues: NeedsYouJira[]; error: string | null }>
      markJiraSeen:         (key: string)                  => Promise<boolean>
      fetchSentry:          (flags?: string)                => Promise<{ projects?: SentryProjectResult[]; error?: string | null }>
      fetchSentryIssue:     (tag: string)                  => Promise<{ detail?: IssueDetail; error?: string }>
      openSentryIssue:      (tag: string)                  => Promise<void>
      runSentrySkill:       (tag: string, skillName: string, command: string) => Promise<{ output?: string; error?: string }>
      getSentrySkillRuns:   (tag: string)                  => Promise<Record<string, string>>
      openUrl:              (url: string)                  => void
      onFileChanged:        (cb: () => void)               => void
      getPrReview:          (prUrl: string)                => Promise<string | null>
      runPrReview:          (prUrl: string, jiraKey: string | null) => Promise<{ review?: string; error?: string }>
      postPrReviewComment:  (number: number, repo: string, body: string) => Promise<{ error?: string }>
      markPrCommented:         (prUrl: string)  => Promise<boolean>
      getCommentedPrUrls:      ()               => Promise<string[]>
      getCommentedPrCountToday: ()              => Promise<number>
      getSetting:           (key: string)                  => Promise<string | null>
      setSetting:           (key: string, value: string)   => Promise<boolean>
      archivePastDone:      (todayStr: string)             => Promise<boolean>
    }
  }
}
