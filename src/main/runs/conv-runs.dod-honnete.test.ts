import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { closeConvRun, createConvRun } from './conv-runs'
import { parseRun, isBlocked } from '../dashboards/runs'

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
describe('DoD auto-générée — honnête ou absente', () => {
  const racine = () => mkdtempSync(join(tmpdir(), 'aos-convruns-dod-'))

  it('ne pose AUCUNE case auto-générée sous le critère de succès', () => {
    const chemin = createConvRun('conv-1', 'auditer la vue Worktrees', racine())
    const md = readFileSync(chemin, 'utf8')
    expect(md).not.toContain('- [ ] le juge valide')
    // La section reste présente pour qu'un humain ou un agent y pose un VRAI critère.
    expect(md).toContain('## Besoin')
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
