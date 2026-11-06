import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PIPELINE_DISCIPLINE_INSTRUCTION } from './pipeline-discipline'
import { JUDGE_TOOLSET_CONTRACT } from './orchestrator'

/**
 * EDIT/WRITE : CE QUE LE PRODUCTEUR ET SON JUGE LISENT SUIT LE CODE (2026-11-05).
 *
 * `sandboxForPhase` rend `danger-full-access` à chaque phase de la chaîne, mais le build découpé en
 * sous-tâches parallèles part en `read-only` quand la tâche ne modifie rien
 * (`orchestrator-parcours-glouton.ts`, `isMutationTask(task) ? 'danger-full-access' : 'read-only'`),
 * et `providers/claude.ts` retire alors Edit/Write. Une consigne qui dit « chargés sur TOUTES les
 * phases » ment à cette sous-tâche ; le juge doit lire la même exception que le producteur.
 *
 * Entrées qui rendent ce test rouge : l'exception retirée de `PIPELINE_DISCIPLINE_INSTRUCTION` ou de
 * `JUDGE_TOOLSET_CONTRACT` tant que la branche `read-only` existe ; « chargés sur TOUTES les
 * phases » remis sans exception.
 */
describe('Edit/Write annoncés comme le code les donne (conv-1582)', () => {
  const glouton = readFileSync(
    new URL('./orchestrator-parcours-glouton.ts', import.meta.url),
    'utf8'
  )
  const brancheLectureSeule = /isMutationTask\(task\) \? 'danger-full-access' : 'read-only'/u
  const exception = /sous-tâche parallèle d'un build qui ne modifie rien/u

  it('la sous-tâche parallèle en lecture seule existe dans le code', () => {
    // Si cette branche disparaît, l'exception devient fausse à son tour : retire-la des deux textes.
    expect(glouton).toMatch(brancheLectureSeule)
  })

  it('le producteur lit l exception, pas « TOUTES les phases » sans réserve', () => {
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).toMatch(exception)
    expect(PIPELINE_DISCIPLINE_INSTRUCTION).not.toMatch(/chargés sur TOUTES les phases :/u)
  })

  it('le juge lit la même exception que le producteur', () => {
    expect(JUDGE_TOOLSET_CONTRACT).toMatch(exception)
  })
})
