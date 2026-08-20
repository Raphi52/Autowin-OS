import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE SYMPTOME, mesure le 2026-08-20 : `npm run test:unit` sortait en EXIT 1 avec 7183 tests VERTS.
 *
 * Une seule ligne d'explication dans la sortie : « Unhandled Rejection — spawnSync git ENOENT »,
 * remontee depuis `reconcileExistingAsync`. Un echec de suite qui ne correspond a AUCUN test rouge
 * coute des heures a diagnostiquer, et en production le meme rejet passe totalement silencieux.
 *
 * LA CAUSE est une asymetrie dans le constructeur. La branche isolee chaine bien son echec :
 *   `.catch((error) => this.recordRecoveryFailure(error))`
 * La branche DIFFEREE, elle, faisait `void attendre.then(f, f)` sans aucun `catch` — alors que `f`
 * (`reconcileExistingAsync`) enumere les copies via `execFileSync('git', ...)` et peut donc jeter,
 * typiquement quand son `cwd` a disparu. Le rejet devenait une rejection non geree : ni attribuee,
 * ni journalisee, et `recordRecoveryFailure` — qui existe precisement pour la rendre VISIBLE —
 * n'etait jamais appele.
 *
 * Ce test exige donc que l'echec soit ENREGISTRE, pas avale. Un `catch` vide le ferait taire tout
 * aussi bien, et serait un remede pire que le mal.
 */
describe('RunWorktreeCoordinator — un echec de reconciliation differee est ENREGISTRE', () => {
  it('inscrit l echec en activite au lieu de le laisser filer en rejet non gere', async () => {
    const messageDeLEchec = 'spawnSync git ENOENT (simule)'
    /**
     * Le manager MINIMAL qui declenche le chemin : `reconcileResidues` jette, donc
     * `reconcileExistingAsync` rejette. Seules les methodes reellement atteintes sont fournies —
     * un faux objet plus large masquerait quelle surface est en cause.
     */
    const manager = {
      reconcileResidues: () => {
        throw new Error(messageDeLEchec)
      },
      listAgentIds: () => [],
      operationsAreIsolated: () => false
    }

    // `deferRecoveryUntil` DEJA resolu : la reconciliation part au tour de boucle suivant, sans
    // dependre d'une minuterie — le test mesure un ordonnancement, jamais un delai.
    const coordinateur = new RunWorktreeCoordinator({
      manager: manager as never,
      deferRecoveryUntil: Promise.resolve()
    } as never)

    // On laisse la promesse differee se regler, puis son `catch` s'executer.
    await new Promise<void>((resoudre) => setImmediate(resoudre))
    await new Promise<void>((resoudre) => setImmediate(resoudre))

    const echec = coordinateur.activity().find((entree) => entree.agentId === 'recovery-inventory')
    expect(echec).toBeDefined()
    expect(echec?.state).toBe('blocked')
    // Le MESSAGE doit survivre : un echec enregistre sans sa cause n'aide personne a diagnostiquer.
    expect(echec?.detail).toContain('ENOENT')
  })
})
