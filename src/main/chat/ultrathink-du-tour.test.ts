import { describe, expect, it } from 'vitest'
import type { ImportedModel } from '../modeles/models'
import type { RoleBinding } from '../profil/roles'
import { bindingAvecUltrathink } from './ultrathink-du-tour'

const modele = (over: Partial<ImportedModel>): ImportedModel =>
  ({
    id: 'claude/opus-test',
    provider: 'claude',
    model: 'opus-test',
    label: 'Opus test',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
    ...over
  }) as ImportedModel

const liste = [
  modele({}),
  modele({
    id: 'codex/gpt-test',
    provider: 'codex',
    model: 'gpt-test',
    reasoningEfforts: ['low', 'medium', 'high']
  }),
  modele({ id: 'grok/grok-test', provider: 'grok', model: 'grok-test', reasoningEfforts: ['none'] })
]
const catalogue = (): ImportedModel[] => liste

describe('bindingAvecUltrathink — le réglage du tour quand le message porte le mot-clé', () => {
  const chat: RoleBinding = { provider: 'claude', model: 'opus-test', reasoningEffort: 'medium' }

  it('sans le mot-clé, rend le réglage tel quel sans lire le catalogue', () => {
    const jamaisLu = (): never => {
      throw new Error('catalogue lu sans mot-clé')
    }
    expect(bindingAvecUltrathink(chat, 'corrige ce défaut', jamaisLu)).toBe(chat)
  })

  it('avec le mot-clé, monte ce tour à xhigh sans toucher au réglage reçu', () => {
    const tour = bindingAvecUltrathink(chat, 'ultrathink corrige ce défaut', catalogue)
    expect(tour).toEqual({ provider: 'claude', model: 'opus-test', reasoningEffort: 'xhigh' })
    expect(chat.reasoningEffort).toBe('medium')
  })

  it('garde un réglage déjà plus haut', () => {
    const max: RoleBinding = { ...chat, reasoningEffort: 'max' }
    expect(bindingAvecUltrathink(max, 'ultrathink', catalogue)).toBe(max)
  })

  it('prend le plus haut niveau du modèle quand il ne propose pas xhigh', () => {
    const codex: RoleBinding = { provider: 'codex', model: 'gpt-test', reasoningEffort: 'low' }
    expect(bindingAvecUltrathink(codex, 'ultrathink', catalogue).reasoningEffort).toBe('high')
  })

  it('ne change rien pour un modèle sans réglage de réflexion', () => {
    const grok: RoleBinding = { provider: 'grok', model: 'grok-test' }
    expect(bindingAvecUltrathink(grok, 'ultrathink', catalogue)).toBe(grok)
  })

  it('Claude hors catalogue : xhigh, que le CLI accepte pour tous ses modèles', () => {
    const sansModele: RoleBinding = { provider: 'claude' }
    expect(bindingAvecUltrathink(sansModele, 'ultrathink', () => undefined).reasoningEffort).toBe(
      'xhigh'
    )
  })

  it('autre moteur hors catalogue : rien n’est déduit', () => {
    const inconnu: RoleBinding = { provider: 'codex', model: 'absent', reasoningEffort: 'low' }
    expect(bindingAvecUltrathink(inconnu, 'ultrathink', catalogue)).toBe(inconnu)
  })
})
