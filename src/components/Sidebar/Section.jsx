import { createContext, useContext, useState } from 'react'
import { C, MONO } from '../../ui/theme'

// Collapsible sidebar sections. Which ones are collapsed is a per-browser convenience,
// so localStorage (which can throw or come back empty) and the default is all open.
const KEY = 'docket.sidebar.collapsed'
const load = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY)) ?? []) } catch { return new Set() } }
const save = s => { try { localStorage.setItem(KEY, JSON.stringify([...s])) } catch { /* not persisted */ } }

const Sections = createContext(null)

// ids: every section in the sidebar, so collapse all and option-click "only this" know the set
export function SectionsProvider({ ids, children }) {
  const [collapsed, setCollapsed] = useState(load)
  const update = s => { setCollapsed(s); save(s) }
  const toggle = (id, only) => {
    if (only) return update(new Set(ids.filter(x => x !== id)))
    const s = new Set(collapsed)
    s.has(id) ? s.delete(id) : s.add(id)
    update(s)
  }
  const setAll = c => update(c ? new Set(ids) : new Set())
  return <Sections.Provider value={{ ids, collapsed, toggle, setAll }}>{children}</Sections.Provider>
}

export const useCollapsed = id => useContext(Sections)?.collapsed.has(id) ?? false

// The section title: click to collapse, option-click to keep only this one open.
// children are header controls (the calendar's month nav), hidden while collapsed.
// `after` sits right beside the title (e.g. a list's "✓ ack all"); the rest of the row still toggles the section
export function SectionHeader({ id, accent, title, children, after }) {
  const ctx = useContext(Sections)
  const collapsed = ctx?.collapsed.has(id) ?? false
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: collapsed ? 0 : 10 }}>
      <button onClick={e => ctx?.toggle(id, e.altKey)}
              title={`${collapsed ? 'Expand' : 'Collapse'} · option-click to show only this section`}
              style={{ fontFamily: MONO, fontSize: 10, color: accent, letterSpacing: 3, textTransform: 'uppercase',
                       flex: after && !collapsed ? '0 1 auto' : 1, display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left',
                       background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
        <span style={{ display: 'inline-block', width: 8, color: C.dim, letterSpacing: 0,
                       transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.15s' }}>▸</span>
        {title}
      </button>
      {!collapsed && after && <span style={{ marginLeft: 8 }}>{after}</span>}
      {!collapsed && after && <span onClick={e => ctx?.toggle(id, e.altKey)} style={{ flex: 1, alignSelf: 'stretch', cursor: 'pointer' }} />}
      {!collapsed && children}
    </div>
  )
}

// collapse all / expand all, above the first section
export function SectionsBar() {
  const { ids, collapsed, setAll } = useContext(Sections)
  const allClosed = ids.every(id => collapsed.has(id))
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -12 }}>
      <button onClick={() => setAll(!allClosed)} style={{
        fontFamily: MONO, fontSize: 9, color: C.dim, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
      }}>{allClosed ? 'expand all' : 'collapse all'}</button>
    </div>
  )
}
