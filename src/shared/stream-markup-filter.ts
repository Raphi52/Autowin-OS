const CONTROL = [
  { open: '<cmd>', close: '</cmd>', control: 'cmd' },
  { open: '<question>', close: '</question>', control: 'question' }
] as const
type ControlSpec = (typeof CONTROL)[number]
const OPEN_TAGS = CONTROL.map((spec) => spec.open)
type SuppressedBlock = ControlSpec['control']
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
 * Un bloc de contrôle n'est SUPPRIMÉ que s'il est réellement une commande : ouvert ET fermé ET
 * contenant du JSON objet valide. Une balise `<cmd>` CITÉE en prose (non fermée, ou fermée mais
 * contenu non-JSON) reste du TEXTE VISIBLE — sinon le message est tronqué dès qu'on mentionne la
 * balise pour l'expliquer (bug « t'as pas fini ta phrase », conv-57).
 */
function isSuppressibleCommand(inner: string): boolean {
  try {
    const parsed: unknown = JSON.parse(inner.trim())
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

/**
 * Incremental visibility filter for provider chunks. A real command block stays private (even split
 * across chunk boundaries); a mentioned/unclosed/invalid tag stays visible.
 */
export class VisibleStreamFilter {
  private buffer = ''
  private active: ControlSpec | null = null

  push(delta: string): string {
    return this.textOf(this.pushSegments(delta))
  }

  pushSegments(delta: string): VisibleStreamSegment[] {
    this.buffer += delta
    const segments: VisibleStreamSegment[] = []

    while (this.buffer) {
      if (this.active) {
        const { open, close, control } = this.active
        const end = this.buffer.indexOf(close)
        if (end < 0) break // pas encore fermé → on bufferise, on attend la suite
        const inner = this.buffer.slice(0, end)
        if (isSuppressibleCommand(inner)) segments.push({ kind: 'control', control })
        else segments.push({ kind: 'text', text: open + inner + close })
        this.buffer = this.buffer.slice(end + close.length)
        this.active = null
        continue
      }

      const candidates = CONTROL.map((spec) => ({ spec, index: this.buffer.indexOf(spec.open) }))
        .filter((candidate) => candidate.index >= 0)
        .sort((a, b) => a.index - b.index)
      const next = candidates[0]
      if (next) {
        const visible = this.buffer.slice(0, next.index)
        if (visible) segments.push({ kind: 'text', text: visible })
        this.buffer = this.buffer.slice(next.index + next.spec.open.length)
        this.active = next.spec
        continue
      }

      const keep = longestTagPrefixSuffix(this.buffer, OPEN_TAGS)
      if (keep) {
        const visible = this.buffer.slice(0, -keep)
        if (visible) segments.push({ kind: 'text', text: visible })
        this.buffer = this.buffer.slice(-keep)
      } else {
        segments.push({ kind: 'text', text: this.buffer })
        this.buffer = ''
      }
      break
    }

    return segments
  }

  finish(): string {
    return this.textOf(this.finishSegments())
  }

  finishSegments(): VisibleStreamSegment[] {
    const pending = this.buffer
    this.buffer = ''
    if (this.active) {
      const { open } = this.active
      this.active = null
      // Balise jamais fermée : si le contenu COMMENCE une charge JSON (`{`/`[`) ou est vide, c'est
      // une commande RÉELLE tronquée (stream coupé) → on la masque (jamais de markup brut exposé).
      // Sinon c'est une balise CITÉE en prose → on rend le texte intact.
      const head = pending.trimStart()
      if (head === '' || head.startsWith('{') || head.startsWith('[')) return []
      return [{ kind: 'text', text: open + pending }]
    }
    if (!pending) return []
    // Un préfixe d'ouverture partiel en toute fin (ex. "<cm") est abandonné, jamais exposé nu.
    return OPEN_TAGS.some((tag) => tag.startsWith(pending))
      ? []
      : [{ kind: 'text', text: pending }]
  }

  private textOf(segments: VisibleStreamSegment[]): string {
    return segments
      .filter(
        (segment): segment is Extract<VisibleStreamSegment, { kind: 'text' }> =>
          segment.kind === 'text'
      )
      .map((segment) => segment.text)
      .join('')
  }
}
