import { useState } from 'react'
import { C, alpha } from '../../ui/theme'
import { SectionHeader, useCollapsed } from './Section'

const LINKS = [
  { label: 'timmcg.net', href: 'https://timmcg.net' },
  { label: 'aikb.timmcg.net', href: 'https://aikb.timmcg.net' },
  { label: 'github.com/mcglothi', href: 'https://github.com/mcglothi' },
]

export function QuickLinks({ accent }) {
  const collapsed = useCollapsed('Quick Links')
  const [hovered, setHovered] = useState(null)
  return (
    <div>
      <SectionHeader id="Quick Links" accent={accent} title="Quick Links" />
      {!collapsed && (<>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {LINKS.map(l => (
          <a
            key={l.label}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            onMouseEnter={() => setHovered(l.label)}
            onMouseLeave={() => setHovered(null)}
            style={{
              fontFamily: "'JetBrains Mono',monospace", fontSize: 12,
              color: hovered === l.label ? C.body : C.muted,
              padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${hovered === l.label ? alpha(C.text, '15') : 'transparent'}`,
              background: hovered === l.label ? alpha(C.text, 0.03) : 'transparent',
              textDecoration: 'none', transition: 'all 0.15s', display: 'block',
            }}
          >
            → {l.label}
          </a>
        ))}
      </div>
      </>)}
    </div>
  )
}
