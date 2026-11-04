import { useCallback, useEffect, useRef, useState } from 'react'
import { C, MONO, alpha } from '../../ui/theme'
import { EASE } from '../../ui/motion'

// Icon rails and flyout panels for the graph. Panels float over the canvas: opening, closing or pinning one never
// changes the canvas size, so nothing re-lays out. Left rail = tools (Controls, Filters), right rail = what you are
// looking at (Details, Compare, Insights, Legend). State (open, pinned) is remembered per browser.

export const PANELS = [
  { id: 'controls', side: 'left', icon: '⚙', label: 'Controls', key: 'C', tip: 'Forces, layout, arrows, labels, lines, size, color, hierarchy' },
  { id: 'filters', side: 'left', icon: '⛁', label: 'Filters', key: 'V', tip: 'Focus, kinds shown, find a node' },
  { id: 'details', side: 'right', icon: 'ⓘ', label: 'Details', key: 'D', tip: 'The selected node: attributes, owners, links' },
  { id: 'compare', side: 'right', icon: '⇄', label: 'Compare', key: 'M', tip: 'Pick nodes to see what they share' },
  { id: 'insights', side: 'right', icon: '✦', label: 'Insights', key: 'I', tip: 'Bridges, communities, gaps; explain this graph' },
  { id: 'legend', side: 'bottom', rail: false, icon: '◧', label: 'Legend', key: '', tip: 'What colors, sizes, lines and pulses mean now (the Legend chip, bottom right)' },
]
// Context panels follow the selection or the picks; the rest close when you click outside them.
export const CONTEXT = new Set(['details', 'compare'])

const KEY = 'docket.graph.ui.v2'
const DEFAULT = { pinned: {}, bar: true }
function load() {
  try { const j = JSON.parse(localStorage.getItem(KEY)); if (j && typeof j === 'object') return { ...DEFAULT, ...j } } catch (e) { /* storage blocked */ }
  return DEFAULT
}
// Only what the user chose to keep is remembered: which panels are pinned open and whether the toolbar is expanded.
export function useUi() {
  const [ui, setUi] = useState(load)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(ui)) } catch (e) { /* storage blocked */ } }, [ui])
  const pin = useCallback((id, v) => setUi(u => ({ ...u, pinned: { ...u.pinned, [id]: v === undefined ? !u.pinned[id] : v } })), [])
  const setBar = useCallback(v => setUi(u => ({ ...u, bar: typeof v === 'function' ? v(u.bar) : v })), [])
  return { ui, pin, setBar }
}

const RAIL_W = 40
export const RAIL_GAP = 8
export const RAIL_SPAN = RAIL_GAP * 2 + RAIL_W
// Open panels on one side sit next to each other (never on top of each other), sharing up to half the width.
export function layoutPanels(shown, boxW) {
  const out = {}
  for (const side of ['left', 'right']) {
    const open = PANELS.filter(p => p.side === side && shown[p.id])
    const n = Math.max(open.length, 1)
    const w = Math.max(230, Math.min(330, Math.floor((boxW / 2 - RAIL_SPAN - (n - 1) * 6) / n)))
    open.forEach((p, i) => { out[p.id] = { width: w, offset: RAIL_SPAN + i * (w + 6) } })
  }
  return out
}

export function Rail({ side, top, items, shown, pinned, badges, onEnter, onLeave, onClick }) {
  return (
    <div role="toolbar" aria-label={side === 'left' ? 'Graph tools' : 'Graph panels'} style={{ position: 'absolute', [side]: RAIL_GAP, top, zIndex: 9, width: RAIL_W, display: 'flex', flexDirection: 'column', gap: 4,
      padding: 4, borderRadius: 10, background: alpha(C.panel, 0.92), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(C.accent, '30')}` }}>
      {items.map(p => {
        const on = !!shown[p.id]
        const pn = !!pinned[p.id]
        const b = badges[p.id]
        return (
          <button key={p.id} onClick={() => onClick(p.id)} onMouseEnter={() => onEnter(p.id)} onMouseLeave={() => onLeave(p.id)} onFocus={() => onEnter(p.id)}
            aria-pressed={pn} aria-expanded={on} aria-label={p.label} title={`${p.label} (${p.key}): ${p.tip}. Hover to peek, click to pin open.`}
            style={{ position: 'relative', width: 32, height: 32, borderRadius: 7, cursor: 'pointer', fontSize: 15, lineHeight: 1, display: 'grid', placeItems: 'center',
              border: `1px solid ${on ? alpha(C.accent, pn ? 'c0' : '70') : 'transparent'}`, background: on ? alpha(C.accent, pn ? '30' : '18') : 'transparent', color: on ? C.bright : C.muted,
              transition: `background .18s ${EASE}, border-color .18s ${EASE}` }}>
            {p.icon}
            {pn && <span aria-hidden style={{ position: 'absolute', left: 2, top: 1, fontSize: 7, color: C.accent }}>●</span>}
            {b ? <span style={{ position: 'absolute', right: -3, top: -4, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 8, background: b.warn ? C.amber : C.accent, color: C.bg, fontFamily: MONO, fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{b.n}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

// One flyout. It sits beside its rail and below the top bar, over the canvas. It stays mounted and only fades and
// slides (opacity and transform: nothing the canvas can feel); hidden, it takes no pointer events and cannot be focused.
export function Flyout({ panel, shown, pinned, top, bottom, width = 330, offset, onClose, onPin, onEnter, onLeave, panelRef, children, visible, pm }) {
  const on = visible && shown
  const dir = panel.side === 'left' ? `translateX(${-pm.travel}px)` : panel.side === 'right' ? `translateX(${pm.travel}px)` : `translateY(${pm.travel}px)`   // from its own edge: left, right or bottom
  const place = panel.side === 'bottom'
    ? { right: RAIL_GAP * 2 + RAIL_W, bottom: 42, width: 340, maxHeight: 'calc(100% - 140px)' }
    : { [panel.side]: offset ?? RAIL_GAP * 2 + RAIL_W, top, bottom, width }
  return (
    <div ref={panelRef} data-flyout={panel.id} role="dialog" aria-label={panel.label} aria-hidden={!on} onMouseEnter={() => onEnter(panel.id)} onMouseLeave={() => onLeave(panel.id)}
      style={{ position: 'absolute', ...place, zIndex: 8, display: 'flex', flexDirection: 'column',
        background: alpha(C.panel, 0.96), backdropFilter: 'blur(10px)', border: `1px solid ${alpha(C.accent, pinned ? '70' : '35')}`, borderRadius: 10, color: C.body,
        opacity: on ? 1 : 0, transform: on ? 'none' : dir, pointerEvents: on ? 'auto' : 'none', visibility: on ? 'visible' : 'hidden', willChange: 'opacity, transform',
        transition: on
          ? `opacity ${pm.inMs - pm.fadeDelay}ms ${pm.easeIn} ${pm.fadeDelay}ms, transform ${pm.inMs}ms ${pm.easeIn}, visibility 0s`
          : `opacity ${pm.outMs}ms ${pm.easeOut}, transform ${pm.outMs}ms ${pm.easeOut}, visibility 0s linear ${pm.outMs}ms` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px 6px 12px', borderBottom: `1px solid ${C.line}` }}>
        <span style={{ flex: 1, fontFamily: MONO, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: C.dim }}>{panel.label} {panel.key && <span style={{ letterSpacing: 0, color: C.faint }}>{panel.key}</span>}</span>
        <button onClick={() => onPin(panel.id)} aria-pressed={pinned} title={pinned ? 'Pinned: stays open. Click to let it hide when the pointer leaves.' : 'Pin open: it will not hide by itself'}
          style={{ ...mini, color: pinned ? C.accent : C.dim, borderColor: pinned ? alpha(C.accent, '70') : C.line }}>{pinned ? '● Pinned' : '○ Pin'}</button>
        <button onClick={() => onClose(panel.id)} aria-label={`Close ${panel.label}`} title="Close" style={{ ...mini, fontSize: 13, padding: '0 7px' }}>×</button>
      </div>
      <div style={{ overflowY: 'auto', padding: '2px 12px 12px', minHeight: 0, flex: 1 }}>{children}</div>
    </div>
  )
}
const mini = { fontFamily: MONO, fontSize: 10, cursor: 'pointer', background: 'transparent', color: C.dim, border: `1px solid ${C.line}`, borderRadius: 6, padding: '1px 7px', height: 22 }

// Keys: letters open panels, F is focus mode, ? is this help, Esc closes the panels that are not pinned.
export function useGraphKeys({ onPanel, onFocus, onHelp, onEsc, enabled }) {
  const cb = useRef({})
  cb.current = { onPanel, onFocus, onHelp, onEsc }
  useEffect(() => {
    if (!enabled) return undefined
    const onKey = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') { if (cb.current.onEsc()) { e.stopPropagation() } return }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return
      if (e.key === '?') { e.preventDefault(); cb.current.onHelp(); return }
      const k = e.key.toUpperCase()
      if (k === 'F') { e.preventDefault(); cb.current.onFocus(); return }
      const p = PANELS.find(x => x.key === k)
      if (p) { e.preventDefault(); cb.current.onPanel(p.id) }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [enabled])
}

export function HelpOverlay({ onClose }) {
  const rows = [...PANELS.filter(p => p.key).map(p => [p.key, `${p.label}: ${p.tip}`]), ['Legend chip', 'Bottom right: hover to peek at what the colors, sizes, lines and pulses mean, click to pin'], ['F', 'Focus mode: hide everything but the graph (move to an edge, or press a key, to bring it back)'], ['?', 'This list'], ['Esc', 'Close the panels that are not pinned (then leave full window)'],
    ['Click', 'Select a node and pull in its neighbors'], ['Shift / Ctrl-click', 'Add a node to the compare tray'], ['Drag', 'Move a node (it stays where you drop it); double-click to release'], ['Scroll', 'Zoom'], ['Shift-drag / right-drag', '3D: pan']]
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', background: alpha(C.bg, 0.55) }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Shortcuts" style={{ background: C.panel, border: `1px solid ${alpha(C.accent, '50')}`, borderRadius: 12, padding: '14px 18px', maxWidth: 'min(520px, 92%)', color: C.body }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ flex: 1, fontFamily: MONO, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: C.dim }}>Keys and mouse</span>
          <button onClick={onClose} aria-label="Close" style={{ ...mini, fontSize: 13, padding: '0 7px' }}>×</button>
        </div>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '5px 14px', margin: 0, fontSize: 12 }}>
          {rows.map(([k, t]) => [<dt key={'k' + k} style={{ fontFamily: MONO, color: C.accent, whiteSpace: 'nowrap' }}>{k}</dt>, <dd key={'t' + k} style={{ margin: 0 }}>{t}</dd>])}
        </dl>
      </div>
    </div>
  )
}
