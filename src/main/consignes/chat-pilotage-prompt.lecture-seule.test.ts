import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt, catalogueLectureSeule } from './chat-pilotage-prompt'
import { CATALOG } from '../commands/commands'
import { CONSTITUTION } from './constitution'

/**
 * TOUR LECTURE SEULE : les règles d'écriture, d'orchestration, de mémoire et de redémarrage sont
 * retirées quand le catalogue ne porte QUE des commandes `readOnlyHint` (mesure du 2026-09-23 :
 * ≈ 10 500 caractères payés à chaque question pour des gestes impossibles dans ce tour).
 */
const SECTIONS_RETIREES = [
  "VERIFICATION CIBLEE AVANT L'ACTE FINAL",
  'Oui → correction ponctuelle',
  'UNE SEULE orchestration par TOUR',
  "PÉRIMÈTRE D'ÉCRITURE",
  "TU VIS DANS L'APP QUE TU PILOTES",
  'tu le FAIS toi-meme avec `restart_app`',
  '1 bis. `edit_file`',
  'Une ECRITURE DANS UN SYSTEME EXTERNE',
  'MÉMOIRE : retiens avec `remember`',
  'INFORMATIF SPONTANÉ',
  'POUR LES AUTRES, c’est un CANDIDAT',
  'PHASE : quand tu lances',
  'DEMANDE SANS OBJET'
]

/** Ce qui sert à une simple question : ne doit JAMAIS disparaître. */
const SECTIONS_GARDEES = [
  'RÈGLE PREMIÈRE',
  'PÉRIMÈTRE DE LECTURE',
  'RÈGLE ABSOLUE',
  'EXPRESSION VISUELLE',
  'NOTES PROCHES',
  'à préférer à une exploration du repo quand la question porte sur un acquis',
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

  // « Fait externe inconnu » vit au réflexe 8 de la constitution, servie à chaque tour du chat,
  // lecture seule comprise : une simple question garde la recherche web avant de conclure.
  it('garde la recherche web d’un fait public, désormais dans la constitution', () => {
    expect(CONSTITUTION).toMatch(/Un fait public[^\n]*se cherche sur le web avant de conclure/u)
    expect(buildChatPilotagePrompt(lecture)).not.toContain('FAIT EXTERNE INCONNU')
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
