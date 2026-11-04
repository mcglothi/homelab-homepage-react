import { createElement as h } from 'react'
import { C, MONO, SANS, alpha } from '../../ui/theme'
import { inline, parseMarkdown } from './markdown'
import { link } from '../../router'

const styles = { code: { fontFamily: MONO, fontSize: 12, background: C.field, border: `1px solid ${C.line}`, borderRadius: 7, padding: '12px', overflowX: 'auto', whiteSpace: 'pre', color: C.body },
  inline: { fontFamily: MONO, fontSize: '0.9em', background: alpha(C.text, '10'), padding: '1px 4px', borderRadius: 3, color: C.bright } }

function Inlines({ nodes }) {
  return nodes?.map((n, i) => n.type === 'text' ? n.text : n.type === 'code' ? h('code', { key: i, style: styles.inline }, n.text)
    : n.type === 'bold' ? h('strong', { key: i }, n.text) : n.type === 'italic' ? h('em', { key: i }, n.text)
      : n.internal ? h('a', { key: i, href: n.internal, onClick: link(n.internal), style: { color: C.accent } }, n.text)
        // Only web, mail and in-page links: React 18 still renders javascript: URLs
        : /^(https?:|mailto:|#)/i.test(n.href) ? h('a', { key: i, href: n.href, target: n.href.startsWith('#') ? undefined : '_blank', rel: 'noreferrer', style: { color: C.accent } }, n.text)
          : n.text)
}

function List({ ordered, items, file }) {
  return h(ordered ? 'ol' : 'ul', { style: { margin: '0 0 14px', paddingLeft: 24 } }, items.map((x, j) => h('li', { key: j }, x.task !== null ? `${x.task ? '☑' : '☐'} ` : '', h(Inlines, { nodes: inline(x.text, file) }), x.children && h(List, { ...x.children, file }))))
}

export default function Markdown({ content, file, title }) {
  // The page header already shows the title, so a leading H1 that repeats it is dropped
  const blocks = parseMarkdown(content, file), first = blocks.findIndex(b => b.type !== 'frontmatter')
  if (title && blocks[first]?.type === 'heading' && blocks[first].level === 1 && blocks[first].text.trim() === title.trim()) blocks.splice(first, 1)
  return h('div', { style: { color: C.body, fontFamily: SANS, fontSize: 15, lineHeight: 1.7, overflowWrap: 'anywhere' } }, blocks.map((b, i) => {
    if (b.type === 'frontmatter') return h('details', { key: i, style: { margin: '0 0 18px', fontFamily: MONO, fontSize: 11, color: C.dim } }, h('summary', null, 'front matter'), h('pre', { style: { ...styles.code, marginTop: 8 } }, b.text))
    if (b.type === 'heading') return h(`h${b.level}`, { key: i, id: b.id, 'data-aikb-section': b.text, style: { fontFamily: SANS, color: C.text, lineHeight: 1.2, margin: b.level === 1 ? '28px 0 12px' : '24px 0 10px', scrollMarginTop: 20, transition: 'background .2s' } }, h(Inlines, { nodes: b.inline }))
    if (b.type === 'paragraph') return h('p', { key: i, style: { margin: '0 0 14px' } }, h(Inlines, { nodes: b.inline }))
    if (b.type === 'rule') return h('hr', { key: i, style: { border: 0, borderTop: `1px solid ${C.line}`, margin: '22px 0' } })
    if (b.type === 'code') return h('pre', { key: i, style: styles.code }, b.text)
    if (b.type === 'quote') return h('blockquote', { key: i, style: { margin: '0 0 14px', padding: '4px 14px', borderLeft: `3px solid ${C.violet}`, color: C.muted } }, h(Inlines, { nodes: b.inline }))
    if (b.type === 'list') return h(List, { key: i, ...b, file })
    if (b.type === 'table') return h('div', { key: i, style: { overflowX: 'auto', marginBottom: 16 } }, h('table', { style: { borderCollapse: 'collapse', minWidth: '100%', fontSize: 13 } }, h('thead', null, h('tr', null, b.head.map((x, j) => h('th', { key: j, style: { padding: '6px 9px', textAlign: 'left', borderBottom: `1px solid ${C.line}`, color: C.text } }, h(Inlines, { nodes: inline(x, file) }))))), h('tbody', null, b.rows.map((row, j) => h('tr', { key: j }, row.map((x, k) => h('td', { key: k, style: { padding: '6px 9px', borderBottom: `1px solid ${C.line}` } }, h(Inlines, { nodes: inline(x, file) }))))))))
    return null
  }))
}
