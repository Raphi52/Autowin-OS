import { describe, expect, it } from 'vitest'
import { DeltaCollageTracker, detacherFenceCollee } from './agent-pilot'

// Migré de scripts/arena-panel/p13-pilote-fences.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062). Défaut d'origine : agent-pilot.ts recopiait l'ancienne règle de
// parité des fences — DeltaCollageTracker coupait au milieu d'un bloc ``` contenant ~~~, et
// detacherFenceCollee insérait « \n\n » dans un bloc ```` contenant ```.
const coupe = (avant: string, apres: string): string => {
  const t = new DeltaCollageTracker()
  t.separation('a', avant)
  return t.separation('b', apres)
}

describe('agent-pilot — blocs de code imbriqués', () => {
  it('DeltaCollageTracker ne coupe pas dans un bloc encore ouvert', () => {
    expect(coupe('```md\n~~~\nligne.', 'Suite')).toBe('')
    expect(coupe('````\n```\nligne.', 'Suite')).toBe('')
  })
  it('detacherFenceCollee laisse intact le contenu d’un bloc', () => {
    const imbrique = '````md\n```\nvoici.```ts\n````'
    expect(detacherFenceCollee(imbrique)).toBe(imbrique)
    const tilde = '```\n~~~\nvoici.```ts\n```'
    expect(detacherFenceCollee(tilde)).toBe(tilde)
  })
  it('les cas ordinaires sont inchangés', () => {
    expect(detacherFenceCollee('voici.```ts\nx\n```')).toBe('voici.\n\n```ts\nx\n```')
    expect(coupe('```\ncode\n```\nFin.', 'Suite')).toBe('\n\n')
    expect(coupe('```\ncode.', 'Suite')).toBe('')
  })
})
