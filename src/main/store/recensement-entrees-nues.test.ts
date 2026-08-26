import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE DÉFAUT, trouvé par l'audit du 2026-08-26 sur deux voies indépendantes.
 *
 * `travauxNonPubliesBornes()` mappait `ids` — le recensement COMPLET, non borné — sur un aperçu
 * construit à six entrées. Au-delà de la sixième, l'entrée sortait avec `date: ''` et
 * `fichiers: []` : indistinguable d'un travail réellement vide.
 *
 * Or `commands.ts` écrit lui-même la condamnation : « `fichiers` est ce qui rend l'entrée
 * reconnaissable : un `agentId` seul ne dit rien à personne », et la description de `get_state`
 * promet à l'agent la liste « avec leurs fichiers ». Un agent qui lit `fichiers: []` lit « rien
 * dedans » — le défaut d'origine rejoué sous une autre forme, cette fois avec une entrée présente
 * mais muette.
 *
 * On ne rend donc que ce qu'on sait décrire, et on DIT combien il en reste.
 */

const monter = (nombre: number): RunWorktreeCoordinator => {
  const ids = Array.from({ length: nombre }, (_, i) => `run-${i}`)
  const manager = {
    travauxNonPublies: () => ids,
    apercuTravauxNonPublies: (_ref: string, limite: number) =>
      ids.slice(0, limite).map((agentId) => ({
        agentId,
        date: '2026-08-26',
        fichiers: [`${agentId}.ts`]
      })),
    activity: () => [],
    listAgentIds: () => []
  }
  return new RunWorktreeCoordinator({ manager: manager as never, now: () => 1_000 } as never)
}

describe('le recensement ne rend jamais une entrée qu’il ne sait pas décrire', () => {
  it('AUCUNE entrée nue quand il y a plus de travaux que d’aperçus', () => {
    const rendu = monter(14).travauxNonPubliesBornes()

    // Ce qui compte est qu'AUCUNE entree ne se lise « travail sans fichier » : c'est `fichiers: []`
    // qui trompait le lecteur, pas la date. La ligne de report « … et N autres » n'a legitimement
    // pas de date — elle n'est pas un travail, et elle le dit dans son propre libelle.
    expect(rendu.length).toBeGreaterThan(0)
    for (const entree of rendu) {
      expect(entree.fichiers.length).toBeGreaterThan(0)
    }
  })

  it('ANNONCE combien de travaux ne sont pas detailles, au lieu de les taire', () => {
    // Taire le reste ferait croire la liste complete — le meme mensonge, en plus discret.
    const rendu = monter(14).travauxNonPubliesBornes()
    const report = rendu[rendu.length - 1]

    expect(report?.agentId).toMatch(/8 autres travaux non publiés/u)
  })

  it('rend tout quand tout tient dans la borne', () => {
    expect(monter(3).travauxNonPubliesBornes()).toHaveLength(3)
  })
})
