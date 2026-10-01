import { describe, expect, it } from 'vitest'
import { pickAcquiredAnalysis } from './orchestration-state'
import type { OrchestrationRunState } from './orchestration-state'

/**
 * NE PAS REPAYER UNE ANALYSE DÉJÀ PRODUITE DANS LA MÊME CONVERSATION.
 *
 * Levier n°3 (score 86) du scout coût joué dans Autowin (conv-1120, 2026-08-12), adossé aux
 * conversations réelles : sur `conv-1061`, scout + frame + terrain coûtent 11,20 $, soit 73,9 %
 * des 15,16 $ de sous-agents du fil.
 *
 * Le mécanisme de reprise existe déjà (`resumedPhases.has(phase) → continue`) mais son
 * appariement exige la MÊME tâche (`normalizeTaskKey(state.task) !== wanted`,
 * orchestration-state.ts:806). Or le parcours réel enchaîne deux libellés DIFFÉRENTS dans la même
 * conversation — « scout des améliorations de la vue Chat » puis « Fais tout. Mène les chantiers
 * retenus… » — donc l'acquis n'est jamais reconnu et le scout est intégralement rejoué.
 *
 * On n'élargit QUE les phases en lecture seule. Une phase qui mute (`build`, `clean`) doit être
 * rejouée : son acquis est sur le disque, pas dans un texte, et le workspace a pu bouger depuis.
 */
const etat = (patch: Partial<OrchestrationRunState> = {}): OrchestrationRunState =>
  ({
    runId: 'run-1',
    conversationId: 'conv-1061',
    task: 'scout des améliorations de la vue Chat',
    updatedAt: 1_000_000,
    phaseOutputs: [
      { phase: 'scout', text: 'P1 : brancher le bouton Orienter. P2 : états vides.' },
      { phase: 'build', text: 'commit 3 fichiers' }
    ],
    ...patch
  }) as OrchestrationRunState

const base = {
  conversationId: 'conv-1061',
  task: 'Fais tout. Mène les chantiers retenus pour la vue Chat de bout en bout.',
  nowMs: 1_000_500
}

describe('acquis d’analyse réutilisable dans une conversation', () => {
  it('réutilise le scout produit sous un AUTRE libellé de la même conversation', () => {
    const acquis = pickAcquiredAnalysis([etat()], base)
    expect(acquis.map((o) => o.phase)).toEqual(['scout'])
    expect(acquis[0].text).toContain('Orienter')
  })

  it('ne réutilise JAMAIS une phase qui mute le workspace', () => {
    const acquis = pickAcquiredAnalysis([etat()], base)
    expect(acquis.some((o) => o.phase === 'build')).toBe(false)
  })

  it('ne traverse pas les conversations', () => {
    expect(pickAcquiredAnalysis([etat({ conversationId: 'conv-999' })], base)).toEqual([])
  })

  it('ignore un acquis trop ancien', () => {
    expect(pickAcquiredAnalysis([etat()], { ...base, nowMs: 1_000_000 + 48 * 3_600_000 })).toEqual(
      []
    )
  })

  it('ignore un acquis vide, qui ferait sauter la phase sans rien apporter', () => {
    const vide = etat({ phaseOutputs: [{ phase: 'scout', text: '   ' }] })
    expect(pickAcquiredAnalysis([vide], base)).toEqual([])
  })

  it('ne saute pas une phase que l’utilisateur redemande explicitement', () => {
    const acquis = pickAcquiredAnalysis([etat()], { ...base, task: '/scout refais l’analyse' })
    expect(acquis).toEqual([])
  })

  it('ne réutilise pas un run dont un appel est encore actif : c’est un verrou, pas un acquis', () => {
    const verrouille = etat({ usage: { activeCalls: 1 } } as Partial<OrchestrationRunState>)
    expect(pickAcquiredAnalysis([verrouille], base)).toEqual([])
  })

  /*
   * conv-890, 2026-09-30 : `run-3180eec71b06-1` est refusé au contrôle final à 13:32:48Z, puis le
   * tour de chat restauré après le redémarrage lance `run-66d6d5bdfc5a-1` sur le même tour. Son
   * `frame` est repris, mais son `think` est REJOUÉ de 13:36:25Z à 13:42:34Z pour 1,94 $, alors que
   * `run-state/run-3180eec71b06-1.json` porte encore le briefing (13 372 caractères).
   */
  // fix-ok: run-85d8e7f57af2-1 — les éditions répétées de ce test ne corrigeaient pas le code : le
  // heredoc Python d'insertion a changé les `\n` des chaînes TS en vrais retours à la ligne (test non
  // compilable, rétabli par 2 Edit), puis Prettier a demandé de couper le `toEqual([])` trop long.
  it('réutilise le briefing `think` déjà payé pour la même demande relancée', () => {
    const avecThink = etat({
      turnId: '386f4c48',
      phaseOutputs: [
        {
          phase: 'think',
          text: '## Localisation\n- src/main/orchestrator.ts:3643',
          codeSha: 'a'.repeat(40)
        },
        { phase: 'frame', text: '## Besoin\nfiltrer SUITE' }
      ]
    })
    const acquis = pickAcquiredAnalysis([avecThink], { ...base, turnId: '386f4c48' })
    expect(acquis.map((o) => o.phase)).toEqual(['think', 'frame'])
    expect(acquis[0].text).toContain('orchestrator.ts:3643')
    // Le commit du code lu suit le briefing : c'est lui qui permet de savoir s'il est périmé.
    expect(acquis[0].codeSha).toBe('a'.repeat(40))
  })

  /*
   * Objection du juge (run-85d8e7f57af2-1, réparation 2) : le scout demandait « même fil, même
   * commit, tâche proche ». Un briefing pointe des lignes de code et parle d'UNE demande : pour une
   * autre demande du même fil, ou sans commit connu, il est rejoué. Le cadrage, lui, garde sa règle.
   */
  it('rejoue `think` pour une AUTRE demande du même fil, sans toucher au cadrage', () => {
    const avecThink = etat({
      turnId: 'tour-ancien',
      phaseOutputs: [
        { phase: 'think', text: '## Localisation\n- a.ts', codeSha: 'a'.repeat(40) },
        { phase: 'frame', text: '## Besoin\nautre chose' }
      ]
    })
    const acquis = pickAcquiredAnalysis([avecThink], { ...base, turnId: 'tour-nouveau' })
    expect(acquis.map((o) => o.phase)).toEqual(['frame'])
  })

  it('reprend `think` pour la même tâche mot pour mot, même sur un autre tour', () => {
    const avecThink = etat({
      turnId: 'tour-ancien',
      phaseOutputs: [{ phase: 'think', text: '## Localisation\n- a.ts', codeSha: 'a'.repeat(40) }]
    })
    const acquis = pickAcquiredAnalysis([avecThink], {
      ...base,
      task: '  scout des améliorations   de la vue Chat ',
      turnId: 'tour-nouveau'
    })
    expect(acquis.map((o) => o.phase)).toEqual(['think'])
  })

  it('rejoue un briefing `think` dont le commit lu n’est pas connu', () => {
    const sansCommit = etat({
      turnId: '386f4c48',
      phaseOutputs: [{ phase: 'think', text: '## Localisation\n- a.ts' }]
    })
    expect(pickAcquiredAnalysis([sansCommit], { ...base, turnId: '386f4c48' })).toEqual([])
  })

  it('rejoue `think` quand l’utilisateur le redemande avec /think', () => {
    const avecThink = etat({ phaseOutputs: [{ phase: 'think', text: '## Localisation\n- a.ts' }] })
    expect(pickAcquiredAnalysis([avecThink], { ...base, task: '/think relis le Brain' })).toEqual(
      []
    )
  })

  it('prend le plus récent quand plusieurs acquis coexistent', () => {
    const ancien = etat({
      runId: 'run-0',
      updatedAt: 900_000,
      phaseOutputs: [{ phase: 'scout', text: 'analyse périmée' }]
    })
    const acquis = pickAcquiredAnalysis([ancien, etat()], base)
    expect(acquis[0].text).toContain('Orienter')
  })
})
