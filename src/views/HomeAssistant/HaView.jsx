import { C, MONO } from '../../ui/theme'
import { Card, Columns, ViewShell } from '../bits'

// Placeholder until the Home Assistant feed exists. Plan: the proxy calls HA's REST
// API with a long-lived token (from Bitwarden into .env) and this tab shows a curated
// set of entities — not a copy of HA's own dashboards.
export default function HaView() {
  return (
    <ViewShell title="Home Assistant" subtitle="coming next">
      <Columns>
        <Card title="Planned">
          <div style={{ fontFamily: MONO, fontSize: 11, color: C.body, lineHeight: 1.8 }}>
            A handful of curated tiles (presence, climate, doors/locks, energy, anything alerting),<br />
            each linking into HA for the full view. Needs: HA URL + a long-lived access token in Bitwarden.
          </div>
        </Card>
      </Columns>
    </ViewShell>
  )
}
