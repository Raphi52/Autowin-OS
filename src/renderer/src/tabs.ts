export type Tab =
  'chat' | 'memory' | 'observatory' | 'router' | 'agents' | 'capabilities' | 'behaviour'

/** Tolère les anciens noms d'onglets émis par un agent (catalogue legacy). */
export function normalizeTab(t: string): Tab {
  if (t === 'memory' || t === 'graph') return 'memory'
  if (
    t === 'observatory' ||
    t === 'observatoire' ||
    t === 'harness' ||
    t === 'harnais' ||
    t === 'prompt' ||
    t === 'prompt-load'
  )
    return 'observatory'
  if (t === 'agents' || t === 'roles') return 'agents'
  if (t === 'router' || t === 'routeur' || t === 'omniroute') return 'router'
  if (t === 'skills' || t === 'hooks' || t === 'tools' || t === 'capabilities')
    return 'capabilities'
  if (t === 'behaviour' || t === 'behavior') return 'behaviour'
  return 'chat'
}
