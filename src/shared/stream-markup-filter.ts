const OPEN_TAGS = ['<cmd>', '<question>'] as const
const CLOSE_TAGS = { cmd: '</cmd>', question: '</question>' } as const
type SuppressedBlock = keyof typeof CLOSE_TAGS
export type VisibleStreamSegment =
  { kind: 'text'; text: string } | { kind: 'control'; control: SuppressedBlock }

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
    return this.pushSegments(delta)
      .filter(
        (segment): segment is Extract<VisibleStreamSegment, { kind: 'text' }> =>
          segment.kind === 'text'
      )
      .map((segment) => segment.text)
      .join('')
  }

  pushSegments(delta: string): VisibleStreamSegment[] {
    this.buffer += delta
    const segments: VisibleStreamSegment[] = []

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
        const visible = this.buffer.slice(0, next.index)
        if (visible) segments.push({ kind: 'text', text: visible })
        this.buffer = this.buffer.slice(next.index + next.tag.length)
        this.suppressed = next.tag === '<cmd>' ? 'cmd' : 'question'
        segments.push({ kind: 'control', control: this.suppressed })
        continue
      }

      const keep = longestTagPrefixSuffix(this.buffer, OPEN_TAGS)
      if (keep) {
        const visible = this.buffer.slice(0, -keep)
        if (visible) segments.push({ kind: 'text', text: visible })
        this.buffer = this.buffer.slice(-keep)
      } else {
        if (this.buffer) segments.push({ kind: 'text', text: this.buffer })
        this.buffer = ''
      }
      break
    }

    return segments
  }

  finish(): string {
    return this.finishSegments()
      .filter(
        (segment): segment is Extract<VisibleStreamSegment, { kind: 'text' }> =>
          segment.kind === 'text'
      )
      .map((segment) => segment.text)
      .join('')
  }

  finishSegments(): VisibleStreamSegment[] {
    if (this.suppressed) {
      this.buffer = ''
      return []
    }
    const pending = this.buffer
    this.buffer = ''
    return OPEN_TAGS.some((tag) => tag.startsWith(pending)) || !pending
      ? []
      : [{ kind: 'text', text: pending }]
  }
}
