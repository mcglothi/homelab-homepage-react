// Every link the graph stores is one directed edge, a -> b, with the label of the forward reading ("Greg manages JJ").
// From b's side the same link reads the other way ("JJ reports to Greg"). This table gives each relation both readings:
//   fwd: what a is to b (shown on a),   inv: what b is to a (shown on b),   sentence: "a <verb> b" for tooltips and the AI.
// Keyed by the edge kind and label; labels that carry a source name ("found in OmniCenter") match by pattern.
// Kinds and labels found in the backend (graph.py) and what they pair with:
//   mgr|manages           Manages / Reports to          owner|owns          Owns / Owned by
//   candidate|possible owner  Possible owner of / Possible owner      support|runs it   Runs / Run by
//   support|also routed to    Also handles / Also handled by          named|named on    Named on / Names
//   member|in inventory       Contains / In inventory                 member|assignment group  Assignment group / Assigned here
//   member|software product   Software product / Product of          member|vendor     Vendor / Vendor of
//   member|has installed      Has installed / Installed on            group|member of, has member   Has member / Member of
//   net|contains, contains subnet   Contains / In subnet              net|in subnet     Contains / In subnet
//   net|DHCP range            Has DHCP range / DHCP range of          net|IP disagrees  IP disagrees with (both ways)
//   runs|runs on host, hosts, runs on   Hosts / Runs on               runs|member of cluster   Has member / Member of cluster
//   runs|located in           Houses / Located in                     runs|desktop in pool     Has desktop / Desktop in pool
//   targets|targets           Targets / Targeted by                   calls|calls       Calls / Called by
//   ran|ran                   Had run / Run of                            describes|describes   Describes / Described by
//   about|mentions, about     Mentioned in / Mentions                 about|tracked in Docket  Tracked in Docket / Tracks
//   reported|reported         Reported / Reported by                  access|sudo access   Gives sudo to / Has sudo on
//   monitor|monitored by, logs to, backed up by, inventoried by, patched through   see below
//   found|found in <src>, part of <src>   Has a result in <src> / Found in <src>      inferred|likely pair   Likely pair with (both ways)

const T = {
  'mgr|manages': ['Manages', 'Reports to', 'manages'],
  'owner|owns': ['Owns', 'Owned by', 'owns'],
  'candidate|possible owner': ['Possible owner of', 'Possible owner', 'is a possible owner of'],
  'candidate|named in Dossier': ['Named in Dossier for', 'Named in Dossier by', 'is named in the Dossier for'],
  'support|runs it': ['Runs', 'Run by', 'runs'],
  'support|also routed to': ['Also handles', 'Also handled by', 'also handles'],
  'named|named on': ['Named on', 'Names', 'is named on'],
  'member|contains': ['Contains', 'In folder', 'contains'],
  'member|in inventory':['Contains', 'In inventory', 'contains'],
  'member|assignment group': ['Assignment group', 'Assigned here', 'is assigned to'],
  'member|prod assignment group': ['Prod assignment group', 'Assigned here (prod)', 'is prod-assigned to'],
  'member|software product': ['Software product', 'Product of', 'has the software product'],
  'member|vendor': ['Vendor', 'Vendor of', 'has the vendor'],
  'member|has installed': ['Has installed', 'Installed on', 'has installed'],
  'group|member of': ['Has member', 'Member of', 'has the member'],   // stored group -> person; the label describes the person
  'group|has member': ['Has member', 'Member of', 'has the member'],
  'net|contains': ['Contains', 'In subnet', 'contains'],
  'net|contains subnet': ['Contains subnet', 'In network', 'contains the subnet'],
  'net|in subnet': ['Contains', 'In subnet', 'contains'],
  'net|DHCP range': ['Has DHCP range', 'DHCP range of', 'has the DHCP range'],
  'net|IP disagrees': ['IP disagrees with', 'IP disagrees with', 'has a different IP than'],
  'runs|runs playbook': ['Runs', 'Run by', 'runs'],
  'uses|uses project': ['Uses', 'Used by', 'uses'],
  'uses|uses inventory': ['Uses', 'Used by', 'uses'],
  'uses|uses credential': ['Uses', 'Used by', 'uses'],
  'runs|runs on host': ['Hosts', 'Runs on', 'hosts'],
  'runs|hosts': ['Hosts', 'Runs on', 'hosts'],
  'runs|runs on': ['Hosts', 'Runs on', 'hosts'],
  'runs|member of cluster': ['Has member', 'Member of cluster', 'has the member'],
  'runs|located in': ['Houses', 'Located in', 'houses'],
  'runs|desktop in pool': ['Has desktop', 'Desktop in pool', 'has the desktop'],
  'targets|targets': ['Targets', 'Targeted by', 'targets'],
  'calls|calls': ['Calls', 'Called by', 'calls'],
  'ran|ran': ['Had run', 'Run of', 'had the run'],
  'describes|describes': ['Describes', 'Described by', 'describes'],
  'about|mentions': ['Mentioned in', 'Mentions', 'is mentioned in'],
  'about|about': ['Mentioned in', 'About', 'is mentioned in'],
  'about|tracked in Docket': ['Tracked in Docket', 'Tracks', 'is tracked in'],
  'reported|reported': ['Reported', 'Reported by', 'reported'],
  'access|sudo access': ['Gives sudo to', 'Has sudo on', 'gives sudo access to'],
  'monitor|monitored by': ['Monitored by', 'Monitors', 'is monitored by'],
  'monitor|logs to': ['Logs to', 'Receives logs from', 'logs to'],
  'monitor|backed up by': ['Backed up by', 'Backs up', 'is backed up by'],
  'monitor|inventoried by': ['Inventoried by', 'Inventories', 'is inventoried by'],
  'monitor|patched through': ['Patched through', 'Patches', 'is patched through'],
  'inferred|likely pair': ['Likely pair with', 'Likely pair with', 'is a likely pair with'],
}

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s)

// The relation of edge e, read from one end. `fromB` is true when the node being looked at is the edge's b end.
// Returns {text, sentence, weak}: text is the heading/verb for that end ("Reports to"), sentence is "manages" for a -> b.
export function relation(e, fromB) {
  const label = e.label || e.kind
  let r = T[`${e.kind}|${label}`]
  let weak = false
  if (!r) {
    const m = /^(found in|part of) (.+)$/.exec(label)
    if (m) { r = [`Has a result in ${m[2]}`, `Found in ${m[2]}`, `was found in ${m[2]}`]; weak = true }
  }
  if (!r) r = [cap(label), `${cap(label)} (from the other end)`, label]            // unknown: show the stored label, never invent a verb
  if (fromB && e.kind === 'mgr' && String(e.b).startsWith('t:')) r = ['Manages', 'Managed by', 'manages']   // a team is managed, it does not report
  return { text: fromB ? r[1] : r[0], sentence: r[2], weak: weak || e.kind === 'about' || e.kind === 'found' || e.kind === 'monitor' }
}
// "Greg Elder manages JJ Rouhana": the edge as a sentence, always in the stored direction
export const sentence = (e, an, bn) => `${an} ${relation(e, false).sentence} ${bn}`
