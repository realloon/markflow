import { MarkdownStream } from '../src/index.ts'

const unit = [
  '## Streaming benchmark',
  '',
  'A paragraph with **strong text**, *emphasis*, `inline code`, and https://example.com/docs.',
  '',
  '| name | value |',
  '| :--- | ---: |',
  '| latency | 12 |',
  '| tokens | 4096 |',
  '',
  '```ts',
  'const message = value < limit ? "fast" : "slow";',
  '```',
  '',
].join('\n')

const source = unit.repeat(Math.ceil((1024 * 1024) / unit.length))

function measure(run: () => void): string {
  run()
  const started = performance.now()
  const iterations = 5
  for (let index = 0; index < iterations; index++) run()
  const elapsed = performance.now() - started
  const mib = (source.length * iterations) / 1024 / 1024
  return `${(mib / (elapsed / 1000)).toFixed(1)} MiB/s (${(elapsed / 1000).toFixed(2)}s)`
}

const result = measure(() => {
  const stream = new MarkdownStream()
  for (let index = 0; index < source.length; index += 32) {
    stream.write(source.slice(index, index + 32))
  }
  stream.end()
})

console.log(result)
