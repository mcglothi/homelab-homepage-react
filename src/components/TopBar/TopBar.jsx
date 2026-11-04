import { useClock } from './LiveClock'
import { PlexNowPlaying } from './PlexNowPlaying'
import { DownloadTicker } from './DownloadTicker'
import { OverseerrBadge } from './OverseerrBadge'
import { DocketMark } from './DocketMark'
import { Nav } from './Nav'
import { C, alpha } from '../../ui/theme'
import { AuthPill } from './AuthPill'

export function TopBar({ accent, isMobile, isTablet, navInRow, onSidebarToggle, apiData }) {
  const { hh, mm, ss, ampm, dateStr } = useClock()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: isMobile ? '0 16px' : '0 32px', height: 60,
      borderBottom: `1px solid ${alpha(accent, '22')}`,
      background: alpha(C.bg, 0.92), backdropFilter: 'blur(16px)',
      position: 'sticky', top: 0, zIndex: 10, gap: 8, flexShrink: 0,
    }}>
      {/* Left — Docket mark + tabs (tabs move to a row under the bar on mobile and tablet) */}
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 1, minWidth: 0 }}>
        <DocketMark accent={accent} compact={isMobile} />
        {!navInRow && <Nav accent={accent} />}
      </div>

      {/* Center — now playing + status pills */}
      {!isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0, justifyContent: 'center' }}>
          <PlexNowPlaying data={apiData?.plex} />
          {!isTablet && <DownloadTicker data={apiData?.sabnzbd} />}
          {!isTablet && <OverseerrBadge data={apiData?.overseerr} />}
        </div>
      )}

      {/* Right — status + clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20, flexShrink: 0 }}>
        {!isMobile && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Headscale's tailnet status lives in here too */}
            <AuthPill />
          </div>
        )}
        {!isMobile && (
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.dim }}>
            {dateStr}
          </span>
        )}
        <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
          <span style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: isMobile ? 18 : 22, fontWeight: 700, color: C.bright, letterSpacing: 2,
          }}>
            {hh}
            <span style={{ color: accent, animation: 'blink 1s step-end infinite' }}>:</span>
            {mm}
          </span>
          <span style={{
            fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: accent,
            alignSelf: 'flex-end', paddingBottom: 2,
          }}>{ampm}</span>
          {!isMobile && (
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.faint }}>
              .{ss}
            </span>
          )}
        </div>
        {onSidebarToggle && (
          <button
            onClick={onSidebarToggle}
            style={{
              background: alpha(C.text, 0.06), border: `1px solid ${alpha(accent, '30')}`,
              borderRadius: 8, color: accent, cursor: 'pointer',
              fontFamily: "'JetBrains Mono',monospace", fontSize: 13,
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >⊞</button>
        )}
      </div>
    </div>
  )
}
