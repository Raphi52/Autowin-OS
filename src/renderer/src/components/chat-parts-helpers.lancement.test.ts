import { describe, expect, it } from 'vitest'
import { ligneEtatLancement } from './chat-parts-helpers'
import type { ChatActionPart } from './chat-view-model'

const action = (over: Partial<ChatActionPart>): ChatActionPart =>
  ({ kind: 'action', name: 'orchestrate', args: { task: 'allonger les titres' }, ...over }) as ChatActionPart

describe('ligneEtatLancement', () => {
  it('dit quoi tourne et ou, des le lancement', () => {
    const ligne = ligneEtatLancement([action({})])
    expect(ligne).toContain('Travail lancé : « allonger les titres »')
    expect(ligne).toContain('copie de travail séparée')
  })
  it("se tait des qu'un battement existe, ou une fois termine/interrompu", () => {
    expect(ligneEtatLancement([action({ progress: 'phase build' })])).toBeUndefined()
    expect(ligneEtatLancement([action({ ok: true })])).toBeUndefined()
    expect(ligneEtatLancement([action({ interrupted: true })])).toBeUndefined()
  })
  it("ignore les actions qui ne lancent pas de travail", () => {
    expect(ligneEtatLancement([action({ name: 'verify' })])).toBeUndefined()
  })
})
