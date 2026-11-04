import { useState, useEffect, useCallback, useRef } from 'react'
import { useWindowSize } from './hooks/useWindowSize'
import { TopBar } from './components/TopBar/TopBar'
import { SearchBar } from './components/Services/SearchBar'
import { UniversalResults, matchCount, useUniversalSearch, useView } from './components/Search/UniversalResults'
import { GroupSection } from './components/Services/GroupSection'
import { ServiceCard } from './components/Services/ServiceCard'
import { Sidebar } from './components/Sidebar/Sidebar'
import { SERVICES } from './services'
import { fetchAllData } from './api/index.js'
import { useLocation } from './router'
import { ThemeContext, C, alpha, DENSITY } from './ui/theme'
import { AppearanceDrawer } from './components/Appearance/AppearanceDrawer'
import { useAppearance } from './hooks/useAppearance'
import { Toaster } from './ui/primitives'
import { Nav } from './components/TopBar/Nav'
import AikbView from './views/Aikb/AikbView'
import NoteView from './views/Aikb/NoteView'
import WatchView from './views/Watch/WatchView'
import HaView from './views/HomeAssistant/HaView'
import UsageView from './views/Usage/UsageView'
import { ViewShell } from './views/bits'

const VIEWS = { '/aikb': AikbView, '/aikb/note': NoteView, '/usage': UsageView, '/watch': WatchView, '/ha': HaView }
const TITLES = { '/': 'Docket', '/aikb': 'AIKB · Docket', '/aikb/note': 'AIKB note · Docket', '/usage': 'AI Usage · Docket', '/watch': 'Watch · Docket', '/ha': 'HA · Docket' }


// Map live API data to per-service detail overrides, plus each card's probe result
function buildServiceData(apiData) {
  if (!apiData) return {}
  const live = {
    Plex: apiData.plex,
    Tautulli: apiData.tautulli,
    Overseerr: apiData.overseerr,
    Sonarr: apiData.sonarr,
    Radarr: apiData.radarr,
    Prowlarr: apiData.prowlarr,
    SABnzbd: apiData.sabnzbd,
    Transmission: apiData.transmission,
    AdGuard: apiData.adguard,
    Prometheus: apiData.prometheus,
    OpenSoak: apiData.opensoak,
  }
  const health = apiData.health?.services ?? {}
  return Object.fromEntries(Object.values(SERVICES).flat().map(svc => {
    const h = health[svc.name]
    return [svc.name, { ...live[svc.name], online: h?.online ?? null, latency: h?.ms, certDays: h?.certDays, error: h?.error }]
  }))
}

export default function App() {
  const { w } = useWindowSize()
  const { path } = useLocation()
  const View = path === '/' ? null : VIEWS[path]
  const isMobile = w < 640
  const isTablet = w >= 640 && w < 1024
  const navInRow = w < 1024
  const showSidebar = w >= 1024

  const [sidebarOpen, setSidebarOpen] = useState(false)
  // ?q= opens with a search filled in, so a search can be linked or bookmarked
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const [scope, setScope] = useState(() => { try { return localStorage.getItem('docket.search.scope') || 'all' } catch { return 'all' } })
  const pickScope = v => { setScope(v); try { localStorage.setItem('docket.search.scope', v) } catch { /* not saved */ } }
  const search = useUniversalSearch(query, scope)
  const chain = useRef(new Set())
  const [view, pickView] = useView(search.q, chain)
  // "Search for this" in the graph: a real search, and the page stays in Graph view along the chain of such searches
  const graphSearch = text => { chain.current.add(search.q); chain.current.add(text); setQuery(text) }
  const matches = matchCount(search)
  const [appearanceOpen, setAppearanceOpen] = useState(false)

  // Theme, mode, accent, radius, texture: saved on the server (/api/appearance), so they follow you to any browser
  const appearance = useAppearance()
  const accent = C.accent
  const cardRadius = appearance.settings.radius
  const sp = n => Math.round(n * (DENSITY[appearance.settings.density] ?? 1))
  useEffect(() => { document.title = TITLES[path] ?? 'Docket' }, [path])

  // Live API data
  const [apiData, setApiData] = useState(null)
  const poll = useCallback(async () => {
    const data = await fetchAllData()
    setApiData(data)
  }, [])

  useEffect(() => {
    poll()
    // Fast intervals for active services
    const fast = setInterval(poll, 15000)  // 15s base refresh
    return () => clearInterval(fast)
  }, [poll])

  const serviceData = buildServiceData(apiData)

  // Search across all services
  const allServices = Object.entries(SERVICES).flatMap(([g, svcs]) => svcs.map(s => ({ ...s, group: g })))
  const filtered = query.trim()
    ? allServices.filter(s =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.desc.toLowerCase().includes(query.toLowerCase())
      )
    : null

  const mainPad = isMobile ? '14px' : isTablet ? '20px 24px' : '28px 32px'
  const minCardW = isMobile ? 140 : 220

  // Sidebar API data bundle
  const sidebarData = {
    adguard: apiData?.adguard,
    weather: apiData?.weather,
    grafana: apiData?.grafana,
    power: apiData?.power,
    network: apiData?.network,
    calendarEvents: apiData?.calendarEvents,
  }

  const topBarData = {
    plex: apiData?.plex,
    sabnzbd: apiData?.sabnzbd,
    overseerr: apiData?.overseerr,
    adguard: apiData?.adguard,
    weather: apiData?.weather,
    headscale: apiData?.health?.services?.Headscale,
  }

  return (
    <ThemeContext.Provider value={{ accent, cardRadius, isMobile, isTablet, sp }}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <AppearanceDrawer open={appearanceOpen} onClose={() => setAppearanceOpen(false)} appearance={appearance} />
      <TopBar
        accent={accent}
        isMobile={isMobile}
        isTablet={isTablet}
        navInRow={navInRow}
        onSidebarToggle={!showSidebar && path === '/' ? () => setSidebarOpen(o => !o) : null}
        apiData={topBarData}
      />
      {navInRow && <Nav accent={accent} row />}

      {path !== '/' ? (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
          {View ? <View /> : <ViewShell title="Not found" subtitle={`nothing at ${path}`} />}
        </div>
      ) : (

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: mainPad }}>
          <div style={{ marginBottom: isMobile ? 16 : 28, display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SearchBar query={query} setQuery={setQuery} scope={scope} setScope={pickScope}
                matches={{ ...matches, count: matches.count + (filtered?.length ?? 0) }}
                accent={accent} view={search.q ? view : null} setView={pickView} />
            </div>
            <button
              onClick={() => setAppearanceOpen(true)}
              title="Appearance"
              style={{
                background: appearanceOpen ? alpha(accent, '18') : alpha(C.text, '0a'),
                border: `1px solid ${appearanceOpen ? alpha(accent, '50') : C.line}`,
                borderRadius: 10, color: appearanceOpen ? accent : C.dim,
                cursor: 'pointer', width: 42, height: 42, fontSize: 16, flexShrink: 0,
              }}
            >⚙</button>
          </div>

          <UniversalResults search={search} setQuery={setQuery} accent={accent} view={view} pickView={pickView} graphSearch={graphSearch} />

          {filtered ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${minCardW}px, 1fr))`, gap: 10 }}>
                {filtered.map(s => (
                  <ServiceCard
                    key={`${s.group}-${s.name}`}
                    svc={s}
                    accent={accent}
                    cardRadius={cardRadius}
                    liveData={serviceData[s.name]}
                  />
                ))}
              </div>
              {filtered.length === 0 && (
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: C.faint, marginTop: 40, textAlign: 'center' }}>
                  no services matching "{query}"
                </div>
              )}
            </div>
          ) : (
            Object.entries(SERVICES).map(([group, svcs], gi) => (
              <GroupSection
                key={group}
                group={group}
                services={svcs}
                accent={accent}
                cardRadius={cardRadius}
                groupIndex={gi}
                minCardW={minCardW}
                liveData={serviceData}
              />
            ))
          )}
        </div>

        {/* Desktop sidebar */}
        {showSidebar && <Sidebar accent={accent} apiData={sidebarData} />}

        {/* Mobile/tablet bottom sheet */}
        {!showSidebar && sidebarOpen && (
          <>
            <div
              onClick={() => setSidebarOpen(false)}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                zIndex: 40, backdropFilter: 'blur(4px)',
              }}
            />
            <div style={{
              position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
              background: C.panel, borderTop: `1px solid ${C.line}`,
              borderRadius: '20px 20px 0 0', padding: '8px 0 0',
              maxHeight: '82vh', overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 12 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: C.line2 }} />
              </div>
              <div style={{ padding: '0 16px 24px', width: '100%' }}>
                <Sidebar accent={accent} apiData={sidebarData} />
              </div>
            </div>
          </>
        )}
      </div>
      )}
      <Toaster />
    </div>
    </ThemeContext.Provider>
  )
}
