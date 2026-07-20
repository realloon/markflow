import { describe, expect, test } from 'bun:test'
import { markdownToHtml, MarkdownStream } from '../src/index.ts'

describe('markdownToHtml', () => {
  test('renders block and inline Markdown', () => {
    const markdown = [
      '# Hello **world**',
      '',
      'Paragraph with *emphasis*, ~~old text~~, and `code`.',
      '',
      '> quoted',
      '> line',
      '',
      '---',
    ].join('\n')

    expect(markdownToHtml(markdown)).toBe(
      '<h1>Hello <strong>world</strong></h1>\n' +
        '<p>Paragraph with <em>emphasis</em>, <del>old text</del>, and <code>code</code>.</p>\n' +
        '<blockquote>\n<p>quoted\nline</p>\n</blockquote>\n' +
        '<hr>\n',
    )
  })

  test('renders links, images, autolinks, and line breaks', () => {
    expect(
      markdownToHtml(
        '[site](https://example.com "Example") ![logo](/logo.png)  \n<mail@example.com> www.example.com',
      ),
    ).toBe(
      '<p><a href="https://example.com" title="Example">site</a> ' +
        '<img src="/logo.png" alt="logo"><br>\n' +
        '<a href="mailto:mail@example.com">mail@example.com</a> ' +
        '<a href="https://www.example.com">www.example.com</a></p>\n',
    )
  })

  test('supports nested emphasis delimiter runs', () => {
    expect(markdownToHtml('**outer *inner*** and ***both***')).toBe(
      '<p><strong>outer <em>inner</em></strong> and <em><strong>both</strong></em></p>\n',
    )
  })

  test('renders fenced and indented code', () => {
    expect(markdownToHtml('```ts\nconst ok = 1 < 2;\n```\n\n    <tag>')).toBe(
      '<pre><code class="language-ts">const ok = 1 &lt; 2;\n</code></pre>\n' +
        '<pre><code>&lt;tag&gt;\n</code></pre>\n',
    )
  })

  test('streams complete fenced-code lines through a syntax highlighter', () => {
    const writes: string[] = []
    let ends = 0
    const highlighter = {
      has: (language: string) => language === 'demo',
      createHighlighter: () => ({
        write(chunk: string) {
          writes.push(chunk)
          return `<mark>${chunk}</mark>`
        },
        end() {
          ends++
          return ''
        },
      }),
    }
    const stream = new MarkdownStream({ highlighter })

    stream.write('```demo\npartial')
    expect(writes).toEqual([])
    expect(stream.html).toBe(
      '<pre><code class="language-demo">partial\n</code></pre>\n',
    )
    expect(ends).toBe(0)

    stream.write(' line\nnext')
    expect(writes).toEqual(['partial line\n'])
    expect(stream.html).toBe(
      '<pre><code class="language-demo"><mark>partial line\n</mark>next\n</code></pre>\n',
    )
    expect(ends).toBe(0)

    expect(stream.end()).toBe('<mark>next\n</mark></code></pre>\n')
    expect(writes).toEqual(['partial line\n', 'next\n'])
    expect(ends).toBe(1)

    expect(
      markdownToHtml('```unknown\nplain <code>\n```', { highlighter }),
    ).toBe(
      '<pre><code class="language-unknown">plain &lt;code&gt;\n</code></pre>\n',
    )
  })

  test('renders ordered, nested, and GFM task lists', () => {
    expect(
      markdownToHtml(
        '3. three\n4. four\n\n- parent\n  - child\n\n- [x] done\n- [ ] todo',
      ),
    ).toBe(
      '<ol start="3">\n<li>three</li>\n<li>four</li>\n</ol>\n' +
        '<ul class="task-list">\n' +
        '<li>\n<p>parent</p>\n<ul>\n<li>child</li>\n</ul>\n</li>\n' +
        '<li class="task-list-item">\n<p><input type="checkbox" disabled checked> done</p>\n</li>\n' +
        '<li class="task-list-item">\n<p><input type="checkbox" disabled> todo</p>\n</li>\n' +
        '</ul>\n',
    )
  })

  test('renders GFM tables', () => {
    expect(markdownToHtml('Name | Value\n:--- | ---:\nA | **1**\nB | 2')).toBe(
      '<table>\n<thead>\n<tr>\n' +
        '<th align="left">Name</th>\n<th align="right">Value</th>\n' +
        '</tr>\n</thead>\n<tbody>\n<tr>\n' +
        '<td align="left">A</td>\n<td align="right"><strong>1</strong></td>\n' +
        '</tr>\n<tr>\n' +
        '<td align="left">B</td>\n<td align="right">2</td>\n' +
        '</tr>\n</tbody>\n</table>\n',
    )
  })

  test('supports Setext headings and CRLF', () => {
    expect(markdownToHtml('Heading\r\n=======\r\n\r\ntext\r\n')).toBe(
      '<h1>Heading</h1>\n<p>text</p>\n',
    )
  })

  test('escapes HTML and blocks unsafe URL schemes by default', () => {
    expect(
      markdownToHtml('<script>alert("x")</script>\n\n[x](javascript:alert(1))'),
    ).toBe(
      '<p>&lt;script&gt;alert("x")&lt;/script&gt;</p>\n' +
        '<p>[x](javascript:alert(1))</p>\n',
    )
    expect(markdownToHtml('<b>trusted</b>', { allowHtml: true })).toBe(
      '<p><b>trusted</b></p>\n',
    )
    expect(markdownToHtml('[x](javascript%3Aalert(1))')).toBe(
      '<p>[x](javascript%3Aalert(1))</p>\n',
    )
  })

  test('can disable GFM extensions', () => {
    expect(markdownToHtml('~~text~~\n\n- [x] literal', { gfm: false })).toBe(
      '<p>~~text~~</p>\n<ul>\n<li>[x] literal</li>\n</ul>\n',
    )
  })
})

describe('MarkdownStream', () => {
  const fixture = [
    '# Stream',
    '',
    'A **paragraph** split anywhere.',
    '',
    '| A | B |',
    '| :--- | ---: |',
    '| 1 | 2 |',
    '',
    '```ts',
    'const result = a < b;',
    '```',
    '',
    '- one',
    '- two',
  ].join('\r\n')

  test('is invariant across every small chunk size', () => {
    const expected = markdownToHtml(fixture)

    for (let size = 1; size <= 19; size++) {
      const stream = new MarkdownStream()
      let actual = ''
      for (let index = 0; index < fixture.length; index += size) {
        actual += stream.write(fixture.slice(index, index + size))
      }
      actual += stream.end()
      expect(actual, `chunk size ${size}`).toBe(expected)
    }
  })

  test('emits completed structures without waiting for the stream end', () => {
    const stream = new MarkdownStream()
    expect(stream.write('# Title')).toBe('')
    expect(stream.write('\n\nA paragraph')).toBe('<h1>Title</h1>\n')
    expect(stream.write('\n\n```ts\n')).toBe(
      '<p>A paragraph</p>\n<pre><code class="language-ts">',
    )
    expect(stream.write('1 < 2\n')).toBe('1 &lt; 2\n')
    expect(stream.end('```')).toBe('</code></pre>\n')
  })

  test('exposes complete HTML snapshots for progressive UI rendering', () => {
    const stream = new MarkdownStream()

    stream.write('# Hel')
    expect(stream.html).toBe('<h1>Hel</h1>\n')

    stream.write('lo\n\nA **partial')
    expect(stream.html).toBe('<h1>Hello</h1>\n<p>A **partial</p>\n')

    stream.write('** paragraph')
    expect(stream.html).toBe(
      '<h1>Hello</h1>\n<p>A <strong>partial</strong> paragraph</p>\n',
    )
    expect(stream.end()).toBe('<p>A <strong>partial</strong> paragraph</p>\n')
    expect(stream.html).toBe(
      '<h1>Hello</h1>\n<p>A <strong>partial</strong> paragraph</p>\n',
    )

    const code = new MarkdownStream()
    code.write('```ts\nconst value')
    expect(code.html).toBe(
      '<pre><code class="language-ts">const value\n</code></pre>\n',
    )
  })

  test('rejects invalid lifecycle operations and can be reset', () => {
    const stream = new MarkdownStream()
    expect(stream.end('text')).toBe('<p>text</p>\n')
    expect(() => stream.write('more')).toThrow('Cannot write')
    expect(() => stream.end()).toThrow('already ended')
    stream.reset()
    expect(stream.end('again')).toBe('<p>again</p>\n')
  })
})
