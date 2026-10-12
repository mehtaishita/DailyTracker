import React, { useState } from 'react'
import CollapsibleSection from '../CollapsibleSection'
import type { Todo, HistoryDay } from '../../types/tracker'

const TODAY_STR = new Date().toLocaleDateString('en-CA')

interface Props {
  todos:        Todo[]
  calHistory:   Record<string, HistoryDay>
  onToggle:     (todo: Todo) => void
  onRemove:     (todo: Todo) => void
  onAdd:        (title: string) => void
  onReorder:    (todos: Todo[]) => void
}

function getWeekStart() {
  const d = new Date(TODAY_STR + 'T12:00:00')
  d.setDate(d.getDate() - (((d.getDay() + 6) % 7) || 7))
  return d.toLocaleDateString('en-CA')
}

function WeekToDate({ todos, calHistory }: { todos: Todo[]; calHistory: Record<string, HistoryDay> }) {
  const weekStart  = getWeekStart()
  const cur        = new Date(weekStart + 'T12:00:00')
  const todayDate  = new Date(TODAY_STR + 'T12:00:00')
  const end        = todayDate

  const days: { label: string; items: { title: string }[] }[] = []

  while (cur <= end) {
    const dStr  = cur.toLocaleDateString('en-CA')
    let items: { title: string }[]

    if (dStr === TODAY_STR) {
      items = todos.filter(t => t.status === 'done' && (t.completed_date === TODAY_STR || !t.completed_date))
    } else {
      const fromHistory = (calHistory[dStr]?.completed || []).filter(c => c.status === 'done')
      const fromTodos   = todos.filter(t => t.status === 'done' && t.completed_date === dStr)
      const histTitles  = new Set(fromHistory.map(c => c.title))
      items = [...fromHistory, ...fromTodos.filter(t => !histTitles.has(t.title))]
    }

    if (items.length > 0) {
      days.push({
        label: cur.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        items,
      })
    }

    cur.setDate(cur.getDate() + 1)
  }

  if (days.length === 0) {
    return <div className="wtd-empty">Nothing completed this week yet</div>
  }

  return (
    <>
      {days.map(day => (
        <div key={day.label}>
          <div className="wtd-day-header">{day.label}</div>
          {day.items.map((item, i) => (
            <div key={i} className="wtd-item">
              <span className="wtd-bullet">•</span>
              <span>{item.title}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

export default function TasksView({ todos, calHistory, onToggle, onRemove, onAdd, onReorder }: Props) {
  const [addValue,    setAddValue]    = useState('')
  const [dragIdx,     setDragIdx]     = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const active = todos.filter(t => !['done', 'skipped'].includes(t.status))
  const done   = todos.filter(t =>  ['done', 'skipped'].includes(t.status))

  function handleDrop(toIdx: number) {
    if (dragIdx === null || dragIdx === toIdx) {
      setDragIdx(null)
      setDragOverIdx(null)
      return
    }
    const newActive = [...active]
    const [moved] = newActive.splice(dragIdx, 1)
    newActive.splice(toIdx, 0, moved)
    const activePositions = todos.reduce<number[]>((acc, t, i) => {
      if (!['done', 'skipped'].includes(t.status)) acc.push(i)
      return acc
    }, [])
    const result = [...todos]
    activePositions.forEach((pos, i) => { result[pos] = newActive[i] })
    onReorder(result)
    setDragIdx(null)
    setDragOverIdx(null)
  }
  const total  = todos.length
  const doneCount = todos.filter(t => t.status === 'done').length
  const pct    = total === 0 ? 0 : Math.round((doneCount / total) * 100)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const val = addValue.trim()
    if (!val) return
    setAddValue('')
    onAdd(val)
  }

  return (
    <div id="view-tasks" className="view">
      <div className="view-card">
      <div className="today-header">
        <div className="progress-wrap">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-text">{total === 0 ? '' : `${doneCount} of ${total} done`}</span>
        </div>
        <div className="add-area">
          <div className="add-input-wrap">
            <span className="add-icon">+</span>
            <input
              className="add-input"
              type="text"
              placeholder="Add task…"
              value={addValue}
              onChange={e => setAddValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />
            <span className="add-hint">↵ to add</span>
          </div>
        </div>
      </div>

      <div className="list-wrap">
        {todos.length === 0 ? (
          <div id="empty-state">No tasks yet — add one above</div>
        ) : (
          <>
            <CollapsibleSection label="Todo" colorClass="group-progress">
              {active.map((todo, i) => (
                <TodoItem
                  key={i}
                  todo={todo}
                  onToggle={onToggle}
                  onRemove={onRemove}
                  dragProps={{
                    onDragStart: () => setDragIdx(i),
                    onDragOver:  () => setDragOverIdx(i),
                    onDrop:      () => handleDrop(i),
                    onDragEnd:   () => { setDragIdx(null); setDragOverIdx(null) },
                    isDragging:  dragIdx === i,
                    isDragOver:  dragOverIdx === i && dragIdx !== i,
                  }}
                />
              ))}
            </CollapsibleSection>

            {done.length > 0 && (
              <CollapsibleSection label="Completed" colorClass="group-done">
                {done.map((todo, i) => (
                  <TodoItem key={i} todo={todo} onToggle={onToggle} onRemove={onRemove} />
                ))}
              </CollapsibleSection>
            )}
          </>
        )}

        <CollapsibleSection label="Week to Date" colorClass="group-wtd" defaultCollapsed={true}>
          <WeekToDate todos={todos} calHistory={calHistory} />
        </CollapsibleSection>
      </div>

      </div>
    </div>
  )
}

interface DragProps {
  onDragStart: () => void
  onDragOver:  () => void
  onDrop:      () => void
  onDragEnd:   () => void
  isDragging:  boolean
  isDragOver:  boolean
}

function TodoItem({ todo, onToggle, onRemove, dragProps }: {
  todo:       Todo
  onToggle:   (t: Todo) => void
  onRemove:   (t: Todo) => void
  dragProps?: DragProps
}) {
  const isDone = ['done', 'skipped'].includes(todo.status)

  const dragClass = dragProps?.isDragging  ? ' dragging'
                  : dragProps?.isDragOver  ? ' drag-over'
                  : ''

  return (
    <div
      className={`todo-item status-${todo.status || 'todo'}${dragClass}`}
      onDragOver={dragProps ? e => { e.preventDefault(); dragProps.onDragOver() } : undefined}
      onDrop={dragProps ? e => { e.preventDefault(); dragProps.onDrop() } : undefined}
      onDragEnd={dragProps?.onDragEnd}
    >
      {dragProps && (
        <span
          className="drag-handle"
          draggable={true}
          onDragStart={dragProps.onDragStart}
          aria-label="Drag to reorder"
        >⠿</span>
      )}
      <label className="cb-wrap">
        <input
          type="checkbox"
          checked={isDone}
          onChange={() => onToggle(todo)}
        />
        <div className="cb-box">
          <span className="cb-check">✓</span>
        </div>
      </label>
      <span className="todo-text">{todo.title}</span>
      {todo.status === 'in_progress' && <span className="status-pip pip-in_progress">In progress</span>}
      {todo.status === 'skipped'     && <span className="status-pip pip-skipped">Skipped</span>}
      <button
        className="del-btn"
        onClick={e => { e.stopPropagation(); onRemove(todo) }}
      >×</button>
    </div>
  )
}
