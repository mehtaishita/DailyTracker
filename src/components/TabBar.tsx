import React from 'react'
import Nav from 'react-bootstrap/Nav'
import { Sun, CheckCircle, Calendar, Ticket, Github, AlertTriangle, StickyNote, Settings } from 'griddy-icons'
import type { TabId } from '../types/tracker'

interface Tab {
  id:    TabId
  label: string
  Icon:  React.ComponentType<{ size?: number | string; color?: string }>
}

const TABS: Tab[] = [
  { id: 'today',    label: 'Today',    Icon: Sun         },
  { id: 'calendar', label: 'Calendar', Icon: Calendar    },
  { id: 'jira',     label: 'Jira',     Icon: Ticket      },
  { id: 'github',   label: 'GitHub',   Icon: Github        },
  { id: 'sentry',   label: 'Sentry',   Icon: AlertTriangle },
  { id: 'notes',    label: 'Daybook',  Icon: StickyNote    },
  { id: 'tasks',    label: 'Tasks',    Icon: CheckCircle },
  { id: 'settings', label: 'Settings', Icon: Settings    },
]

interface Props {
  current:  TabId
  onChange: (tab: TabId) => void
}

export default function TabBar({ current, onChange }: Props) {
  return (
    <Nav className="app-tabs" role="tablist">
      {TABS.map(({ id, label, Icon }) => (
        <Nav.Item key={id}>
          <Nav.Link
            as="button"
            id={`tab-${id}`}
            className={`app-tab${current === id ? ' active' : ''}`}
            title={label}
            aria-selected={current === id}
            onClick={() => onChange(id)}
          >
            <span className="tab-icon">
              <Icon size={28} color="currentColor" />
            </span>
            <span className="tab-label">{label}</span>
          </Nav.Link>
        </Nav.Item>
      ))}
    </Nav>
  )
}
