export type Tab =
  | 'chat'
  | 'memory'
  | 'harness'
  | 'agents'
  | 'prompt'
  | 'skills'
  | 'hooks'
  | 'tools'
  | 'behaviour'
  | 'loops'

/** Tolère les anciens noms d'onglets émis par un agent (catalogue legacy). */
export function normalizeTab(t: string): Tab {
  if (t === 'memory' || t === 'graph') return 'memory'
  if (t === 'harness' || t === 'harnais') return 'harness'
  if (t === 'agents' || t === 'roles') return 'agents'
  if (t === 'prompt' || t === 'prompt-load') return 'prompt'
  if (t === 'skills' || t === 'hooks' || t === 'tools') return t
  if (t === 'behaviour' || t === 'behavior') return 'behaviour'
  if (t === 'loops' || t === 'loop') return 'loops'
  return 'chat'
}
