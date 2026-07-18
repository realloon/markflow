import type { ResolvedMarkdownOptions } from './types/index.js'
import { escapeAttribute, escapeHtml } from './escape.js'

const ENTITY = /^&(?:#[0-9]{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i
const EMAIL =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i
const HTML_TAG = /^(?:<!--[\s\S]*-->|<\/?[A-Za-z][^<>]*>)$/
const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/

function countRun(source: string, index: number, character: string): number {
  let length = 0
  while (source.charAt(index + length) === character) length++
  return length
}

interface DelimiterPair {
  close: number
  length: number
}

interface InlinePairs {
  brackets: Map<number, number>
  code: Map<number, DelimiterPair>
  emphasis: Map<number, DelimiterPair>
  strike: Map<number, DelimiterPair>
}

interface DelimiterQueue {
  head: number
  items: number[]
}

function buildInlinePairs(source: string, gfm: boolean): InlinePairs {
  const brackets = new Map<number, number>()
  const code = new Map<number, DelimiterPair>()
  const emphasis = new Map<number, DelimiterPair>()
  const strike = new Map<number, DelimiterPair>()
  const bracketStack: number[] = []
  const codeOpeners = new Map<number, number>()
  const emphasisOpeners = new Map<string, DelimiterQueue>()
  const strikeOpeners: DelimiterQueue = { head: 0, items: [] }

  const pairOrQueue = (
    queue: DelimiterQueue,
    pairs: Map<number, DelimiterPair>,
    index: number,
    length: number,
    canOpen: boolean,
    canClose: boolean,
  ): void => {
    if (canClose && queue.head < queue.items.length) {
      pairs.set(queue.items[queue.head++]!, { close: index, length })
    } else if (canOpen) {
      queue.items.push(index)
    }
  }

  for (let index = 0; index < source.length; index++) {
    const character = source.charAt(index)
    if (character === '\\') {
      index++
      continue
    }

    if (character === '[') {
      bracketStack.push(index)
      continue
    }
    if (character === ']') {
      const open = bracketStack.pop()
      if (open !== undefined) brackets.set(open, index)
      continue
    }

    if (character === '`') {
      const length = countRun(source, index, character)
      const open = codeOpeners.get(length)
      if (open === undefined) codeOpeners.set(length, index)
      else {
        code.set(open, { close: index, length })
        codeOpeners.delete(length)
      }
      index += length - 1
      continue
    }

    if (character === '*' || character === '_') {
      const length = countRun(source, index, character)
      if (length <= 3) {
        const previous = source.charAt(index - 1)
        const next = source.charAt(index + length)
        const insideWord =
          character === '_' &&
          /[A-Za-z0-9]/.test(previous) &&
          /[A-Za-z0-9]/.test(next)
        const canOpen = !insideWord && next !== '' && !/\s/.test(next)
        const canClose = !insideWord && previous !== '' && !/\s/.test(previous)
        const queueFor = (size: number): DelimiterQueue => {
          const key = character + size
          const queue = emphasisOpeners.get(key) ?? { head: 0, items: [] }
          emphasisOpeners.set(key, queue)
          return queue
        }

        if (length < 3) {
          pairOrQueue(
            queueFor(length),
            emphasis,
            index,
            length,
            canOpen,
            canClose,
          )
        } else {
          let offset = 0
          let remaining = 3

          if (canClose) {
            while (remaining > 0) {
              let selectedLength = 0
              let selectedPosition = -1
              for (let size = 1; size <= Math.min(2, remaining); size++) {
                const queue = queueFor(size)
                const position = queue.items[queue.head]
                if (position !== undefined && position > selectedPosition) {
                  selectedLength = size
                  selectedPosition = position
                }
              }
              if (selectedLength === 0) break

              const queue = queueFor(selectedLength)
              emphasis.set(queue.items[queue.head++]!, {
                close: index + offset,
                length: selectedLength,
              })
              offset += selectedLength
              remaining -= selectedLength
            }
          }

          if (canOpen && remaining > 0) {
            if (remaining === 3) {
              queueFor(1).items.push(index)
              queueFor(2).items.push(index + 1)
            } else {
              queueFor(remaining).items.push(index + offset)
            }
          }
        }
      }
      index += length - 1
      continue
    }

    if (gfm && character === '~') {
      const length = countRun(source, index, character)
      if (length === 2) {
        const previous = source.charAt(index - 1)
        const next = source.charAt(index + length)
        pairOrQueue(
          strikeOpeners,
          strike,
          index,
          length,
          next !== '' && !/\s/.test(next),
          previous !== '' && !/\s/.test(previous),
        )
      }
      index += length - 1
    }
  }

  return { brackets, code, emphasis, strike }
}

function findClosingParenthesis(source: string, open: number): number {
  let depth = 0

  for (let index = open + 1; index < source.length; index++) {
    const character = source.charAt(index)
    if (character === '\\') {
      index++
    } else if (character === '(') {
      depth++
    } else if (character === ')') {
      if (depth === 0) return index
      depth--
    }
  }

  return -1
}

interface LinkDestination {
  end: number
  title: string | undefined
  url: string
}

function parseLinkDestination(
  source: string,
  open: number,
): LinkDestination | null {
  const end = findClosingParenthesis(source, open)
  if (end === -1) return null

  const body = source.slice(open + 1, end)
  const match =
    /^\s*(?:<([^>\n]+)>|(\S+?))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/.exec(
      body,
    )
  if (!match) return null

  const url = (match[1] ?? match[2] ?? '').replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    '$1',
  )
  const title = match[3] ?? match[4] ?? match[5]
  return { end: end + 1, title, url }
}

function safeUrl(url: string): string | null {
  const value = url.trim()
  let probe = value.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase()

  try {
    probe = decodeURIComponent(probe)
  } catch {
    // A malformed percent escape is not a scheme bypass, so the literal URL is safe to inspect.
  }

  const colon = probe.indexOf(':')
  const boundary = probe.search(/[/?#]/)
  if (colon !== -1 && (boundary === -1 || colon < boundary)) {
    const scheme = probe.slice(0, colon)
    if (
      scheme !== 'http' &&
      scheme !== 'https' &&
      scheme !== 'mailto' &&
      scheme !== 'tel'
    ) {
      return null
    }
  }

  return value
}

function normalizeCodeSpan(value: string): string {
  const normalized = value.replace(/\n/g, ' ')
  if (
    normalized.length > 2 &&
    normalized.startsWith(' ') &&
    normalized.endsWith(' ') &&
    /[^ ]/.test(normalized)
  ) {
    return normalized.slice(1, -1)
  }
  return normalized
}

function plainLabel(value: string): string {
  return value
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1')
    .replace(/[*_~`]/g, '')
}

function trimBareUrl(value: string): string {
  let end = value.length
  while (end > 0 && /[.,!?;:]/.test(value.charAt(end - 1))) end--

  while (end > 0 && value.charAt(end - 1) === ')') {
    const candidate = value.slice(0, end)
    const opens = (candidate.match(/\(/g) ?? []).length
    const closes = (candidate.match(/\)/g) ?? []).length
    if (closes <= opens) break
    end--
  }

  return value.slice(0, end)
}

function renderBareUrl(
  source: string,
  index: number,
): { end: number; html: string } | null {
  const prefix = source.startsWith('https://', index)
    ? 'https://'
    : source.startsWith('http://', index)
      ? 'http://'
      : source.startsWith('www.', index)
        ? 'www.'
        : null
  if (!prefix || (index > 0 && !/[\s([{'" ]/.test(source.charAt(index - 1))))
    return null

  let end = index + prefix.length
  while (end < source.length && !/[\s<>]/.test(source.charAt(end))) end++
  const label = trimBareUrl(source.slice(index, end))
  if (label.length === prefix.length) return null

  const href = prefix === 'www.' ? `https://${label}` : label
  return {
    end: index + label.length,
    html: `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>`,
  }
}

function renderRange(
  source: string,
  options: ResolvedMarkdownOptions,
  depth: number,
): string {
  if (depth > 32) return escapeHtml(source)

  const pairs = buildInlinePairs(source, options.gfm)
  const output: string[] = []
  let index = 0
  let textStart = 0

  const flushText = (end: number): void => {
    if (end > textStart) output.push(escapeHtml(source.slice(textStart, end)))
  }

  while (index < source.length) {
    const character = source.charAt(index)

    if (character === '\\') {
      const next = source.charAt(index + 1)
      if (next === '\n' || PUNCTUATION.test(next)) {
        flushText(index)
        output.push(next === '\n' ? '<br>\n' : escapeHtml(next))
        index += 2
        textStart = index
        continue
      }
    }

    if (character === '\n') {
      let contentEnd = index
      while (contentEnd > textStart && source.charAt(contentEnd - 1) === ' ')
        contentEnd--
      const hardBreak = index - contentEnd >= 2
      flushText(hardBreak ? contentEnd : index)
      output.push(hardBreak || options.breaks ? '<br>\n' : '\n')
      index++
      textStart = index
      continue
    }

    if (character === '`') {
      const pair = pairs.code.get(index)
      if (pair) {
        flushText(index)
        output.push(
          `<code>${escapeHtml(normalizeCodeSpan(source.slice(index + pair.length, pair.close)))}</code>`,
        )
        index = pair.close + pair.length
        textStart = index
        continue
      }
    }

    if (
      (character === '!' && source.charAt(index + 1) === '[') ||
      character === '['
    ) {
      const image = character === '!'
      const open = image ? index + 1 : index
      const close = pairs.brackets.get(open)
      if (close !== undefined && source.charAt(close + 1) === '(') {
        const destination = parseLinkDestination(source, close + 1)
        const href = destination ? safeUrl(destination.url) : null
        if (destination && href !== null) {
          const label = source.slice(open + 1, close)
          const title =
            destination.title === undefined
              ? ''
              : ` title="${escapeAttribute(destination.title)}"`
          flushText(index)
          output.push(
            image
              ? `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(plainLabel(label))}"${title}>`
              : `<a href="${escapeAttribute(href)}"${title}>${renderRange(label, options, depth + 1)}</a>`,
          )
          index = destination.end
          textStart = index
          continue
        }
      }
    }

    if (character === '<') {
      const close = source.indexOf('>', index + 1)
      if (close !== -1 && !source.slice(index, close).includes('\n')) {
        const token = source.slice(index, close + 1)
        const inner = token.slice(1, -1)
        const href = safeUrl(inner)
        let html: string | null = null

        if (/^(?:https?|mailto):/i.test(inner) && href !== null) {
          html = `<a href="${escapeAttribute(href)}">${escapeHtml(inner)}</a>`
        } else if (EMAIL.test(inner)) {
          html = `<a href="mailto:${escapeAttribute(inner)}">${escapeHtml(inner)}</a>`
        } else if (options.allowHtml && HTML_TAG.test(token)) {
          html = token
        }

        if (html !== null) {
          flushText(index)
          output.push(html)
          index = close + 1
          textStart = index
          continue
        }
      }
    }

    if (options.gfm && character === '~' && source.charAt(index + 1) === '~') {
      const pair = pairs.strike.get(index)
      if (pair && pair.close > index + pair.length) {
        flushText(index)
        output.push(
          `<del>${renderRange(source.slice(index + pair.length, pair.close), options, depth + 1)}</del>`,
        )
        index = pair.close + pair.length
        textStart = index
        continue
      }
    }

    if (character === '*' || character === '_') {
      const pair = pairs.emphasis.get(index)
      if (pair && pair.close > index + pair.length) {
        const content = renderRange(
          source.slice(index + pair.length, pair.close),
          options,
          depth + 1,
        )
        flushText(index)
        output.push(
          pair.length === 3
            ? `<em><strong>${content}</strong></em>`
            : pair.length === 2
              ? `<strong>${content}</strong>`
              : `<em>${content}</em>`,
        )
        index = pair.close + pair.length
        textStart = index
        continue
      }
    }

    if (character === '&') {
      const entity = ENTITY.exec(source.slice(index))
      if (entity) {
        flushText(index)
        output.push(entity[0])
        index += entity[0].length
        textStart = index
        continue
      }
    }

    if (options.gfm && (character === 'h' || character === 'w')) {
      const bareUrl = renderBareUrl(source, index)
      if (bareUrl) {
        flushText(index)
        output.push(bareUrl.html)
        index = bareUrl.end
        textStart = index
        continue
      }
    }

    index++
  }

  flushText(source.length)
  return output.join('')
}

export function renderInline(
  source: string,
  options: ResolvedMarkdownOptions,
): string {
  return renderRange(source, options, 0)
}
