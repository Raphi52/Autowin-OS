import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { closeConvRun, createConvRun, populateConvRunSections } from './conv-runs'
import { parseRun } from '../dashboards/runs'
import type { ExecutionEvidence } from '../providers/types'

/**
 * LE RUN.md D'UN RUN FINI NE MONTRE PLUS DE SECTIONS VIDES (conv-1578, 2026-11-05).
 *
 * Constat sur le dernier RUN.md du poste (conv-1575, run vert jugé 94) : `## Contraintes`, `## Options`,
 * `## SOP` en gabarit, `## Défauts` vide, `## Reprise` aux cinq champs vides, `## Cicatrices` et
 * `## Checks` vides. Aucun code de l'app n'écrivait `Reprise`, `Cicatrices` ni `Checks` : le gabarit
 * promettait des sections que personne ne remplissait, alors que les commandes de vérification et les
 * objections du juge étaient connues.
 */
describe('RUN.md rempli avec ce que l’app sait, sans gabarit vide à la clôture', () => {
  const racine = (): string => mkdtempSync(join(tmpdir(), 'aos-convruns-rapport-'))
  const preuve = (command: string, exitCode: number): ExecutionEvidence => ({
    type: 'command_execution',
    kind: 'verification',
    status: exitCode === 0 ? 'completed' : 'failed',
    ok: exitCode === 0,
    summary: command,
    command,
    exitCode
  })

  it('les commandes de vérification vont sous ## Checks, une fois chacune, avec leur dernier code', () => {
    const chemin = createConvRun('conv-1', 'Corrige le compteur.\nDétail en ligne 2.', racine())
    const phases = [
      {
        phase: 'build',
        text: 'Fait.',
        executionEvidence: [
          preuve('npx vitest run a.test.ts', 1),
          preuve('npx vitest run a.test.ts', 0),
          preuve('npm run typecheck', 0),
          { ...preuve('ls', 0), kind: 'inspection' as const }
        ]
      }
    ]
    populateConvRunSections(chemin, phases)
    populateConvRunSections(chemin, phases)
    const md = readFileSync(chemin, 'utf8')
    const checks = md.slice(md.indexOf('## Checks'))
    expect(checks).toContain('exit 0 · npx vitest run a.test.ts')
    expect(checks).not.toContain('exit 1 · npx vitest run a.test.ts')
    expect(checks).toContain('exit 0 · npm run typecheck')
    expect(checks).not.toContain('· ls')
    expect(md.match(/npm run typecheck/g)?.length).toBe(1)
  })

  it('les objections MAJEUR et MINEUR du juge vont sous ## Défauts, pas les lignes OK', () => {
    const chemin = createConvRun('conv-2', 'Ajoute le garde.', racine())
    populateConvRunSections(chemin, [
      { phase: 'build', text: 'Fait.' },
      {
        phase: 'judge',
        text: 'DEFAUT: refusé\nSCORE: 40\nOBJECTIONS:\n- MAJEUR: le test ne rougit pas sans le correctif\n- MINEUR: commentaire sans source\n- OK: typage vert'
      }
    ])
    const md = readFileSync(chemin, 'utf8')
    const defauts = md.slice(md.indexOf('## Défauts'), md.indexOf('## Livrable des phases'))
    expect(defauts).toContain('- MAJEUR: le test ne rougit pas sans le correctif')
    expect(defauts).toContain('- MINEUR: commentaire sans source')
    expect(defauts).not.toContain('OK: typage vert')
    expect(parseRun(md).defauts).toBe(2)
  })

  it('à la clôture verte : Reprise dit le but et les phases jouées, les sections vides disparaissent', () => {
    const chemin = createConvRun('conv-3', 'Corrige le compteur.\nDétail.', racine())
    populateConvRunSections(chemin, [
      { phase: 'build', text: 'Fait.', executionEvidence: [preuve('npm run lint', 0)] },
      { phase: 'judge', text: 'VALIDE\nSCORE: 94\nOBJECTIONS:\n- OK: rien à redire' }
    ])
    closeConvRun(chemin, 'green', 'Juge: validé — clôture autorisée (1,00 $).')
    const md = readFileSync(chemin, 'utf8')

    for (const vide of ['## Contraintes', '## Options', '## SOP', '## Défauts', '## Cicatrices'])
      expect(md).not.toContain(vide)
    expect(md).toContain('Goal: Corrige le compteur.')
    expect(md).toContain('Tried: phases build, judge')
    for (const champ of ['Hypothesis:', 'Next:', 'Blockers:']) expect(md).not.toContain(champ)
    expect(md).toContain('## Checks\n- exit 0 · npm run lint')
    expect(parseRun(md)).toMatchObject({ status: 'green', defauts: 0 })
  })

  it('à la clôture rouge, Blockers porte la cause de la clôture', () => {
    const chemin = createConvRun('conv-4', 'Relance le rendu.', racine())
    closeConvRun(chemin, 'red', 'Orchestration en échec: Reprise du worktree refusée')
    const md = readFileSync(chemin, 'utf8')
    expect(md).toContain('Goal: Relance le rendu.')
    expect(md).toContain('Blockers: Orchestration en échec: Reprise du worktree refusée')
    expect(md).not.toContain('## Checks')
    expect(parseRun(md).status).toBe('red')
  })

  it('un texte d’utilisateur qui écrit « Goal: » dans son besoin n’est pas touché', () => {
    const chemin = createConvRun('conv-5', 'Mon plan\nGoal:\nNext:', racine())
    closeConvRun(chemin, 'green', 'Juge: validé.')
    const md = readFileSync(chemin, 'utf8')
    expect(md).toContain('## Besoin\nMon plan\nGoal:\nNext:\n')
  })
})
