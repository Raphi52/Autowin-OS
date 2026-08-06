import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Le workflow d'un tour ne doit appartenir QU'À CE TOUR.
 *
 * Défaut visé (classé prioritaire par un audit adversarial le 2026-08-05) : `activeWorkflow` est un
 * champ MUTABLE et GLOBAL de l'instance `AutowinOS`. Il est posé autour d'un run puis retiré dans un
 * `finally`. Deux conversations qui tournent en même temps le partagent : la seconde écrase la
 * première, et le `finally` de l'une efface le workflow de l'autre. Un run correct est corrompu par
 * un run voisin.
 *
 * PORTÉE DE CETTE PREUVE — à lire avant de s'y fier. Ce test est STRUCTUREL : il lit la source, il
 * n'exécute pas deux conversations. Le dépôt emploie déjà cette forme là où un branchement ne se
 * constate pas sans lancer Electron (`workflow-selection.test.ts`, `workflow-bench-ipc.test.ts`).
 * Elle prouve que l'état partagé a DISPARU, pas qu'aucune contamination ne subsiste par un autre
 * chemin. Le jour où un harnais sait instancier `AutowinOS`, le vrai test est : deux conversations
 * entrelacées, chacune conserve son workflow — et il doit remplacer celui-ci, pas s'y ajouter.
 */

const os = readFileSync(new URL('./os.ts', import.meta.url), 'utf8')

describe('isolation du workflow entre conversations', () => {
  it('le workflow ne survit pas dans un champ d’instance partagé', () => {
    // `private activeWorkflow?: ...` est LA cause : un seul emplacement pour tous les tours.
    expect(os).not.toMatch(/private\s+activeWorkflow\s*[?:]/)
  })

  it('aucun `finally` ne remet le workflow partagé à zéro — il n’y a plus rien à remettre', () => {
    // `os.ts:707` : `if (posed) this.activeWorkflow = undefined`. Ce retrait n'existe QUE parce que
    // la pose est globale — et c'est lui qui, chez un run concurrent, efface le workflow d'un autre
    // tour. Sa disparition est le signe que le workflow voyage désormais avec son run.
    expect(os).not.toMatch(/this\.activeWorkflow\s*=/)
  })

  /**
   * La preuve POSITIVE : sans elle, supprimer le champ pourrait n'avoir que déplacé l'état partagé.
   *
   * Le cadrage prévoyait de passer le workflow en paramètre de `run()` — 13 sites d'appel à
   * traverser. La mesure a révélé mieux : `this.orchestrator` n'était utilisé qu'à DEUX endroits,
   * sa construction et l'unique `run()`. Construire l'orchestrateur PAR RUN donne à chaque tour sa
   * propre closure `currentWorkflow`, sans toucher un seul des 13 sites. Le workflow ne peut plus
   * fuir d'un run à l'autre parce qu'il n'existe plus d'endroit où il pourrait être partagé.
   */
  it('chaque run construit son orchestrateur, avec SA closure de workflow', () => {
    // Le workflow du tour est résolu…
    expect(os).toMatch(/const workflowDuRun = await this\.poseConversationWorkflow\(/)
    // …puis enfermé dans un orchestrateur bâti pour lui seul, via la fabrique.
    expect(os).toMatch(/const orchestrator = this\.orchestrateurPour\(workflowDuRun\)/)
    expect(os).toMatch(
      /orchestrateurPour\(workflow\?: WorkflowRunOverride\)[\s\S]{0,200}currentWorkflow: \(\) => workflow/
    )
  })
})
