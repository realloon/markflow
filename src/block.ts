import type {
  CodeHighlightStream,
  ResolvedMarkdownOptions,
} from './types/index.js'
import { renderInline } from './inline.js'

export interface FenceBlock {
  highlighter: CodeHighlightStream | null
  length: number
  marker: '`' | '~'
  type: 'fence'
}

interface LinesBlock {
  lines: string[]
  type: 'blockquote' | 'indented-code' | 'paragraph'
}

export interface ListBlock {
  indent: number
  kind: 'ol' | 'ul'
  lines: string[]
  start: number
  type: 'list'
}

interface TableBlock {
  alignments: Alignment[]
  type: 'table'
}

export type ActiveBlock = FenceBlock | LinesBlock | ListBlock | TableBlock
type Alignment = 'center' | 'left' | 'right' | null

export function cloneActiveBlock(
  active: ActiveBlock | null,
): ActiveBlock | null {
  if (active === null) return null

  switch (active.type) {
    case 'fence':
      return { ...active, highlighter: null }
    case 'table':
      return { ...active, alignments: [...active.alignments] }
    case 'blockquote':
    case 'indented-code':
    case 'paragraph':
    case 'list':
      return { ...active, lines: [...active.lines] }
  }
}

interface FenceOpen {
  info: string
  length: number
  marker: '`' | '~'
}

interface ListMarker {
  content: string
  indent: number
  kind: 'ol' | 'ul'
  start: number
}

export function parseFenceOpen(line: string): FenceOpen | null {
  let index = 0
  while (index < 3 && line.charAt(index) === ' ') index++

  const marker = line.charAt(index)
  if (marker !== '`' && marker !== '~') return null

  let end = index
  while (line.charAt(end) === marker) end++
  const length = end - index
  if (length < 3) return null

  const info = line.slice(end).trim()
  if (marker === '`' && info.includes('`')) return null
  return { info, length, marker }
}

export function isFenceClose(line: string, block: FenceBlock): boolean {
  let index = 0
  while (index < 3 && line.charAt(index) === ' ') index++

  const start = index
  while (line.charAt(index) === block.marker) index++
  return index - start >= block.length && line.slice(index).trim() === ''
}

export function parseListMarker(line: string): ListMarker | null {
  const unordered = /^( {0,3})[-+*](?:[ \t]+(.*)|[ \t]*)$/.exec(line)
  if (unordered) {
    return {
      content: unordered[2] ?? '',
      indent: unordered[1]!.length,
      kind: 'ul',
      start: 1,
    }
  }

  const ordered = /^( {0,3})(\d{1,9})[.)](?:[ \t]+(.*)|[ \t]*)$/.exec(line)
  if (!ordered) return null
  return {
    content: ordered[3] ?? '',
    indent: ordered[1]!.length,
    kind: 'ol',
    start: Number.parseInt(ordered[2]!, 10),
  }
}

export function parseBlockquoteLine(line: string): string | null {
  const match = /^ {0,3}>[ \t]?(.*)$/.exec(line)
  return match?.[1] ?? null
}

export function parseHeading(
  line: string,
): { content: string; level: number } | null {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line)
  if (!match) return null
  return {
    content: (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trimEnd(),
    level: match[1]!.length,
  }
}

export function setextLevel(line: string): 1 | 2 | null {
  const match = /^ {0,3}(=+|-+)[ \t]*$/.exec(line)
  if (!match) return null
  return match[1]!.charAt(0) === '=' ? 1 : 2
}

export function isThematicBreak(line: string): boolean {
  const value = line.trim().replace(/[ \t]/g, '')
  return (
    value.length >= 3 &&
    (/^\*+$/.test(value) || /^-+$/.test(value) || /^_+$/.test(value))
  )
}

export function isIndented(line: string): boolean {
  return line.startsWith('    ') || line.startsWith('\t')
}

export function stripIndent(line: string): string {
  return line.startsWith('\t') ? line.slice(1) : line.slice(4)
}

export function startsInterruptingBlock(line: string): boolean {
  const list = parseListMarker(line)
  return (
    parseFenceOpen(line) !== null ||
    parseHeading(line) !== null ||
    isThematicBreak(line) ||
    parseBlockquoteLine(line) !== null ||
    (list !== null && (list.kind === 'ul' || list.start === 1))
  )
}

function splitTableRow(line: string): string[] {
  let value = line.trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1)

  const cells: string[] = []
  let start = 0
  let backticks = 0

  for (let index = 0; index < value.length; index++) {
    const character = value.charAt(index)
    if (character === '\\') {
      index++
    } else if (character === '`') {
      let run = 1
      while (value.charAt(index + run) === '`') run++
      backticks = backticks === run ? 0 : run
      index += run - 1
    } else if (character === '|' && backticks === 0) {
      cells.push(value.slice(start, index).trim())
      start = index + 1
    }
  }

  cells.push(value.slice(start).trim())
  return cells
}

export function parseTableAlignments(
  line: string,
  header: string,
): Alignment[] | null {
  if (!line.includes('|') && !header.includes('|')) return null

  const columns = splitTableRow(line)
  const headers = splitTableRow(header)
  if (columns.length !== headers.length) return null

  const alignments: Alignment[] = []
  for (const column of columns) {
    if (!/^:?-{3,}:?$/.test(column)) return null
    alignments.push(
      column.startsWith(':') && column.endsWith(':')
        ? 'center'
        : column.startsWith(':')
          ? 'left'
          : column.endsWith(':')
            ? 'right'
            : null,
    )
  }
  return alignments
}

function alignmentAttribute(alignment: Alignment): string {
  return alignment === null ? '' : ` align="${alignment}"`
}

export function renderTableRow(
  line: string,
  tag: 'td' | 'th',
  alignments: Alignment[],
  options: ResolvedMarkdownOptions,
): string {
  const cells = splitTableRow(line)
  let html = '<tr>\n'

  for (let index = 0; index < alignments.length; index++) {
    const content = cells[index] ?? ''
    html += `<${tag}${alignmentAttribute(alignments[index] ?? null)}>${renderInline(content, options)}</${tag}>\n`
  }

  return `${html}</tr>\n`
}

interface ListItem {
  lines: string[]
  task: boolean
  checked: boolean
}

export function collectListItems(block: ListBlock, gfm: boolean): ListItem[] {
  const items: ListItem[] = []

  for (const line of block.lines) {
    const marker = parseListMarker(line)
    if (marker?.kind === block.kind && marker.indent === block.indent) {
      const task = gfm ? /^\[([ xX])\][ \t]+/.exec(marker.content) : null
      items.push({
        checked: task !== null && task[1]!.toLowerCase() === 'x',
        lines: [task ? marker.content.slice(task[0].length) : marker.content],
        task: task !== null,
      })
      continue
    }

    const item = items.at(-1)
    if (!item) continue
    item.lines.push(line === '' ? '' : line.replace(/^(?: {1,4}|\t)/, ''))
  }

  const last = items.at(-1)
  while (last?.lines.at(-1) === '') last.lines.pop()
  return items
}

export function stripTightParagraph(html: string): string {
  if (!html.startsWith('<p>')) return html
  const close = html.indexOf('</p>\n', 3)
  return close === -1 ? html : html.slice(3, close) + html.slice(close + 5)
}
