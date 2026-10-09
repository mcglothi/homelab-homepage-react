import { link, useLocation } from '../../router'

// Docket's tabs. Home is the service grid; the rest are views fed from Turing.
export const NAV = [['Home', '/'], ['AIKB', '/aikb'], ['Watch', '/watch'], ['HA', '/ha']]

export function Nav({ accent, row }) {
  const { path: here } = useLocation()
  return (
    <nav style={row
      ? { display: 'flex', gap: 2, padding: '6px 10px', borderBottom: '1px solid #ffffff10', background: 'rgba(8,8,8,0.92)', overflowX: 'auto' }
      : { display: 'flex', gap: 2, marginLeft: 18 }}>
      {NAV.map(([label, href]) => {
        const on = href === here
        return (
          <a key={href} href={href} onClick={link(href)} style={{
            fontFamily: "'JetBrains Mono',monospace", fontSize: 11, letterSpacing: 2,
            textTransform: 'uppercase', padding: '5px 10px', borderRadius: 6, textDecoration: 'none',
            color: on ? accent : '#666', background: on ? `${accent}14` : 'transparent',
            border: `1px solid ${on ? accent + '40' : 'transparent'}`, whiteSpace: 'nowrap',
          }}>{label}</a>
        )
      })}
    </nav>
  )
}
