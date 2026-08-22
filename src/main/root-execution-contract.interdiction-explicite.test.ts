import { describe, expect, it } from 'vitest'
import { classifyMutationConfidence } from './task-mutation-classifier'
import { rootExecutionRequirements } from './root-execution-contract'

/**
 * UNE TACHE QUI INTERDIT D'ECRIRE NE PEUT PAS DEVOIR PROUVER UNE ECRITURE.
 *
 * Vecu le 2026-08-22 en pilotant l'app pour une mesure : trois tournures explicitement en lecture
 * seule se sont fait arreter au controle final sur « Mutation demandee produite avec une preuve
 * executable » — une preuve insatisfaisable par construction, puisque l'enonce interdit toute
 * ecriture. Deux mesures ont ete perdues sur ce refus.
 *
 * Deux defauts empiles, mesures :
 *
 * 1. `aucun(e)` n'etait pas un negateur reconnu par le classifieur, alors que
 *    `NEGATED_MENTION_PREFIX` (root-execution-contract.ts) le reconnait. Deux listes de negateurs
 *    divergentes : ecrire « aucune ecriture » FAISAIT donc de la tache une mutation, le mot
 *    `ecriture` etant compte comme une demande d'ecrire. Dire qu'on n'ecrit pas rendait mutant.
 * 2. Meme negation reconnue, la tache retombe en `uncertain`, et le contrat exigeait la mutation
 *    des que la confiance n'etait pas `read-only`. Or `uncertain` veut precisement dire « on ne
 *    sait pas » : en tirer une OBLIGATION prouvable est un faux rouge garanti.
 *
 * Ce qui NE change PAS, deliberement : `isMutationTask` reste vrai sur `uncertain`, donc le chemin
 * sur worktree isole et le catalogue de commandes sont CONSERVES. On desarme l'obligation, jamais
 * la capacite -- c'est le compromis que documente deja `task-mutation-classifier.ts` a propos de
 * `verifi`. Cas voisin mais distinct : `root-execution-contract.lecture-seule.test.ts` traite le
 * PROGRAMME de phases ; ici c'est l'ENONCE qui interdit.
 */
const TACHE_LECTURE_SEULE =
  'orchestrate cette tache en regime disposable : dans le depot courant, lance exactement ' +
  '`npx vitest run src/renderer` et rapporte le nombre de fichiers et de tests verts. ' +
  'NE MODIFIE AUCUN FICHIER, aucune ecriture, lecture seule.'

describe('une interdiction explicite d ecrire desarme la DoD de mutation', () => {
  it('« aucune ecriture » ne fait plus de la tache une mutation', () => {
    // Le defaut nu : le mot `ecriture`, precede de son negateur, etait lu comme une demande.
    expect(classifyMutationConfidence(TACHE_LECTURE_SEULE)).not.toBe('mutation')
  })

  it('n exige AUCUNE preuve de mutation, meme quand la phase build est programmee', () => {
    const exige = rootExecutionRequirements(TACHE_LECTURE_SEULE, ['build', 'judge'])
    expect(exige.mutation).toBe(false)
  })

  it('garde la case TESTS : la tache demande bien d executer une suite', () => {
    // Desarmer la mutation ne doit pas desarmer ce qui est reellement demande.
    const exige = rootExecutionRequirements(TACHE_LECTURE_SEULE, ['build', 'judge'])
    expect(exige.tests).toBe(true)
  })

  it('reconnait toute la famille de negateurs, pas seulement « aucun »', () => {
    // Les trois tournures portent le marqueur « lecture seule » : sans lui, le classifieur retombe
    // volontairement sur `mutation` (defaut sur -- il PRESERVE la capacite plutot que de la retirer
    // a une tache qui doit lancer une suite). Mesure : les trois rendaient `mutation` avant, elles
    // rendent `uncertain` apres, donc plus aucune DoD de mutation insatisfaisable.
    for (const tournure of [
      'lance la suite de tests, zero ecriture, lecture seule',
      'lance la suite de tests, pas de modification, lecture seule',
      'lance la suite de tests, aucune creation de fichier, lecture seule'
    ]) {
      expect(classifyMutationConfidence(tournure)).not.toBe('mutation')
      expect(rootExecutionRequirements(tournure, ['build', 'judge']).mutation).toBe(false)
    }
  })

  it('SANS marqueur de lecture seule, le defaut MUTATION est conserve — voulu', () => {
    // Contre-epreuve du choix ci-dessus : elargir les negateurs ne doit PAS rendre lecture seule
    // une tache qui ne s'est pas declaree telle, sous peine de lui retirer ses commandes.
    expect(classifyMutationConfidence('lance la suite de tests, zero ecriture')).toBe('mutation')
  })
  it('une VRAIE mutation reste une mutation, avec sa preuve exigible', () => {
    // Entree-refuteur : si ce cas basculait, le correctif aurait desarme le gate pour de bon.
    const vraie = 'corrige le collage des deltas dans agent-pilot.ts et ajoute un test rouge vers vert'
    expect(classifyMutationConfidence(vraie)).toBe('mutation')
    expect(rootExecutionRequirements(vraie, ['build', 'judge']).mutation).toBe(true)
  })

  it('« sans ecrire » restait deja correctement negatif — non regresse', () => {
    expect(classifyMutationConfidence('analyse le depot sans ecrire')).toBe('read-only')
  })
})
