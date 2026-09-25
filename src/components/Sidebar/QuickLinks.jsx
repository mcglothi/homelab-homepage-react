import { useState } from 'react'

const LINKS = [
  { label: 'timmcg.net', href: 'https://timmcg.net' },
  { label: 'aikb.timmcg.net', href: 'https://aikb.timmcg.net' },
  { label: 'github.com/mcglothi', href: 'https://github.com/mcglothi' },
]

export function QuickLinks({ accent }) {
  const [hovered, setHovered] = useState(null)
  return (
    <div>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: accent, letterSpacing: 3, marginBottom: 10, textTransform: 'uppercase' }}>
        Quick Links
      </div>
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
              color: hovered === l.label ? '#ccc' : '#666',
              padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${hovered === l.label ? '#ffffff15' : 'transparent'}`,
              background: hovered === l.label ? 'rgba(255,255,255,0.03)' : 'transparent',
              textDecoration: 'none', transition: 'all 0.15s', display: 'block',
            }}
          >
            → {l.label}
          </a>
        ))}
      </div>
    </div>
  )
}
