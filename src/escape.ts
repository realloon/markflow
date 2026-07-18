const HTML_REPLACEMENTS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}

const ATTRIBUTE_REPLACEMENTS: Record<string, string> = {
  ...HTML_REPLACEMENTS,
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, character => HTML_REPLACEMENTS[character]!)
}

export function escapeAttribute(value: string) {
  return value.replace(
    /[&<>"']/g,
    character => ATTRIBUTE_REPLACEMENTS[character]!,
  )
}
