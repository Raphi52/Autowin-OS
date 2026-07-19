const OPEN_TAGS = ['<cmd>', '<question>'] as const
const CLOSE_TAGS = { cmd: '</cmd>', question: '</question>' } as const
type SuppressedBlock = keyof typeof CLOSE_TAGS

function longestTagPrefixSuffix(value: string, tags: readonly string[]): number {
  const limit = Math.min(value.length, Math.max(...tags.map((tag) => tag.length)) - 1)
  for (let length = limit; length > 0; length -= 1) {
    const suffix = value.slice(-length)
    if (tags.some((tag) => tag.startsWith(suffix))) return length
  }
  return 0
}

/**
 * Incremental visibility filter for provider chunks. Control blocks stay private,
 * including when an opening or closing tag is split at any chunk boundary.
 */
export class VisibleStreamFilter {
  private buffer = ''
  private suppressed: SuppressedBlock | null = null

  push(delta: string): string {
    this.buffer += delta
    let visible = ''

    while (this.buffer) {
      if (this.suppressed) {
        const closing = CLOSE_TAGS[this.suppressed]
        const end = this.buffer.indexOf(closing)
        if (end >= 0) {
          this.buffer = this.buffer.slice(end + closing.length)
          this.suppressed = null
          continue
        }
        const keep = longestTagPrefixSuffix(this.buffer, [closing])
        this.buffer = keep ? this.buffer.slice(-keep) : ''
        break
      }

      const candidates = OPEN_TAGS.map((tag) => ({ tag, index: this.buffer.indexOf(tag) }))
        .filter((candidate) => candidate.index >= 0)
        .sort((a, b) => a.index - b.index)
      const next = candidates[0]
      if (next) {
        visible += this.buffer.slice(0, next.index)
        this.buffer = this.buffer.slice(next.index + next.tag.length)
        this.suppressed = next.tag === '<cmd>' ? 'cmd' : 'question'
        continue
      }

      const keep = longestTagPrefixSuffix(this.buffer, OPEN_TAGS)
      if (keep) {
        visible += this.buffer.slice(0, -keep)
        this.buffer = this.buffer.slice(-keep)
      } else {
        visible += this.buffer
        this.buffer = ''
      }
      break
    }

    return visible
  }

  finish(): string {
    if (this.suppressed) {
      this.buffer = ''
      return ''
    }
    const pending = this.buffer
    this.buffer = ''
    return OPEN_TAGS.some((tag) => tag.startsWith(pending)) ? '' : pending
  }
}
