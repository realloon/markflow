import type { ActiveBlock, ListBlock } from './block.js'
import {
  cloneActiveBlock,
  collectListItems,
  isFenceClose,
  isIndented,
  isThematicBreak,
  parseBlockquoteLine,
  parseFenceOpen,
  parseHeading,
  parseListMarker,
  parseTableAlignments,
  renderTableRow,
  setextLevel,
  startsInterruptingBlock,
  stripIndent,
  stripTightParagraph,
} from './block.js'
import type { MarkdownOptions, ResolvedMarkdownOptions } from './types/index.js'
import { escapeAttribute, escapeHtml } from './escape.js'
import { renderInline } from './inline.js'
import { resolveOptions } from './types/index.js'

/** Incremental parser for progressively rendered Markdown. */
export class MarkdownStream {
  #active: ActiveBlock | null = null
  #depth = 0
  #ended = false
  readonly #lineParts: string[] = []
  readonly #options: ResolvedMarkdownOptions
  #output = ''

  constructor(options: MarkdownOptions = {}) {
    this.#options = resolveOptions(options)
  }

  /** Complete HTML snapshot, including a preview of the unfinished block. */
  get html() {
    if (this.#ended) return this.#output

    const preview = new MarkdownStream(this.#options)
    preview.#active = cloneActiveBlock(this.#active)
    preview.#depth = this.#depth
    preview.#lineParts.push(...this.#lineParts)
    return this.#output + preview.end()
  }

  write(chunk: string) {
    if (this.#ended) {
      throw new Error('Cannot write after the Markdown stream has ended')
    }

    if (chunk.length === 0) return ''

    const output: string[] = []
    let start = 0
    let newline = chunk.indexOf('\n')

    while (newline !== -1) {
      const part = chunk.slice(start, newline)
      const line =
        this.#lineParts.length === 0 ? part : this.#consumeLineParts(part)
      output.push(
        this.#consumeLine(line.endsWith('\r') ? line.slice(0, -1) : line),
      )
      start = newline + 1
      newline = chunk.indexOf('\n', start)
    }

    if (start < chunk.length) this.#lineParts.push(chunk.slice(start))
    const html = output.join('')
    this.#output += html
    return html
  }

  end(chunk = '') {
    const output: string[] = []
    if (chunk.length > 0) output.push(this.write(chunk))
    if (this.#ended) throw new Error('Markdown stream has already ended')

    const tail: string[] = []
    if (this.#lineParts.length > 0) {
      const line = this.#consumeLineParts('')
      tail.push(
        this.#consumeLine(line.endsWith('\r') ? line.slice(0, -1) : line),
      )
    }

    tail.push(this.#finishActive())
    const tailHtml = tail.join('')
    this.#output += tailHtml
    output.push(tailHtml)
    this.#ended = true
    return output.join('')
  }

  reset() {
    this.#active = null
    this.#depth = 0
    this.#ended = false
    this.#lineParts.length = 0
    this.#output = ''
  }

  #consumeLineParts(last: string) {
    this.#lineParts.push(last)
    const line = this.#lineParts.join('')
    this.#lineParts.length = 0
    return line
  }

  #consumeLine(line: string) {
    let output = ''
    let reprocess = true

    while (reprocess) {
      reprocess = false
      const active = this.#active

      if (active?.type === 'fence') {
        if (isFenceClose(line, active)) {
          output += active.highlighter?.finish() ?? ''
          this.#active = null
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
          output += renderTableRow(line, 'td', active.alignments, this.#options)
        } else {
          output += this.#finishActive()
          reprocess = true
        }
        continue
      }

      if (active?.type === 'paragraph') {
        const level = active.lines.length === 1 ? setextLevel(line) : null
        if (level !== null) {
          this.#active = null
          output += `<h${level}>${renderInline(active.lines[0]!, this.#options)}</h${level}>\n`
          continue
        }

        const alignments =
          active.lines.length === 1 && this.#options.gfm
            ? parseTableAlignments(line, active.lines[0]!)
            : null
        if (alignments) {
          this.#active = { alignments, type: 'table' }
          output += `<table>\n<thead>\n${renderTableRow(active.lines[0]!, 'th', alignments, this.#options)}</thead>\n<tbody>\n`
        } else if (line === '') {
          output += this.#finishActive()
        } else if (startsInterruptingBlock(line)) {
          output += this.#finishActive()
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
          output += this.#finishActive()
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
          output += this.#finishActive()
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
          output += this.#finishActive()
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
          language !== '' && this.#options.highlighter?.has(language)
            ? this.#options.highlighter.createHighlighter(language)
            : null
        this.#active = {
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
        output += `<h${heading.level}>${renderInline(heading.content, this.#options)}</h${heading.level}>\n`
        continue
      }

      if (isThematicBreak(line)) {
        output += '<hr>\n'
        continue
      }

      const quote = parseBlockquoteLine(line)
      if (quote !== null) {
        this.#active = { lines: [quote], type: 'blockquote' }
        continue
      }

      const list = parseListMarker(line)
      if (list) {
        this.#active = {
          indent: list.indent,
          kind: list.kind,
          lines: [line],
          start: list.start,
          type: 'list',
        }
        continue
      }

      if (isIndented(line)) {
        this.#active = { lines: [stripIndent(line)], type: 'indented-code' }
        continue
      }

      this.#active = { lines: [line], type: 'paragraph' }
    }

    return output
  }

  #finishActive() {
    const active = this.#active
    if (!active) return ''
    this.#active = null

    switch (active.type) {
      case 'paragraph':
        return `<p>${renderInline(active.lines.join('\n'), this.#options)}</p>\n`
      case 'blockquote':
        return `<blockquote>\n${this.#renderNested(active.lines.join('\n'))}</blockquote>\n`
      case 'list':
        return this.#renderList(active)
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

  #renderList(block: ListBlock) {
    const items = collectListItems(block, this.#options.gfm)
    const hasTasks = this.#options.gfm && items.some(item => item.task)
    const loose = items.some(item => item.lines.includes(''))
    const listClass = hasTasks ? ' class="task-list"' : ''
    const start =
      block.kind === 'ol' && block.start !== 1 ? ` start="${block.start}"` : ''
    let html = `<${block.kind}${start}${listClass}>\n`

    for (const item of items) {
      const itemClass =
        item.task && this.#options.gfm ? ' class="task-list-item"' : ''
      const checkbox =
        item.task && this.#options.gfm
          ? `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> `
          : ''
      let body = this.#renderNested(item.lines.join('\n'))
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

  #renderNested(source: string) {
    if (this.#depth >= 32)
      throw new RangeError('Markdown nesting exceeds 32 levels')
    const stream = new MarkdownStream(this.#options)
    stream.#depth = this.#depth + 1
    return stream.end(source)
  }
}

export function markdownToHtml(
  markdown: string,
  options: MarkdownOptions = {},
) {
  return new MarkdownStream(options).end(markdown)
}
