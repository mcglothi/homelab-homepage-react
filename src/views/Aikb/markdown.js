const slug = text => text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'

export function noteLink(file, href) {
  // Relative notes only: a URL that happens to end in .md (https://…/README.md) stays external
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) return null
  const [target, hash] = href.split('#', 2)
  if (!/\.md$/i.test(target)) return null
  const parts = [...(target.startsWith('/') ? [] : (file || '').split('/').slice(0, -1)), ...target.split('/')]
  const path = parts.reduce((out, part) => part === '.' || !part ? out : part === '..' ? out.slice(0, -1) : [...out, part], []).join('/')
  return `/aikb/note?path=${encodeURIComponent(path)}${hash ? `&section=${encodeURIComponent(hash)}` : ''}`
}

export function inline(text, file) {
  const out = [], re = /(`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]*\))/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ type: 'text', text: text.slice(at, m.index) })
    const v = m[0]
    if (v[0] === '`') out.push({ type: 'code', text: v.slice(1, -1) })
    else if (v.startsWith('**')) out.push({ type: 'bold', text: v.slice(2, -2) })
    else if (v[0] === '*') out.push({ type: 'italic', text: v.slice(1, -1) })
    else {
      const [, label, href] = v.match(/^\[([^\]]+)\]\(([^)]*)\)$/) || []
      out.push({ type: 'link', text: label, href, internal: noteLink(file, href) })
    }
    at = m.index + v.length
  }
  if (at < text.length) out.push({ type: 'text', text: text.slice(at) })
  return out
}

const isRule = s => /^\s*---+\s*$/.test(s)
const isTableSep = s => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s)
const cells = s => s.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim())

export function parseMarkdown(text, file = '') {
  const lines = String(text || '').replace(/\r/g, '').split('\n'), blocks = [], ids = new Map()
  let i = 0
  if (lines[0] === '---') {
    const end = lines.slice(1).indexOf('---')
    if (end >= 0) { blocks.push({ type: 'frontmatter', text: lines.slice(1, end + 1).join('\n') }); i = end + 2 }
  }
  const heading = line => line.match(/^(#{1,4})\s+(.+)$/)
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim(); i++
      const code = []; while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]); if (i < lines.length) i++
      blocks.push({ type: 'code', lang, text: code.join('\n') }); continue
    }
    const h = heading(line)
    if (h) {
      const base = slug(h[2]), n = ids.get(base) || 0; ids.set(base, n + 1)
      blocks.push({ type: 'heading', level: h[1].length, text: h[2], id: n ? `${base}-${n + 1}` : base }); i++; continue
    }
    if (isRule(line)) { blocks.push({ type: 'rule' }); i++; continue }
    if (line.startsWith('>')) {
      const quote = []; while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push({ type: 'quote', text: quote.join('\n') }); continue
    }
    if (line.includes('|') && isTableSep(lines[i + 1] || '')) {
      const head = cells(line), rows = []; i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      blocks.push({ type: 'table', head, rows }); continue
    }
    const list = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/)
    if (list) {
      const ordered = /\d+\./.test(list[2]), items = [], indent = list[1].length
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.+)$/)
        if (!m || m[1].length < indent || m[1].length > indent + 4) break
        const task = m[3].match(/^\[([ xX])\]\s+(.*)$/), item = { text: task ? task[2] : m[3], task: task ? task[1].toLowerCase() === 'x' : null }
        if (m[1].length === indent) {
          if (/\d+\./.test(m[2]) !== ordered) break
          items.push(item)
        } else if (items.length) {
          const parent = items[items.length - 1]
          parent.children ||= { ordered: /\d+\./.test(m[2]), items: [] }
          parent.children.items.push(item)
        }
        i++
      }
      blocks.push({ type: 'list', ordered, items }); continue
    }
    const para = [line]; i++
    while (i < lines.length && lines[i].trim() && !heading(lines[i]) && !lines[i].startsWith('```') && !lines[i].startsWith('>') && !lines[i].match(/^\s*([-*]|\d+\.)\s+/) && !isRule(lines[i])) para.push(lines[i++])
    blocks.push({ type: 'paragraph', text: para.join(' ') })
  }
  return blocks.map(b => ({ ...b, inline: b.text !== undefined && !['code', 'frontmatter'].includes(b.type) ? inline(b.text, file) : undefined }))
}
