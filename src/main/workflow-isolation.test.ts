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
    // Un override explicite reste propre au run ; sinon le workflow du tour est résolu normalement.
    expect(os).toMatch(
      /const workflowDuRun\s*=\s*runOptions\.workflowOverride\s*\?\?\s*\(await this\.poseConversationWorkflow\(/
    )
    /*
     * …puis enfermé dans un orchestrateur bâti pour lui seul, via la fabrique.
     *
     * La fabrique reçoit un SECOND argument depuis le 2026-09-06 — la tâche, pour reconnaître le
     * préfixe de la fixture d'orchestration. L'ancienne forme exigeait `(workflowDuRun)` EXACTEMENT
     * et rougissait sur cet ajout, alors que l'invariant qu'elle protège — un orchestrateur par run,
     * avec SA closure — est intact. On exige donc le premier argument et on laisse la suite libre :
     * verrouiller une signature entière, c'est faire tomber la garde à chaque paramètre ajouté,
     * jusqu'à ce que quelqu'un la desserre pour de mauvaises raisons.
     */
    expect(os).toMatch(/const orchestrator = this\.orchestrateurPour\(workflowDuRun[,)]/)
    /*
     * Le CORPS entier de la fabrique, pas une signature sur une ligne ni une fenêtre de N caractères
     * (conv-770, 2026-09-28) : depuis cba6e809 (2026-09-17), l'ajout du paramètre `workspace` a mis la
     * signature sur plusieurs lignes — l'ancien motif `orchestrateurPour\(workflow\?:` ne la trouvait
     * plus —, et deux commentaires ont repoussé la closure à 1 814 caractères, au-delà de la fenêtre
     * de 1 600. L'invariant, lui, n'avait pas changé. Et c'est CHAQUE orchestrateur construit
     * par la fabrique qui doit porter la closure — la branche fixture comprise —, pas « au moins
     * une occurrence quelque part après la signature ».
     */
    const code = os.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    const signature = code.search(
      /orchestrateurPour\(\s*workflow\?: WorkflowRunOverride[^)]*\)[^{]*\{/
    )
    expect(signature).toBeGreaterThanOrEqual(0)
    const fermeture = (texte: string, depuis: number, ouvre: string, ferme: string): number => {
      let profondeur = 0
      for (let i = depuis; i < texte.length; i++) {
        if (texte[i] === ouvre) profondeur++
        else if (texte[i] === ferme && --profondeur === 0) return i
      }
      throw new Error(`${ouvre} non fermé à partir de ${depuis}`)
    }
    const ouverture = code.indexOf('{', signature)
    const corps = code.slice(ouverture, fermeture(code, ouverture, '{', '}') + 1)
    const constructions: string[] = []
    let i = corps.indexOf('new Orchestrator(')
    while (i >= 0) {
      const debut = i + 'new Orchestrator'.length
      constructions.push(corps.slice(debut, fermeture(corps, debut, '(', ')') + 1))
      i = corps.indexOf('new Orchestrator(', debut)
    }
    expect(constructions.length).toBeGreaterThan(0)
    for (const args of constructions) expect(args).toContain('currentWorkflow: () => workflow')
  })
})
