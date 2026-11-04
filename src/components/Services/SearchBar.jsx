import { useEffect, useRef, useState } from 'react'
import { C, alpha, glow } from '../../ui/theme'

// One box for everything: filters the service cards and drives the universal search
// below it. "/" focuses it from anywhere; Esc clears.
// Scopes narrow what a plain word is searched in. A typed prefix (sw:java) beats the dropdown.
// Keep in step with SCOPE_PREFIX / SCOPE_OF in backend/homeapi/search.py.
const SCOPES = [
  ['all', 'Everything', 'Search every source: hosts, apps, proxy names, DNS, datasets, movies, TV, watched videos. The default.', 'Search everything — hosts, apps, IPs, proxy names, datasets, movies…   ( / )'],
  ['hosts', 'Hosts', 'Machines by name or IP: TrueNAS, VMs, AdGuard DNS names, Prometheus targets and alerts. Prefix: host:', 'Hostname or IP…  e.g. babbage, turing, 10.10.10.50'],
  ['apps', 'Apps', 'TrueNAS apps, dashboard cards, proxy names and the datasets they mount. Prefix: app:', 'App, proxy name or dataset…  e.g. plex, nextcloud, Media'],
  ['media', 'Media', 'Movies (Radarr), TV (Sonarr) and the watch ledger. Prefix: media:', 'A title…  e.g. Obsession'],
  ['aikb', 'Notes', 'The AIKB knowledge base: markdown notes, runbooks, decisions. Prefix: kb: or aikb:', 'Search notes…  e.g. zfs scrub, vaultwarden, plex transcode'],
]
const PREFIX = /^\s*(host|hosts|h|app|apps|media|m|aikb|kb|notes)\s*:/i
const PREFIX_SCOPE = { host: 'hosts', hosts: 'hosts', h: 'hosts', app: 'apps', apps: 'apps', media: 'media', m: 'media', aikb: 'aikb', kb: 'aikb', notes: 'aikb' }

// Work Docket's Grid view (PivotGrid) pivots on work attributes (team, owner, cluster); left out until home has its own columns.
const VIEWS = [['list', 'List', '☰'], ['graph', 'Graph', '◉']]

// One fixed place for the result view: always the last thing in the box, always the same size, so it never moves between states.
function ViewSwitch({ view, setView, accent }) {
  return (
    <span role="group" aria-label="Result view" style={{ display: 'inline-flex', flexShrink: 0, border: `1px solid ${alpha(C.text, '1a')}`, borderRadius: 7, overflow: 'hidden', marginLeft: 4 }}>
      {VIEWS.map(([v, label, icon]) => (
        <button key={v} onClick={() => setView(v)} aria-pressed={view === v} title={`${label} view`}
          style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: 0.5, width: 82, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', border: 0,
                   color: view === v ? C.bright : C.dim, background: view === v ? alpha(accent, '38') : 'transparent', boxShadow: view === v ? `inset 0 -2px 0 ${accent}` : 'none' }}>
          <span aria-hidden style={{ fontSize: 12 }}>{icon}</span>{label}
        </button>
      ))}
    </span>
  )
}

export function SearchBar({ query, setQuery, scope = 'all', setScope, matches, accent, view, setView }) {
  const typed = PREFIX_SCOPE[(query.match(PREFIX)?.[1] ?? '').toLowerCase()]
  const active = typed ?? scope
  const cur = SCOPES.find(s => s[0] === active) ?? SCOPES[0]
  const input = useRef(null)
  useEffect(() => {
    const onKey = e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
      if (e.key === '/' && !typing) { e.preventDefault(); input.current?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',   // the view switch drops to its own line on a phone
      background: C.panel,
      border: `1px solid ${query ? alpha(accent, '50') : alpha(C.text, '10')}`,
      borderRadius: 10, padding: '10px 16px', minHeight: 52, boxSizing: 'border-box',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      boxShadow: query ? `0 0 16px ${glow(accent, '15')}` : 'none',
    }}>
      <span style={{ color: query ? accent : C.dim, fontSize: 15, transition: 'color 0.2s' }}>⌕</span>
      <SearchHelp accent={accent} />
      <select
        value={active} onChange={e => setScope?.(e.target.value)} disabled={!!typed}
        aria-label="Search scope" title={typed ? `Scope set by the "${query.match(PREFIX)[1]}:" prefix` : cur[2]}
        style={{
          background: 'transparent', color: active === 'all' ? C.dim : accent, border: `1px solid ${active === 'all' ? C.faint : alpha(accent, '50')}`,
          borderRadius: 4, fontFamily: "'JetBrains Mono',monospace", fontSize: 10, padding: '2px 4px', outline: 'none', cursor: 'pointer',
        }}>
        {SCOPES.map(([v, label, tip]) => <option key={v} value={v} title={tip} style={{ background: C.panel, color: C.text }}>{label}</option>)}
      </select>
      <input
        ref={input}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') setQuery('') }}
        placeholder={cur[3]}
        style={{
          background: 'transparent', border: 'none', outline: 'none',
          fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: C.text,
          flex: 1, minWidth: 120, caretColor: accent,
        }}
      />
      {query && (
        <>
          <span
            onClick={() => setQuery('')}
            style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 10,
              color: C.dim, cursor: 'pointer', padding: '2px 6px',
              border: `1px solid ${C.faint}`, borderRadius: 4,
            }}
          >✕</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: accent }}>
            {matches.count} match{matches.count !== 1 ? 'es' : ''}{matches.running ? '…' : ''}
          </span>
        </>
      )}
      {view && <ViewSwitch view={view} setView={setView} accent={accent} />}
    </div>
  )
}

const mono = "'JetBrains Mono',monospace"

// What the box understands. Keep in step with kind_of() / SCOPE_PREFIX in backend/homeapi/search.py.
const TIPS = [
  ['Just type', [
    ['babbage  ·  turing', 'a host: its pools, datasets, apps, proxy names, DNS and Prometheus targets'],
    ['10.10.10.50', 'an IP: the host that answers on it, and what forwards to it'],
    ['plex  ·  nextcloud', 'an app: where it runs, what it mounts, which proxy names reach it'],
    ['anything else', 'free text across the mirror, Radarr, Sonarr and the watch ledger'],
  ]],
  ['Scope: pick it in the dropdown, or type a prefix', [
    ['host:turing', 'hosts only'],
    ['app:media', 'apps, cards, proxy names and datasets'],
    ['media:obsession', 'movies, TV and watched videos'],
  ]],
  ['Getting around', [
    ['/  ·  Esc', 'jump to the search box · clear it'],
    ['click a result', 'a host or app in the results opens its own search'],
    ['◉ Graph', 'the same search as a graph; * or all shows everything'],
  ]],
]

function SearchHelp({ accent }) {
  const [open, setOpen] = useState(false)
  const timer = useRef(null)
  const show = () => { clearTimeout(timer.current); setOpen(true) }
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 150) }
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }} onMouseEnter={show} onMouseLeave={hide}>
      <span
        role="button" tabIndex={0} aria-label="Search tips"
        onClick={() => setOpen(o => !o)} onFocus={show} onBlur={hide}
        style={{
          fontFamily: mono, fontSize: 10, lineHeight: '14px', width: 16, height: 16, textAlign: 'center',
          borderRadius: '50%', cursor: 'help', color: open ? accent : C.dim,
          border: `1px solid ${open ? alpha(accent, '60') : C.faint}`,
        }}
      >?</span>
      {open && (
        <div style={{
          position: 'absolute', top: 26, left: -8, zIndex: 50, width: 'min(560px, calc(100vw - 48px))',
          background: C.panel, border: `1px solid ${alpha(C.text, '18')}`, borderRadius: 10,
          boxShadow: '0 8px 28px rgba(0,0,0,0.35)', padding: '12px 14px',
        }}>
          {TIPS.map(([head, rows]) => (
            <div key={head} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: accent, marginBottom: 4 }}>
                {head}
              </div>
              {rows.map(([ex, what]) => (
                <div key={ex} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 190px) 1fr', gap: 10, padding: '2px 0' }}>
                  <code style={{ fontFamily: mono, fontSize: 11, color: C.text }}>{ex}</code>
                  <span style={{ fontSize: 12, color: C.dim }}>{what}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
