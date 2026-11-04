import assert from 'node:assert/strict'
import test from 'node:test'
import { noteLink, parseMarkdown } from '../src/views/Aikb/markdown.js'

test('markdown model makes stable heading ids and safe text', () => {
  const blocks = parseMarkdown('# One\n## Two\n## Two\n<script>alert(1)</script>', 'home/a.md')
  assert.deepEqual(blocks.filter(x => x.type === 'heading').map(x => x.id), ['one', 'two', 'two-2'])
  assert.equal(blocks.at(-1).text, '<script>alert(1)</script>')
})

test('relative markdown links rewrite to note routes', () => {
  assert.equal(noteLink('home/lab/a.md', '../runbooks/zfs.md#Scrub'), '/aikb/note?path=home%2Frunbooks%2Fzfs.md&section=Scrub')
})

test('markdown model handles tables and code fences', () => {
  const blocks = parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```sh\necho hi\n```')
  assert.deepEqual(blocks[0], { type: 'table', head: ['A', 'B'], rows: [['1', '2']], inline: undefined })
  assert.equal(blocks[1].type, 'code')
  assert.equal(blocks[1].text, 'echo hi')
})

test('external and root-relative .md links', () => {
  assert.equal(noteLink('home/a.md', 'https://github.com/o/r/blob/main/README.md'), null)
  assert.equal(noteLink('home/a.md', '//example.com/x.md'), null)
  assert.equal(noteLink('home/a.md', '/ops/b.md'), '/aikb/note?path=ops%2Fb.md')
})
