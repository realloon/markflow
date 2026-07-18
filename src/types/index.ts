export interface CodeHighlightStream {
  write(chunk: string): string
  finish(): string
}

export interface CodeHighlighter {
  has(language: string): boolean
  createHighlighter(language: string): CodeHighlightStream
}

export interface MarkdownOptions {
  /** Turn soft line breaks into `<br>`. */
  breaks?: boolean
  /** Enable tables, task lists, strikethrough, and bare URL links. */
  gfm?: boolean
  /** Pass inline HTML through unchanged. Disabled by default. */
  allowHtml?: boolean
  /** Optional streaming syntax highlighter for fenced code blocks. */
  codeHighlighter?: CodeHighlighter | undefined
}

export interface ResolvedMarkdownOptions {
  breaks: boolean
  gfm: boolean
  allowHtml: boolean
  codeHighlighter: CodeHighlighter | undefined
}

export function resolveOptions(
  options: MarkdownOptions = {},
): ResolvedMarkdownOptions {
  return {
    breaks: options.breaks ?? false,
    gfm: options.gfm ?? true,
    allowHtml: options.allowHtml ?? false,
    codeHighlighter: options.codeHighlighter,
  }
}
