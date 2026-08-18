import { describe, expect, it } from 'vitest'
import { structuredEvidenceFields } from './codex'

/**
 * DEFAUT MESURE EN PRODUCTION le 2026-08-18, sur les traces reelles de conv-1302 et conv-1304.
 *
 * Toutes les preuves d'execution portaient `path: "0"` ou `"0, 1"` — jamais un fichier. Cause :
 * `Object.keys(item.changes)` suppose un objet indexe PAR CHEMIN, alors que le provider emet un
 * TABLEAU `[{ path, kind }]`. `Object.keys` d'un tableau rend ses INDICES.
 *
 * Le vrai chemin etait la, dans `changes[i].path`, et il etait jete. Consequence : aucune preuve de
 * mutation n'etait rattachable a un fichier, donc aucun controle de cloture ne pouvait verifier
 * QUOI avait ete modifie.
 *
 * Pourquoi aucun test ne l'a vu : le fixture existant (`codex.causal-lines.test.ts`) encode la forme
 * SUPPOSEE `{ [chemin]: {...} }`. Il s'accordait avec le bug. Ce test-ci part de la forme REELLE,
 * copiee d'une trace de production.
 */
describe('codex file_change — la forme REELLE est un tableau', () => {
  const cwd = 'C:\\Amitel\\Autowin OS\\.autowin-data\\autowin-os\\worktrees\\abc\\agent__run-1'
  const fichier = `${cwd}\\src\\main\\task-regime.test.ts`

  it('un tableau [{path, kind}] rend le CHEMIN, jamais un indice', () => {
    const preuve = structuredEvidenceFields(
      { type: 'file_change', status: 'completed', changes: [{ path: fichier, kind: 'update' }] },
      cwd
    )
    expect(preuve.path).not.toBe('0')
    expect(preuve.paths).not.toEqual(['0'])
    expect(String(preuve.path)).toContain('task-regime.test.ts')
  })

  it('deux entrees rendent deux chemins, pas « 0, 1 »', () => {
    const second = `${cwd}\\src\\main\\task-regime.ts`
    const preuve = structuredEvidenceFields(
      {
        type: 'file_change',
        status: 'completed',
        changes: [
          { path: fichier, kind: 'update' },
          { path: second, kind: 'update' }
        ]
      },
      cwd
    )
    expect(preuve.path).not.toBe('0, 1')
    expect(preuve.paths?.length).toBe(2)
    expect(preuve.paths?.join(' ')).toContain('task-regime.ts')
  })

  it("l'ancienne forme objet reste supportee — aucune regression", () => {
    const preuve = structuredEvidenceFields(
      { type: 'file_change', status: 'completed', changes: { [fichier]: { kind: 'update' } } },
      cwd
    )
    expect(String(preuve.path)).toContain('task-regime.test.ts')
  })
})
