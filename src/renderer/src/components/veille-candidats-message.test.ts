import { describe, expect, it } from 'vitest'
import {
  extraireCandidatsAffiches,
  redigerPromptFrameSelection
} from './veille-candidats-message'

/** Le panneau cases + « Enchaîner (frame) » sous un message de scout (demande du 14/08). */
const MESSAGE = [
  'Synthèse : j’ai lu cost.jsonl et le code.',
  '```json',
  '[{"type":"ajout","titre":"File de reprise groupée","url":"src/renderer/src/components/chat-home-suggestions.ts:59","dateSource":"2026-08-13","citation":"items: blocked.map((r) => ({ label: `Débloque","langue":"fr","pertinence":94},',
  ' {"type":"ajout","titre":"Cockpit des coûts","url":"src/main/index.ts:170","dateSource":"2026-08-13","citation":"appendPromptCall,","langue":"fr","pertinence":89}]',
  '```'
].join('\n')

describe('extraireCandidatsAffiches', () => {
  it('détecte la charge utile JSON du scout et rend titre/ancrage/pertinence', () => {
    const candidats = extraireCandidatsAffiches(MESSAGE)
    expect(candidats).toHaveLength(2)
    expect(candidats![0]).toMatchObject({
      titre: 'File de reprise groupée',
      url: 'src/renderer/src/components/chat-home-suggestions.ts:59',
      pertinence: 94
    })
  })

  it('ne détecte RIEN sur un message ordinaire, un JSON cassé ou une autre forme', () => {
    expect(extraireCandidatsAffiches('Un message normal sans candidats.')).toBeUndefined()
    expect(extraireCandidatsAffiches('liste [1, 2, 3] de nombres')).toBeUndefined()
    expect(extraireCandidatsAffiches('```json\n[{"titre":"sans url"}]\n```')).toBeUndefined()
    expect(extraireCandidatsAffiches('json cassé [ {"titre": ...')).toBeUndefined()
  })
})

describe('redigerPromptFrameSelection', () => {
  it('compose le /frame avec ancrages, preuves, et la consigne jusqu’au commit publié', () => {
    const candidats = extraireCandidatsAffiches(MESSAGE)!
    const prompt = redigerPromptFrameSelection(candidats)
    expect(prompt).toMatch(/^\/frame Traite ENSEMBLE ces 2 candidats/)
    expect(prompt).toContain('1. File de reprise groupée — ancrage src/renderer/src/components/chat-home-suggestions.ts:59')
    expect(prompt).toContain('pertinence 94/100')
    expect(prompt).toContain('COMMIT PUBLIÉ')
  })

  it('au singulier, le prompt reste grammatical', () => {
    const prompt = redigerPromptFrameSelection([{ titre: 'X', url: 'src/a.ts:1' }])
    expect(prompt).toMatch(/^\/frame Traite ce candidat issu/)
    expect(prompt).not.toContain('candidats issus')
  })
})
