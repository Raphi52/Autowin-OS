import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ImportedModel } from '../models'
import { ConversationStore } from '../store/conversations'
import { modeleDuTour, validerModeleDeConversation } from './modele-de-conversation'

/**
 * LE MODÈLE APPARTIENT À LA CONVERSATION (conv-239, 2026-10-11).
 *
 * Trois exigences : le store le MÉMORISE (et l'oublie proprement), le choix est VALIDÉ contre le
 * catalogue, et le lancement d'un tour l'APPLIQUE — sans ce dernier point le choix serait un décor.
 */
const catalogue: ImportedModel[] = [
  {
    id: 'claude/claude-opus-5-5',
    provider: 'claude',
    model: 'claude-opus-5-5',
    label: 'Opus 5.5',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'high'
  },
  {
    id: 'codex/gpt-5.6-terra',
    provider: 'codex',
    model: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    reasoningEfforts: ['low', 'high'],
    defaultReasoningEffort: 'high'
  }
]

describe('ConversationStore — modèle par conversation', () => {
  const clock = (): (() => number) => {
    let t = 1000
    return () => t++
  }

  it('mémorise le modèle choisi, et l’efface sur null', () => {
    const store = new ConversationStore(clock())
    const conv = store.create({ title: 'A', provider: 'claude' })
    const avant = store.get(conv.id)?.updatedAt

    const retenu = store.choisirModele(conv.id, {
      provider: 'codex',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'low'
    })
    expect(retenu?.modeleChoisi).toEqual({
      provider: 'codex',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'low'
    })
    // Choisir un modèle n'est pas travailler : l'ordre de la liste ne bouge pas.
    expect(store.get(conv.id)?.updatedAt).toBe(avant)
    expect(store.choisirModele(conv.id, null)?.modeleChoisi).toBeUndefined()
    expect('modeleChoisi' in (store.get(conv.id) as object)).toBe(false)
  })

  it('ne touche que la conversation nommée', () => {
    const store = new ConversationStore(clock())
    const a = store.create({ title: 'A', provider: 'claude' })
    const b = store.create({ title: 'B', provider: 'claude' })
    store.choisirModele(a.id, { provider: 'codex', model: 'gpt-5.6-terra' })
    expect(store.get(b.id)?.modeleChoisi).toBeUndefined()
  })

  it('rend undefined sur un id inconnu plutôt que de jeter', () => {
    const store = new ConversationStore(clock())
    expect(store.choisirModele('conv-inconnue', { provider: 'codex' })).toBeUndefined()
  })
})

describe('modeleDuTour', () => {
  it('sans choix propre, le tour suit le modèle par défaut', () => {
    expect(modeleDuTour(undefined, catalogue)).toEqual({ kind: 'defaut' })
  })

  it('un choix disponible part tel quel, effort compris', () => {
    expect(
      modeleDuTour({ provider: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'low' }, catalogue)
    ).toEqual({
      kind: 'choisi',
      binding: { provider: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'low' }
    })
  })

  it('un modèle retiré du catalogue est SIGNALÉ, pas avalé', () => {
    const verdict = modeleDuTour({ provider: 'codex', model: 'gpt-disparu' }, catalogue)
    expect(verdict.kind).toBe('indisponible')
    expect(verdict.kind === 'indisponible' && verdict.motif).toMatch(/gpt-disparu/)
  })

  it('un effort que le modèle ne sert pas est refusé', () => {
    expect(() =>
      validerModeleDeConversation(
        { provider: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
        catalogue
      )
    ).toThrow(/Effort indisponible/)
  })
})

describe('câblage', () => {
  const index = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
  const roles = readFileSync(join(process.cwd(), 'src/main/ipc/roles.ts'), 'utf8')

  it('le lancement d’un tour applique le modèle de la conversation', () => {
    const wrapper = index.slice(index.indexOf('const tourCompteDesReception: typeof lancerTour'))
    // Jusqu'au VRAI départ du tour (le premier `lancerTour(...args)` est le cas sans conversation).
    const corps = wrapper.slice(0, wrapper.indexOf('await lancerTour(...args)'))
    expect(corps).toContain('modeleDuTour(')
    // Un modèle imposé par l'appelant (reprise d'un tour) prime sur le choix du fil.
    expect(corps).toMatch(/args\[3\] === undefined/)
  })

  it('le canal d’écriture valide contre le catalogue AVANT d’écrire', () => {
    const canal = roles.slice(roles.indexOf("'os:conversations:setModel'"))
    expect(canal.indexOf('validerModeleDeConversation(')).toBeGreaterThan(-1)
    // Seul l'effacement (`null`) écrit sans valider ; un modèle n'est écrit qu'APRÈS validation.
    expect(canal.indexOf('validerModeleDeConversation(')).toBeLessThan(
      canal.indexOf('choisirModele(rawId, binding)')
    )
  })
})
