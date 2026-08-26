import { describe, expect, it } from 'vitest'
import { buildOrchestratorModelGroups, type RuntimeModel } from './chat-view-model'

/**
 * Le sélecteur d'orchestrateur du Chat ne doit exposer QUE la dernière version de chaque
 * famille de modèle — les versions antérieures sont du bruit dans la popup.
 *
 * Entrées de RÉFUTATION (celles qui font tomber ce test si le filtre est faux) :
 *  - `claude-sonnet-4-5` : famille DIFFÉRENTE d'Opus, un filtre trop grossier la supprimerait ;
 *  - `claude-opus-4-8` exposé par DEUX providers : ce sont deux cibles distinctes, pas un doublon ;
 *  - `claude-opus-4-1` LIÉ comme courant : un filtre naïf le ferait disparaître de son propre menu.
 */
const m = (provider: string, model: string): RuntimeModel => ({
  id: `${provider}:${model}`,
  provider,
  model,
  reasoningEfforts: ['none']
})

const modelsDe = (groups: ReturnType<typeof buildOrchestratorModelGroups>['groups']): string[] =>
  groups.flatMap((g) => g.options.map((o) => `${o.provider}:${o.model}`))

describe('popup orchestrateur — dernière version seulement', () => {
  it('ne garde que la version la plus récente de chaque famille', () => {
    const groups = buildOrchestratorModelGroups([
      m('cli', 'claude-opus-4-8'),
      m('cli', 'claude-opus-4-5'),
      m('cli', 'claude-opus-4-1'),
      m('cli', 'claude-sonnet-4-5'),
      m('cli', 'claude-sonnet-4-0')
    ]).groups
    expect(modelsDe(groups)).toEqual(['cli:claude-opus-4-8', 'cli:claude-sonnet-4-5'])
  })

  it('garde le même modèle exposé par deux providers différents', () => {
    const groups = buildOrchestratorModelGroups([
      m('cli', 'claude-opus-4-8'),
      m('api', 'claude-opus-4-8'),
      m('api', 'claude-opus-4-5')
    ]).groups
    expect(modelsDe(groups).sort()).toEqual(['api:claude-opus-4-8', 'cli:claude-opus-4-8'])
  })

  it('garde le modèle COURANT même si une version plus récente existe', () => {
    const groups = buildOrchestratorModelGroups(
      [m('cli', 'claude-opus-4-8'), m('cli', 'claude-opus-4-1')],
      { provider: 'cli', model: 'claude-opus-4-1' }
    ).groups
    expect(modelsDe(groups)).toContain('cli:claude-opus-4-1')
    expect(modelsDe(groups)).toContain('cli:claude-opus-4-8')
  })

  /**
   * Entrée de RÉFUTATION mesurée sur le catalogue RÉEL (capture CDP du 2026-08-25) :
   * `claude-opus-4-20250514` porte une DATE, pas une version 4.20250514. Un comparateur naïf la
   * classerait au-dessus de `claude-opus-5` et garderait donc le plus VIEUX modèle.
   */
  it('ne prend pas une date de snapshot pour un numéro de version', () => {
    const groups = buildOrchestratorModelGroups([
      m('cli', 'claude-opus-4-20250514'),
      m('cli', 'claude-opus-5'),
      m('cli', 'claude-opus-4-5-20251101')
    ]).groups
    expect(modelsDe(groups)).toEqual(['cli:claude-opus-5'])
  })

  it('ne réduit pas les routes auto/* (ce ne sont pas des versions)', () => {
    const groups = buildOrchestratorModelGroups([
      m('router', 'auto/chat-best'),
      m('router', 'auto/chat-pro'),
      m('router', 'auto/code-best')
    ]).groups
    expect(modelsDe(groups)).toHaveLength(3)
  })

  it('ne garde que la version la plus haute même si l’ancienne arrive EN PREMIER', () => {
    // GREFFE du bureau `refs/autowin/rescue/run-ea8bccd9824f-1`, seule part de ce fichier que main
    // ne couvrait pas. Les autres cas du bureau renommaient des propriétés déjà testées ici, et sa
    // version PERDAIT cinq cas que main possède (date de snapshot, routes auto/*) : seul celui-ci
    // est repris.
    //
    // CE QUI LE REND DISCRIMINANT : les cas existants listent les versions DÉCROISSANTES, donc la
    // plus haute arrive d'abord — une implémentation « garde la première vue » les passerait tous.
    // Ici l'ancienne vient en tête.
    const groups = buildOrchestratorModelGroups([
      m('cli', 'claude-opus-4-5'),
      m('cli', 'claude-opus-4-8'),
      m('cli', 'claude-sonnet-4-5')
    ]).groups
    expect(modelsDe(groups)).toEqual(['cli:claude-opus-4-8', 'cli:claude-sonnet-4-5'])
  })
})
