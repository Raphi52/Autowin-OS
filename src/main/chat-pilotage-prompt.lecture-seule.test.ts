import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt, catalogueLectureSeule } from './chat-pilotage-prompt'
import { CATALOG } from './commands'

/**
 * TOUR LECTURE SEULE : les règles d'écriture, d'orchestration, de mémoire et de redémarrage sont
 * retirées quand le catalogue ne porte QUE des commandes `readOnlyHint` (mesure du 2026-09-23 :
 * ≈ 10 500 caractères payés à chaque question pour des gestes impossibles dans ce tour).
 */
const SECTIONS_RETIREES = [
  "VERIFICATION CIBLEE AVANT L'ACTE FINAL",
  'Tu peux faire modifier le code du workspace',
  'UNE SEULE orchestration par TOUR',
  "PÉRIMÈTRE D'ÉCRITURE",
  "TU VIS DANS L'APP QUE TU PILOTES",
  'Que faire a la place',
  '2 bis. `edit_file`',
  '4. NETTOIE AVANT DE PARLER',
  'Une ECRITURE DANS UN SYSTEME EXTERNE',
  'MÉMOIRE : tu peux RETENIR',
  'INFORMATIF SPONTANÉ',
  'À DIRE HONNÊTEMENT quand tu retiens',
  'PHASE : quand tu lances',
  'DEMANDE SANS OBJET'
]

/** Ce qui sert à une simple question : ne doit JAMAIS disparaître. */
const SECTIONS_GARDEES = [
  'RÈGLE PREMIÈRE',
  'FAIT EXTERNE INCONNU',
  'PÉRIMÈTRE DE LECTURE',
  'RÈGLE ABSOLUE',
  'EXPRESSION VISUELLE',
  'POUR RELIRE',
  'AVANT DE CONSEILLER SUR UN SYSTÈME MAISON'
]

const lecture = CATALOG.filter((c) => c.annotations?.readOnlyHint)

describe('buildChatPilotagePrompt — tour lecture seule', () => {
  it('reconnaît un catalogue lecture seule, et seulement lui', () => {
    expect(catalogueLectureSeule(lecture)).toBe(true)
    expect(catalogueLectureSeule(CATALOG)).toBe(false)
    expect(catalogueLectureSeule([])).toBe(false)
  })

  it('retire les sections d’écriture, d’orchestration, de mémoire et de redémarrage', () => {
    const prompt = buildChatPilotagePrompt(lecture)
    for (const section of SECTIONS_RETIREES) expect(prompt).not.toContain(section)
    for (const section of SECTIONS_GARDEES) expect(prompt).toContain(section)
  })

  it('garde toutes les sections pour le catalogue complet', () => {
    const prompt = buildChatPilotagePrompt(CATALOG)
    for (const section of [...SECTIONS_RETIREES, ...SECTIONS_GARDEES]) {
      expect(prompt).toContain(section)
    }
  })

  it('allège réellement le tour lecture seule', () => {
    const complet = buildChatPilotagePrompt(CATALOG).length
    const leger = buildChatPilotagePrompt(lecture).length
    expect(complet - leger).toBeGreaterThan(15_000)
  })
})
