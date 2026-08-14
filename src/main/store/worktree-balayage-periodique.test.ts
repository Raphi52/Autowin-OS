import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE BALAYAGE NE TOURNAIT QU'AU DÉMARRAGE.
 *
 * Mesuré le 2026-08-14 : 49 copies pour 1 453 Mo. Le correctif de préservation rend enfin ces copies
 * libérables, mais il ne change PAS le moment où on les regarde : une copie abandonnée à 9 h attendait
 * le prochain lancement de l'application pour être vue. Sur une session qui dure la journée — le cas
 * normal ici — le disque continue donc de se remplir pendant qu'un mécanisme capable de le rendre
 * existe et dort.
 *
 * CE QUE CE MINUTEUR N'AFFAIBLIT PAS, et c'est le point qui a été vérifié avant de l'armer : le
 * démarrage était un moment sûr par construction (aucun run ne tourne). En cours de session, la
 * protection ne vient pas de ce calendrier mais des gardes du balayage lui-même — âge minimal de 24 h
 * calculé sur la mtime du dossier, donc un run VIVANT qui écrit ne peut jamais paraître abandonné, et
 * lease PID par-dessus. Ces gardes sont des prédicats en lecture seule : les consulter plus souvent ne
 * change aucun verdict, seulement la date à laquelle il est rendu.
 */
describe('balayage périodique des copies abandonnées', () => {
  it('le coordinateur expose un balayage appelable HORS démarrage', async () => {
    const balaye: string[] = []
    const coordinateur = new RunWorktreeCoordinator({
      manager: {
        // Le constructeur réconcilie l'existant immédiatement : le bouchon doit tenir ce contrat-là
        // aussi, sinon le test échouerait AVANT d'atteindre ce qu'il prétend vérifier.
        listAgentIds: () => [],
        reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [] }),
        sweepAbandonedAgentCopiesAsync: async () => {
          balaye.push('appelé')
          return ['run-mort-1', 'run-mort-2']
        }
      }
    } as never)

    const swept = await coordinateur.balayerLesCopiesAbandonnees()
    expect(balaye).toEqual(['appelé'])
    expect(swept).toEqual(['run-mort-1', 'run-mort-2'])
  })

  it('un balayage qui ÉCHOUE ne fait pas tomber le minuteur', async () => {
    // Ce balayage est du ramassage opportuniste : rien n'attend son résultat. Une exception qui
    // remonterait dans un `setInterval` deviendrait un rejet non capturé à chaque tour d'horloge.
    const coordinateur = new RunWorktreeCoordinator({
      manager: {
        // Le constructeur réconcilie l'existant immédiatement : le bouchon doit tenir ce contrat-là
        // aussi, sinon le test échouerait AVANT d'atteindre ce qu'il prétend vérifier.
        listAgentIds: () => [],
        reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [] }),
        sweepAbandonedAgentCopiesAsync: async () => {
          throw new Error('git indisponible')
        }
      }
    } as never)

    await expect(coordinateur.balayerLesCopiesAbandonnees()).resolves.toEqual([])
  })

  it('l’application ARME ce balayage sur un minuteur, et le déréférence', () => {
    /*
      Une capacité que rien n'appelle est du théâtre (leçon du 2026-08-08 : « exposé/testé ≠
      intégré/alimenté »). On lit donc le câblage réel dans `index.ts`, pas une imitation.

      `unref()` est asserté avec le reste : sans lui, un minuteur horaire retient la boucle
      d'événements et l'application ne se ferme plus proprement — le motif déjà employé par le
      minuteur kaizen juste à côté.
    */
    const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')
    expect(source).toContain('balayerLesCopiesAbandonnees()')
    expect(source).toContain('balayagePeriodiqueTimer.unref()')
  })
})
