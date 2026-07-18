import type {
  CodeHighlightStream,
  MarkdownOptions,
  ResolvedMarkdownOptions,
} from './types/index.js'
import { escapeAttribute, escapeHtml } from './escape.js'
import { renderInline } from './inline.js'
import { resolveOptions } from './types/index.js'

interface FenceBlock {
  highlighter: CodeHighlightStream | null
  length: number
  marker: '`' | '~'
  type: 'fence'
}

interface LinesBlock {
  lines: string[]
  type: 'blockquote' | 'indented-code' | 'paragraph'
}

interface ListBlock {
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

type ActiveBlock = FenceBlock | LinesBlock | ListBlock | TableBlock
type Alignment = 'center' | 'left' | 'right' | null

function cloneActiveBlock(active: ActiveBlock | null): ActiveBlock | null {
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

function parseFenceOpen(line: string): FenceOpen | null {
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

function isFenceClose(line: string, block: FenceBlock): boolean {
  let index = 0
  while (index < 3 && line.charAt(index) === ' ') index++

  const start = index
  while (line.charAt(index) === block.marker) index++
  return index - start >= block.length && line.slice(index).trim() === ''
}

function parseListMarker(line: string): ListMarker | null {
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

function parseBlockquoteLine(line: string): string | null {
  const match = /^ {0,3}>[ \t]?(.*)$/.exec(line)
  return match?.[1] ?? null
}

function parseHeading(line: string): { content: string; level: number } | null {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line)
  if (!match) return null
  return {
    content: (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trimEnd(),
    level: match[1]!.length,
  }
}

function setextLevel(line: string): 1 | 2 | null {
  const match = /^ {0,3}(=+|-+)[ \t]*$/.exec(line)
  if (!match) return null
  return match[1]!.charAt(0) === '=' ? 1 : 2
}

function isThematicBreak(line: string): boolean {
  const value = line.trim().replace(/[ \t]/g, '')
  return (
    value.length >= 3 &&
    (/^\*+$/.test(value) || /^-+$/.test(value) || /^_+$/.test(value))
  )
}

function isIndented(line: string): boolean {
  return line.startsWith('    ') || line.startsWith('\t')
}

function stripIndent(line: string): string {
  return line.startsWith('\t') ? line.slice(1) : line.slice(4)
}

function startsInterruptingBlock(line: string): boolean {
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

function parseTableAlignments(
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

function renderTableRow(
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

function collectListItems(block: ListBlock, gfm: boolean): ListItem[] {
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

function stripTightParagraph(html: string): string {
  if (!html.startsWith('<p>')) return html
  const close = html.indexOf('</p>\n', 3)
  return close === -1 ? html : html.slice(3, close) + html.slice(close + 5)
}

/** Incremental parser for progressively rendered Markdown. */
export class MarkdownStream {
  private active: ActiveBlock | null = null
  private depth = 0
  private ended = false
  private readonly lineParts: string[] = []
  private readonly options: ResolvedMarkdownOptions
  private output = ''

  constructor(options: MarkdownOptions = {}) {
    this.options = resolveOptions(options)
  }

  /** Complete HTML snapshot, including a preview of the unfinished block. */
  get html(): string {
    if (this.ended) return this.output

    const preview = new MarkdownStream(this.options)
    preview.active = cloneActiveBlock(this.active)
    preview.depth = this.depth
    preview.lineParts.push(...this.lineParts)
    return this.output + preview.end()
  }

  write(chunk: string): string {
    if (this.ended)
      throw new Error('Cannot write after the Markdown stream has ended')
    if (typeof chunk !== 'string')
      throw new TypeError('Markdown chunk must be a string')
    if (chunk.length === 0) return ''

    const output: string[] = []
    let start = 0
    let newline = chunk.indexOf('\n')

    while (newline !== -1) {
      const part = chunk.slice(start, newline)
      const line =
        this.lineParts.length === 0 ? part : this.consumeLineParts(part)
      output.push(
        this.consumeLine(line.endsWith('\r') ? line.slice(0, -1) : line),
      )
      start = newline + 1
      newline = chunk.indexOf('\n', start)
    }

    if (start < chunk.length) this.lineParts.push(chunk.slice(start))
    const html = output.join('')
    this.output += html
    return html
  }

  end(chunk = ''): string {
    if (typeof chunk !== 'string')
      throw new TypeError('Markdown chunk must be a string')
    const output: string[] = []
    if (chunk.length > 0) output.push(this.write(chunk))
    if (this.ended) throw new Error('Markdown stream has already ended')

    const tail: string[] = []
    if (this.lineParts.length > 0) {
      const line = this.consumeLineParts('')
      tail.push(
        this.consumeLine(line.endsWith('\r') ? line.slice(0, -1) : line),
      )
    }

    tail.push(this.finishActive())
    const tailHtml = tail.join('')
    this.output += tailHtml
    output.push(tailHtml)
    this.ended = true
    return output.join('')
  }

  reset(): void {
    this.active = null
    this.depth = 0
    this.ended = false
    this.lineParts.length = 0
    this.output = ''
  }

  private consumeLineParts(last: string): string {
    this.lineParts.push(last)
    const line = this.lineParts.join('')
    this.lineParts.length = 0
    return line
  }

  private consumeLine(line: string): string {
    let output = ''
    let reprocess = true

    while (reprocess) {
      reprocess = false
      const active = this.active

      if (active?.type === 'fence') {
        if (isFenceClose(line, active)) {
          output += active.highlighter?.finish() ?? ''
          this.active = null
          output += '</code></pre>\n'
        } else {
          output +=
            active.highlighter?.write(`${line}\n`) ?? `${escapeHtml(line)}\n`
        }
        continue
      }

      if (active?.type === 'table') {
        const isRow =
          line !== '' && (active.alignments.length === 1 || line.includes('|'))
        if (isRow && (line.includes('|') || !startsInterruptingBlock(line))) {
          output += renderTableRow(line, 'td', active.alignments, this.options)
        } else {
          output += this.finishActive()
          reprocess = true
        }
        continue
      }

      if (active?.type === 'paragraph') {
        const level = active.lines.length === 1 ? setextLevel(line) : null
        if (level !== null) {
          this.active = null
          output += `<h${level}>${renderInline(active.lines[0]!, this.options)}</h${level}>\n`
          continue
        }

        const alignments =
          active.lines.length === 1 && this.options.gfm
            ? parseTableAlignments(line, active.lines[0]!)
            : null
        if (alignments) {
          this.active = { alignments, type: 'table' }
          output += `<table>\n<thead>\n${renderTableRow(active.lines[0]!, 'th', alignments, this.options)}</thead>\n<tbody>\n`
        } else if (line === '') {
          output += this.finishActive()
        } else if (startsInterruptingBlock(line)) {
          output += this.finishActive()
          reprocess = true
        } else {
          active.lines.push(line)
        }
        continue
      }

      if (active?.type === 'blockquote') {
        const content = parseBlockquoteLine(line)
        if (content !== null) {
          active.lines.push(content)
        } else if (line !== '' && !startsInterruptingBlock(line)) {
          active.lines.push(line)
        } else {
          output += this.finishActive()
          reprocess = true
        }
        continue
      }

      if (active?.type === 'list') {
        const marker = parseListMarker(line)
        if (
          line === '' ||
          (marker?.kind === active.kind && marker.indent === active.indent) ||
          (marker !== null && marker.indent > active.indent) ||
          isIndented(line)
        ) {
          active.lines.push(line)
        } else if (
          !startsInterruptingBlock(line) &&
          active.lines.at(-1) !== ''
        ) {
          active.lines.push(line)
        } else {
          output += this.finishActive()
          reprocess = true
        }
        continue
      }

      if (active?.type === 'indented-code') {
        if (line === '') {
          active.lines.push('')
        } else if (isIndented(line)) {
          active.lines.push(stripIndent(line))
        } else {
          output += this.finishActive()
          reprocess = true
        }
        continue
      }

      if (line === '') continue

      const fence = parseFenceOpen(line)
      if (fence) {
        const language = fence.info.split(/[ \t]+/, 1)[0] ?? ''
        const className =
          language === ''
            ? ''
            : ` class="language-${escapeAttribute(language)}"`
        const highlighter =
          language !== '' && this.options.codeHighlighter?.has(language)
            ? this.options.codeHighlighter.createHighlighter(language)
            : null
        this.active = {
          highlighter,
          length: fence.length,
          marker: fence.marker,
          type: 'fence',
        }
        output += `<pre><code${className}>`
        continue
      }

      const heading = parseHeading(line)
      if (heading) {
        output += `<h${heading.level}>${renderInline(heading.content, this.options)}</h${heading.level}>\n`
        continue
      }

      if (isThematicBreak(line)) {
        output += '<hr>\n'
        continue
      }

      const quote = parseBlockquoteLine(line)
      if (quote !== null) {
        this.active = { lines: [quote], type: 'blockquote' }
        continue
      }

      const list = parseListMarker(line)
      if (list) {
        this.active = {
          indent: list.indent,
          kind: list.kind,
          lines: [line],
          start: list.start,
          type: 'list',
        }
        continue
      }

      if (isIndented(line)) {
        this.active = { lines: [stripIndent(line)], type: 'indented-code' }
        continue
      }

      this.active = { lines: [line], type: 'paragraph' }
    }

    return output
  }

  private finishActive(): string {
    const active = this.active
    if (!active) return ''
    this.active = null

    switch (active.type) {
      case 'paragraph':
        return `<p>${renderInline(active.lines.join('\n'), this.options)}</p>\n`
      case 'blockquote':
        return `<blockquote>\n${this.renderNested(active.lines.join('\n'))}</blockquote>\n`
      case 'list':
        return this.renderList(active)
      case 'indented-code': {
        const value = active.lines.join('\n').replace(/\n+$/, '')
        return `<pre><code>${escapeHtml(value)}\n</code></pre>\n`
      }
      case 'table':
        return '</tbody>\n</table>\n'
      case 'fence':
        return `${active.highlighter?.finish() ?? ''}</code></pre>\n`
    }
  }

  private renderList(block: ListBlock): string {
    const items = collectListItems(block, this.options.gfm)
    const hasTasks = this.options.gfm && items.some(item => item.task)
    const loose = items.some(item => item.lines.includes(''))
    const listClass = hasTasks ? ' class="task-list"' : ''
    const start =
      block.kind === 'ol' && block.start !== 1 ? ` start="${block.start}"` : ''
    let html = `<${block.kind}${start}${listClass}>\n`

    for (const item of items) {
      const itemClass =
        item.task && this.options.gfm ? ' class="task-list-item"' : ''
      const checkbox =
        item.task && this.options.gfm
          ? `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> `
          : ''
      let body = this.renderNested(item.lines.join('\n'))
      if (checkbox !== '') {
        body = body.startsWith('<p>')
          ? `<p>${checkbox}${body.slice(3)}`
          : checkbox + body
      }

      html += loose
        ? `<li${itemClass}>\n${body}</li>\n`
        : `<li${itemClass}>${stripTightParagraph(body)}</li>\n`
    }

    return `${html}</${block.kind}>\n`
  }

  private renderNested(source: string): string {
    if (this.depth >= 32)
      throw new RangeError('Markdown nesting exceeds 32 levels')
    const stream = new MarkdownStream(this.options)
    stream.depth = this.depth + 1
    return stream.end(source)
  }
}

export function markdownToHtml(
  markdown: string,
  options: MarkdownOptions = {},
): string {
  if (typeof markdown !== 'string')
    throw new TypeError('Markdown input must be a string')
  return new MarkdownStream(options).end(markdown)
}
