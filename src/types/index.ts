export interface HighlighterStream {
  write(chunk: string): string
  end(): string
}

export interface Highlighter {
  has(language: string): boolean
  createHighlighter(language: string): HighlighterStream
}

export interface MarkdownOptions {
  /** Turn soft line breaks into `<br>`. */
  breaks?: boolean
  /** Enable tables, task lists, strikethrough, and bare URL links. */
  gfm?: boolean
  /** Pass inline HTML through unchanged. Disabled by default. */
  allowHtml?: boolean
  /** Optional streaming syntax highlighter for fenced code blocks. */
  highlighter?: Highlighter | undefined
}

export interface ResolvedMarkdownOptions {
  breaks: boolean
  gfm: boolean
  allowHtml: boolean
  highlighter: Highlighter | undefined
}

export function resolveOptions(
  options: MarkdownOptions = {},
): ResolvedMarkdownOptions {
  return {
    breaks: options.breaks ?? false,
    gfm: options.gfm ?? true,
    allowHtml: options.allowHtml ?? false,
    highlighter: options.highlighter,
  }
}
