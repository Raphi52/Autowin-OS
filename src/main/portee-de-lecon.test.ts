import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createIndependentLearningAttestation,
  learningProposalAttestation,
  porteeDeLecon,
  verifyIndependentLearningAttestation
} from './outcome-learning-proposal'

/**
 * LE DÉFAUT, mesuré le 2026-08-25 sur les données réelles.
 *
 * Sur 256 observations d'issue, `attestedProposalHashes` est vide dans **256**. Le motif
 * `proposal-not-judge-attested` tombait donc sur **22 leçons sur 22**, et c'est le dernier verrou
 * entre `inbox` et `publish`.
 *
 * LA CAUSE : la portée de la leçon était calculée à DEUX endroits, depuis DEUX chemins différents.
 *
 *   - côté attestation (`orchestrator.ts`) : `workspaceSlug(workCwd)`, or `workCwd` vaut
 *     `isolatedCwd ?? executionWorkspace` — donc, sur tout run ISOLÉ (c'est-à-dire tout run de
 *     mutation), le chemin de la COPIE AGENT ;
 *   - côté consommateur (`commands.ts`) : `workspaceSlug(this.os.executionWorkspace)`, le dépôt réel.
 *
 * Mesuré sur un chemin réel : la copie donne `agent-run-d66740cfa68e-1`, le dépôt donne
 * `autowin-os`. Deux portées différentes ⇒ deux empreintes différentes ⇒
 * `verifyIndependentLearningAttestation` échoue ⇒ aucune attestation ne survit. Toujours.
 *
 * C'est la classe de défaut que ce dépôt paie en boucle : DEUX sources pour UNE valeur. La portée a
 * donc désormais UNE seule définition, et les deux côtés l'appellent.
 *
 * QUELLE portée est la BONNE : celle du dépôt. Une leçon décrit un projet, pas la copie jetable où
 * elle a été apprise — `agent-run-d66740cfa68e-1` polluerait le Brain d'une portée par run, que rien
 * ne pourrait jamais relire.
 */

describe('la portée d’une leçon a UNE seule définition', () => {
  const COPIE =
    'C:/Amitel/Autowin OS/.autowin-data/autowin-os/worktrees/68fe/agent__run-d66740cfa68e-1'
  const DEPOT = 'C:/Amitel/Autowin OS'

  it('rend la portée du DÉPÔT, jamais celle de la copie agent', () => {
    // Le cas mesuré : c'est cette divergence qui vidait les 256 observations.
    expect(porteeDeLecon('project', DEPOT)).toBe('autowin-os')
    expect(porteeDeLecon('project', COPIE)).toBe('autowin-os')
  })

  it('donne la MÊME portée des deux côtés, quel que soit le chemin de travail', () => {
    // L'invariant qui compte, et le seul qui empêche le défaut de revenir : les deux appelants
    // peuvent passer des chemins différents sans que les empreintes divergent.
    expect(porteeDeLecon('project', COPIE)).toBe(porteeDeLecon('project', DEPOT))
  })

  it('préserve `global`, qui n’appartient à aucun dépôt', () => {
    expect(porteeDeLecon('global', COPIE)).toBe('global')
    expect(porteeDeLecon('  GLOBAL  ', DEPOT)).toBe('global')
  })

  it('remonte hors d’une copie même IMBRIQUÉE', () => {
    const imbriquee = `${COPIE}/.autowin-data/autowin-os/worktrees/aa/agent__run-autre-1`
    expect(porteeDeLecon('project', imbriquee)).toBe('autowin-os')
  })

  it('laisse un chemin ordinaire intact', () => {
    expect(porteeDeLecon('project', 'D:/Travaux/mon-projet')).toBe('mon-projet')
  })
})

describe('les deux côtés appellent bien cette définition', () => {
  const lire = (relatif: string): string => readFileSync(join(__dirname, relatif), 'utf8')

  it('l’attestation ne calcule plus la portée depuis le dossier de travail', () => {
    // L'entrée EXACTE qui a causé le défaut. La réintroduire re-viderait toutes les attestations,
    // sans qu'aucun test de comportement ne le voie.
    const orchestrateur = lire('orchestrator.ts')
    expect(orchestrateur).not.toMatch(/scope:.*workspaceSlug\(workspace\)/)
    expect(orchestrateur).toContain('porteeDeLecon(')
  })

  it('le consommateur appelle la même définition', () => {
    expect(lire('commands.ts')).toContain('porteeDeLecon(')
  })
})

/**
 * LE VERROU, SUR UN RUN ISOLÉ — c'est-à-dire tout run de mutation.
 *
 * L'attestation est produite depuis le chemin de la COPIE, le consommateur la vérifie depuis le
 * dépôt. Avant le correctif, les deux empreintes divergeaient et l'attestation était rejetée : c'est
 * ce que ce test reproduit, dans les deux sens.
 */
describe('l’attestation d’un run ISOLÉ survit à sa vérification', () => {
  const COPIE_AGENT =
    'C:/Amitel/Autowin OS/.autowin-data/autowin-os/worktrees/68fe/agent__run-d66740cfa68e-1'
  const DEPOT = 'C:/Amitel/Autowin OS'

  const lecon = {
    outcome: 'success' as const,
    title: 'La portée d’une leçon décrit le projet',
    body: 'Une portée par run ne serait relisible par personne.',
    type: 'lesson' as const,
    tags: ['outcome-learning'],
    confidence: 'high' as const
  }

  it('l’empreinte est la MÊME des deux côtés — le verrou tombe', () => {
    // Côté juge, depuis la copie ; côté consommateur, depuis le dépôt.
    const cotéJuge = learningProposalAttestation({
      ...lecon,
      scope: porteeDeLecon('project', COPIE_AGENT)
    })
    const cotéConsommateur = learningProposalAttestation({
      ...lecon,
      scope: porteeDeLecon('project', DEPOT)
    })

    expect(cotéJuge).toBe(cotéConsommateur)
    expect(
      verifyIndependentLearningAttestation(
        createIndependentLearningAttestation(cotéJuge, 'run-1', 'judge:test'),
        cotéConsommateur,
        'run-1'
      )
    ).toBe(true)
  })

  it('AVANT le correctif, la même attestation était rejetée', () => {
    // Contre-épreuve : l'ancien calcul, celui qui partait du dossier de travail.
    const ancienCalcul = (chemin: string): string =>
      chemin
        .replace(/\/+$/, '')
        .split('/')
        .filter(Boolean)
        .pop()!
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')

    const cotéJuge = learningProposalAttestation({ ...lecon, scope: ancienCalcul(COPIE_AGENT) })
    const cotéConsommateur = learningProposalAttestation({ ...lecon, scope: ancienCalcul(DEPOT) })

    expect(cotéJuge).not.toBe(cotéConsommateur)
    expect(
      verifyIndependentLearningAttestation(
        createIndependentLearningAttestation(cotéJuge, 'run-1', 'judge:test'),
        cotéConsommateur,
        'run-1'
      )
    ).toBe(false)
  })
})
