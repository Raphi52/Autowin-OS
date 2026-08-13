import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { closeConvRun, createConvRun, populateConvRunSections } from './conv-runs'
import { parseRun, isBlocked } from '../dashboards/runs'
import { rootExecutionRequirements } from '../root-execution-contract'

/**
 * LA DoD AUTO-GÉNÉRÉE NE DOIT PAS POSER UN CRITÈRE QUI N'EN EST PAS UN.
 *
 * Le gabarit écrivait sous « Critere de succes (DoD cochable) » la case :
 *   `- [ ] le juge valide le résultat et le gate autorise la clôture`
 *
 * Trois raisons pour laquelle elle était nuisible :
 * 1. Ce n'est pas un critère du TRAVAIL, c'est le report du verdict de clôture. Elle ne dit rien de
 *    ce que le run devait obtenir, donc elle n'aide personne à juger si le run a réussi.
 * 2. Le gate de clôture ne la lit JAMAIS (`orchestrator.ts` synthétise son état depuis le verdict du
 *    juge). Elle était donc purement décorative côté décision.
 * 3. Mais pas côté AFFICHAGE : `dashboards/runs.ts` compte les cases, et `isBlocked` classe un
 *    run « à traiter » sur `dodChecked < dodTotal`. Chaque run rouge affichait donc « DoD 0/1 »,
 *    comme si un critère avait été manqué — alors qu'aucun n'avait jamais été défini.
 *
 * Le remède n'est pas d'inventer un critère à la place de l'auteur du prompt : c'est de ne pas en
 * poser du tout, et de laisser le STATUT porter le signal (il le portait déjà).
 */
describe('DoD auto-générée — issue du besoin et non du verdict', () => {
  const racine = () => mkdtempSync(join(tmpdir(), 'aos-convruns-dod-'))

  it('compile les obligations verifiables explicites du prompt racine', () => {
    const chemin = createConvRun(
      'conv-1',
      'Scout les defauts puis corrige-les, lance les tests et publie un commit.',
      racine()
    )
    const md = readFileSync(chemin, 'utf8')
    expect(md).toContain('- [ ] Analyse demandee presente dans le livrable')
    expect(md).toContain('- [ ] Mutation demandee produite avec une preuve executable')
    expect(md).toContain('- [ ] Tests demandes executes avec un code de sortie 0')
    expect(md).toContain('- [ ] Commit demande publie avec une identite Git verifiable')
    expect(md).not.toMatch(/juge valide.*gate autorise/i)
  })

  it.each(['analyse puis répare, vérifie et publie', 'crée le fichier, teste et commit'])(
    'normalise les verbes français accentués du contrat racine : %s',
    (task) => {
      const requirements = rootExecutionRequirements(task)
      expect(requirements.mutation).toBe(true)
      expect(requirements.tests).toBe(true)
      expect(requirements.commit).toBe(true)
    }
  )

  it.each([
    ['Corrige le bug, lance les tests mais ne commit pas', true, false, true],
    ['Corrige le bug sans lancer les tests puis commit', true, true, false],
    ['Répare sans tests et sans publication', true, false, false],
    ['Corrige le bug, mais ne fais aucun commit', true, false, false],
    ['Corrige le bug, mais ne lance aucun test', true, false, false],
    ['Ne modifie rien, analyse seulement', false, false, false]
  ])(
    'respecte les interdictions explicites du contrat racine : %s',
    (task, mutation, commit, tests) => {
      expect(rootExecutionRequirements(task)).toMatchObject({ mutation, commit, tests })
    }
  )

  it('ne transforme pas un objet métier nommé commit en demande de publication Git', () => {
    expect(rootExecutionRequirements('corrige la vue de détail du commit')).toMatchObject({
      mutation: true,
      commit: false
    })
  })

  it.each(["build l'application puis commit", 'compile le projet et commit les changements'])(
    'partage le classifieur canonique avec le sandbox : %s',
    (task) => {
      expect(rootExecutionRequirements(task)).toMatchObject({ mutation: true, commit: true })
    }
  )

  it('coche chaque obligation uniquement depuis sa preuve structuree', () => {
    const chemin = createConvRun(
      'conv-1',
      'Scout les defauts puis corrige-les, lance les tests et publie un commit.',
      racine()
    )
    populateConvRunSections(
      chemin,
      [
        { phase: 'scout', text: 'analyse' },
        {
          phase: 'build',
          text: 'correction',
          executionEvidence: [
            {
              type: 'file_change',
              kind: 'mutation',
              status: 'completed',
              ok: true,
              summary: 'a.ts'
            },
            {
              type: 'command_execution',
              kind: 'verification',
              status: 'completed',
              ok: true,
              exitCode: 0,
              summary: 'npm test',
              command: 'npm test'
            }
          ]
        }
      ],
      { publishedCommitSha: 'abc123' }
    )

    const md = readFileSync(chemin, 'utf8')
    expect(md.match(/^- \[x\]/gm)).toHaveLength(4)
  })

  it('ne confond ni une phase scout vide ni un lint avec les livrables demandes', () => {
    const chemin = createConvRun(
      'conv-1',
      'Scout les defauts puis corrige-les et lance npm test.',
      racine()
    )
    populateConvRunSections(chemin, [
      { phase: 'scout', text: '   ' },
      {
        phase: 'build',
        text: 'correction',
        executionEvidence: [
          { type: 'file_change', kind: 'mutation', status: 'completed', ok: true, summary: 'a.ts' },
          {
            type: 'command_execution',
            kind: 'verification',
            status: 'completed',
            ok: true,
            exitCode: 0,
            summary: 'eslint',
            command: 'npm run lint'
          }
        ]
      }
    ])

    const md = readFileSync(chemin, 'utf8')
    expect(md).toContain('- [ ] Analyse demandee presente dans le livrable')
    expect(md).toContain('- [x] Mutation demandee produite avec une preuve executable')
    expect(md).toContain('- [ ] Tests demandes executes avec un code de sortie 0')
  })

  it('un run rouge n affiche plus une DoD manquée fantôme', () => {
    const chemin = createConvRun('conv-1', 'auditer la vue Worktrees', racine())
    closeConvRun(chemin, 'red', 'Gate BLOQUÉ: le juge a refusé')
    const resume = parseRun(readFileSync(chemin, 'utf8'))
    expect(resume.dodTotal).toBe(0)
    expect(resume.dodChecked).toBe(0)
    // Le signal « à traiter » ne disparaît pas pour autant : le STATUT le porte.
    expect(isBlocked(resume)).toBe(true)
  })

  it('un run vert n est plus « à traiter » (ni statut, ni DoD fantôme)', () => {
    const chemin = createConvRun('conv-1', 'auditer la vue Worktrees', racine())
    closeConvRun(chemin, 'green', 'Juge: validé')
    const resume = parseRun(readFileSync(chemin, 'utf8'))
    expect(resume.status).toBe('green')
    expect(isBlocked(resume)).toBe(false)
  })

  it('une VRAIE DoD, posée par un agent ou un humain, reste comptée et bloquante', () => {
    // On ne supprime pas le support de la DoD : on supprime la case AUTO-GÉNÉRÉE.
    const reel = `status: green

## Besoin
faire la chose

**Critere de succes (DoD cochable)** :
  - [x] les tests passent (preuve: exit 0)
  - [ ] la capture est lue (preuve: PNG)

## Journal
`
    const resume = parseRun(reel)
    expect(resume.dodTotal).toBe(2)
    expect(resume.dodChecked).toBe(1)
    expect(isBlocked(resume)).toBe(true)
  })
})
