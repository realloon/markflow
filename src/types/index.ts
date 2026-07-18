export interface MarkdownOptions {
  /** Turn soft line breaks into `<br>`. */
  breaks?: boolean
  /** Enable tables, task lists, strikethrough, and bare URL links. */
  gfm?: boolean
  /** Pass inline HTML through unchanged. Disabled by default. */
  allowHtml?: boolean
}

export interface ResolvedMarkdownOptions {
  breaks: boolean
  gfm: boolean
  allowHtml: boolean
}

export function resolveOptions(
  options: MarkdownOptions = {},
): ResolvedMarkdownOptions {
  return {
    breaks: options.breaks ?? false,
    gfm: options.gfm ?? true,
    allowHtml: options.allowHtml ?? false,
  }
}
