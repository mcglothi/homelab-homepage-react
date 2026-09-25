import { useState, useEffect, useCallback } from 'react'
import { useWindowSize } from './hooks/useWindowSize'
import { TopBar } from './components/TopBar/TopBar'
import { SearchBar } from './components/Services/SearchBar'
import { GroupSection } from './components/Services/GroupSection'
import { ServiceCard } from './components/Services/ServiceCard'
import { Sidebar } from './components/Sidebar/Sidebar'
import { SERVICES } from './services'
import { fetchAllData } from './api/index.js'

const ACCENT_DEFAULT = '#ff2d6b'
const BG_DEFAULT = '#080808'

const ACCENT_PRESETS = [
  { color: '#ff2d6b', label: 'Pink' },
  { color: '#00fff7', label: 'Cyan' },
  { color: '#bf5fff', label: 'Violet' },
  { color: '#39ff5a', label: 'Green' },
  { color: '#2979ff', label: 'Blue' },
  { color: '#ffab00', label: 'Amber' },
  { color: '#ff6b35', label: 'Orange' },
]

const BG_PRESETS = [
  { color: '#080808', label: 'Black' },
  { color: '#060d1a', label: 'Navy' },
  { color: '#0c0814', label: 'Purple' },
  { color: '#0e0e0e', label: 'Charcoal' },
  { color: '#061414', label: 'Teal' },
]

// Map live API data to per-service detail overrides
function buildServiceData(apiData) {
  if (!apiData) return {}
  return {
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
}

export default function App() {
  const { w } = useWindowSize()
  const isMobile = w < 640
  const isTablet = w >= 640 && w < 1024
  const showSidebar = w >= 1024

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [tweaksOpen, setTweaksOpen] = useState(false)

  // Persisted preferences
  const [accent, setAccent] = useState(() => localStorage.getItem('accent') ?? ACCENT_DEFAULT)
  const [bg, setBg] = useState(() => localStorage.getItem('bg') ?? BG_DEFAULT)
  const [cardRadius, setCardRadius] = useState(() => parseInt(localStorage.getItem('cardRadius') ?? '12'))
  const [dotGrid, setDotGrid] = useState(() => localStorage.getItem('dotGrid') !== 'false')
  const [glowIntensity, setGlowIntensity] = useState(() => parseFloat(localStorage.getItem('glowIntensity') ?? '1'))

  useEffect(() => { localStorage.setItem('accent', accent) }, [accent])
  useEffect(() => { localStorage.setItem('bg', bg) }, [bg])
  useEffect(() => { localStorage.setItem('cardRadius', cardRadius) }, [cardRadius])
  useEffect(() => { localStorage.setItem('dotGrid', dotGrid) }, [dotGrid])
  useEffect(() => { localStorage.setItem('glowIntensity', glowIntensity) }, [glowIntensity])

  // Apply bg to body
  useEffect(() => { document.body.style.background = bg }, [bg])

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
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: bg }}>
      {/* Bottom-right bloom */}
      <div style={{
        position: 'fixed', bottom: -180, right: -180, width: 600, height: 600, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent}07 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 0,
      }} />
      {/* Top-left bloom */}
      <div style={{
        position: 'fixed', top: -200, left: -200, width: 700, height: 700, borderRadius: '50%',
        background: `radial-gradient(circle, ${accent}08 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 0,
      }} />

      <TopBar
        accent={accent}
        isMobile={isMobile}
        isTablet={isTablet}
        onSidebarToggle={!showSidebar ? () => setSidebarOpen(o => !o) : null}
        apiData={topBarData}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: mainPad }}>
          <div style={{ marginBottom: isMobile ? 16 : 28, display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <SearchBar query={query} setQuery={setQuery} resultCount={filtered?.length ?? 0} accent={accent} />
            </div>
            <button
              onClick={() => setTweaksOpen(o => !o)}
              title="Appearance"
              style={{
                background: tweaksOpen ? `${accent}18` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${tweaksOpen ? accent + '50' : '#ffffff10'}`,
                borderRadius: 10, color: tweaksOpen ? accent : '#555',
                cursor: 'pointer', width: 42, height: 42, fontSize: 16, flexShrink: 0,
              }}
            >⚙</button>
          </div>

          {/* Tweaks panel */}
          {tweaksOpen && (
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: `1px solid ${accent}30`,
              borderRadius: 12, padding: '16px 20px', marginBottom: 24,
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                {/* Accent */}
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', letterSpacing: 1, marginBottom: 8 }}>ACCENT</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {ACCENT_PRESETS.map(p => (
                      <button
                        key={p.color}
                        onClick={() => setAccent(p.color)}
                        title={p.label}
                        style={{
                          width: 22, height: 22, borderRadius: '50%', background: p.color, border: 'none',
                          cursor: 'pointer', outline: accent === p.color ? `2px solid ${p.color}` : 'none',
                          outlineOffset: 2, boxShadow: accent === p.color ? `0 0 8px ${p.color}` : 'none',
                        }}
                      />
                    ))}
                  </div>
                </div>
                {/* Background */}
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', letterSpacing: 1, marginBottom: 8 }}>BACKGROUND</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {BG_PRESETS.map(p => (
                      <button
                        key={p.color}
                        onClick={() => setBg(p.color)}
                        title={p.label}
                        style={{
                          width: 22, height: 22, borderRadius: '50%', background: p.color,
                          border: `1px solid ${bg === p.color ? '#fff' : '#333'}`,
                          cursor: 'pointer', outline: bg === p.color ? '2px solid #ffffff60' : 'none',
                          outlineOffset: 2,
                        }}
                      />
                    ))}
                  </div>
                </div>
                {/* Card radius */}
                <div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', letterSpacing: 1, marginBottom: 8 }}>
                    RADIUS: {cardRadius}px
                  </div>
                  <input
                    type="range" min={0} max={24} value={cardRadius}
                    onChange={e => setCardRadius(parseInt(e.target.value))}
                    style={{ width: 100, accentColor: accent }}
                  />
                </div>
                {/* Dot grid toggle */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, color: '#444', letterSpacing: 1 }}>DOT GRID</div>
                  <button
                    onClick={() => setDotGrid(v => !v)}
                    style={{
                      fontFamily: "'JetBrains Mono',monospace", fontSize: 10,
                      background: dotGrid ? `${accent}20` : 'transparent',
                      border: `1px solid ${dotGrid ? accent : '#333'}`,
                      color: dotGrid ? accent : '#555',
                      borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                    }}
                  >{dotGrid ? 'on' : 'off'}</button>
                </div>
              </div>
            </div>
          )}

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
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#444', marginTop: 40, textAlign: 'center' }}>
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
              background: '#0d0d0d', borderTop: '1px solid #ffffff14',
              borderRadius: '20px 20px 0 0', padding: '8px 0 0',
              maxHeight: '82vh', overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 12 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: '#333' }} />
              </div>
              <div style={{ padding: '0 16px 24px', width: '100%' }}>
                <Sidebar accent={accent} apiData={sidebarData} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
