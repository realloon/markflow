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

function countRun(source: string, index: number, character: string) {
  let length = 0
  while (source.charAt(index + length) === character) length++
  return length
}

export function buildInlinePairs(source: string, gfm: boolean): InlinePairs {
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
