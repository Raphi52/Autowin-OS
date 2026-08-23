import { describe, expect, it } from 'vitest'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

/**
 * LE SYMPTÔME, mesuré sur l'app en marche le 2026-08-23 : elle annonçait 26 worktrees dont 22
 * « bloqués », alors que 4 copies seulement existaient sur disque. L'utilisateur, lui, le vivait
 * comme « pk le run d'hier est encore marqué en cours ? » — et il avait raison de trouver ça faux.
 *
 * LA CHAÎNE, établie en lisant le code puis vérifiée sur le dépôt réel :
 *   1. un `command-edit` échoue à fusionner ; le filet crée une branche `autowin/recovery/<id>` —
 *      comportement voulu, il préserve le travail ;
 *   2. le balayeur supprime plus tard la copie de travail — voulu aussi, et il marche ;
 *   3. mais la branche reste, or `listAgentIds()` additionne les DOSSIERS et ces BRANCHES
 *      (`worktree-manager.ts:748`). L'id reste donc « connu du gestionnaire » à jamais.
 *   4. La purge d'états commence par `if (managerIds.includes(runId)) continue` : elle passe son
 *      tour, définitivement. L'entrée survit et s'affiche comme une copie bloquée.
 *
 * LE DÉFAUT CORRIGÉ ICI est le plus petit des quatre maillons, et le seul qui ne détruise rien :
 * le champ `worktreeAvailable` existait déjà, mais n'était JAMAIS mis à `false` — seulement à `true`
 * sur les chemins heureux. Mesuré sur l'app : 21 des 22 entrées bloquées le portaient à `undefined`,
 * c'est-à-dire « on n'a jamais regardé ». Impossible, pour qui lit cette liste, de distinguer une
 * copie présente d'une copie disparue.
 *
 * On ne supprime donc NI la branche de secours (elle porte peut-être du travail), NI l'entrée
 * (elle reste l'adresse d'une reprise) : on dit la vérité sur la copie.
 */
describe('RunWorktreeCoordinator — une copie disparue le DIT', () => {
  const RUN = 'command-edit-fantome'
  const CHEMIN_ABSENT = 'C:/chemin/qui/n/existe/pas/agent__command-edit-fantome'

  function coordinateur() {
    const manager = {
      // La branche de secours survit : le gestionnaire connaît donc encore cet id, exactement
      // comme en production. C'est ce qui met la purge en échec — le test doit le reproduire.
      listAgentIds: () => [RUN],
      hasActiveProcesses: () => false,
      reconcileResidues: () => ({ cleaned: 0, recovered: [], blocked: [], swept: [] }),
      operationsAreIsolated: () => false,
      describe: () => {
        throw new Error('copie absente')
      },
      changedFiles: () => []
    }
    const stateStore = {
      list: () => [
        {
          version: 1,
          repoId: 'depot',
          runId: RUN,
          agentName: 'Agent récupéré',
          worktreePath: CHEMIN_ABSENT,
          publication: 'blocked',
          files: [],
          attentionReason: 'merge-failed',
          sourceSha: null,
          publishedSha: null
        }
      ],
      get: () => undefined,
      save: () => {},
      remove: () => {}
    }
    return new RunWorktreeCoordinator({
      manager: manager as never,
      stateStore: stateStore as never
    } as never)
  }

  it('rapporte worktreeAvailable=false quand la copie n’est plus sur disque', () => {
    const entree = coordinateur()
      .activity()
      .find((a) => a.agentId === RUN)
    expect(entree).toBeDefined()
    // `undefined` voudrait dire « on n'a pas regardé » : c'est précisément l'ambiguïté qui faisait
    // passer 21 copies disparues pour des runs vivants.
    expect(entree?.worktreeAvailable).toBe(false)
  })

  it('n’efface ni l’entrée ni son chemin — la reprise reste adressable', () => {
    const entree = coordinateur()
      .activity()
      .find((a) => a.agentId === RUN)
    expect(entree?.worktreePath).toBe(CHEMIN_ABSENT)
  })
})
