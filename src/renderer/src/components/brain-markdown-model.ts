export type Frontmatter = {
  body: string
  entries: Array<{ key: string; value: string }>
}

export function splitFrontmatter(source: string): Frontmatter {
  const normalized = source.replace(/^\uFEFF/, '')
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(normalized)
  if (!match) return { body: normalized, entries: [] }
  const entries = match[1]
    .split(/\r?\n/)
    .map((line) => /^([\w-]+):\s*(.+)$/.exec(line))
    .filter((entry): entry is RegExpExecArray => entry !== null)
    .map((entry) => ({ key: entry[1], value: entry[2].replace(/^['"]|['"]$/g, '') }))
  return { body: normalized.slice(match[0].length), entries }
}
