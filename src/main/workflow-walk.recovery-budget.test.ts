import { describe, expect, it } from 'vitest'
import { estJugeTerminal, initialBudget, nextNode } from './workflow-walk'
import { nodeRanks } from './workflow-graph'
import { recoveriesFromGraph } from './workflow-graph'
import { DEFAULT_WORKFLOWS } from './workflow-defaults'

/**
 * COMBIEN de passages `build` un run qui reste ROUGE effectue-t-il vraiment ?
 *
 * La question n'est pas theorique. Deux mecaniques lisent le MEME budget d'arete :
 *  - le MARCHEUR (`workflow-walk`) route un juge sur son verdict et consomme `maxTraversals` ;
 *  - la BOUCLE DE REPARATION (`orchestrator`) calcule ses tentatives avec `recoveriesFromGraph`,
 *    qui lit ce meme `maxTraversals`.
 *
 * Le marcheur declare pourtant laisser le retour rouge a la boucle : il s'arrete sur un juge SANS
 * arete sortante (`orchestrator.ts`, garde du juge terminal). Or les profils livres donnent a
 * `judge-1` une arete sortante `when: 'red'` vers `build-1` — donc ce juge n'est PAS reconnu comme
 * terminal, et le marcheur le route lui-meme.
 *
 * Ce test ne corrige rien : il MESURE, pour que la politique de relance soit changee sur un chiffre
 * observe et non sur une lecture de code. Il documente le comportement ACTUEL ; si une correction
 * le fait changer, c'est ici qu'on le verra.
 */
function passagesBuildDuMarcheur(profilId: string): {
  passages: number
  recoveriesLuesParLaBoucle: number | undefined
} {
  const profil = DEFAULT_WORKFLOWS.find((p) => p.id === profilId)
  if (!profil) throw new Error(`profil introuvable : ${profilId}`)
  const graphe = profil.graph!
  const rangs = nodeRanks(graphe)
  const budget = initialBudget(graphe, rangs)
  const parId = new Map(graphe.nodes.map((n) => [n.id, n]))

  let courant: string | undefined = graphe.entry
  let passages = 0
  // Tout le monde rend ROUGE : le pire cas, celui qui epuise les retours.
  for (let pas = 0; pas < 200 && courant && parId.has(courant); pas++) {
    const node = parId.get(courant)!
    if (node.phase === 'build') passages += 1
    /**
     * On appelle la VRAIE garde, pas une copie.
     *
     * Ma premiere version reproduisait la condition de l'orchestrateur a la main. Consequence : apres
     * avoir CORRIGE cette condition dans le produit, l'instrument continuait d'annoncer les memes
     * chiffres — il mesurait son propre miroir, donc il aurait certifie l'absence d'effet d'un
     * correctif qui marchait. Un instrument qui duplique la logique testee ne mesure rien.
     */
    if (estJugeTerminal(graphe, courant, rangs)) break
    // `nextNode` rend un OBJET `{ to, edge }`, pas un identifiant. Ma premiere version affectait
    // l'objet a `courant` : la boucle sortait au premier tour et l'instrument annoncait « 1 passage »
    // pour `correctif` et « 0 » pour `feature` — un chiffre impossible, seul indice que la mesure
    // etait fausse. Un instrument qui se trompe silencieusement est pire qu'une absence de mesure.
    courant = nextNode(graphe, courant, 'red', budget, rangs)?.to
  }
  return { passages, recoveriesLuesParLaBoucle: recoveriesFromGraph(graphe) }
}

describe('budget de retour : ce que le marcheur consomme vs ce que la boucle relit', () => {
  it('MESURE le profil « correctif » (judge-1 → build-1, maxTraversals 2)', () => {
    const { passages, recoveriesLuesParLaBoucle } = passagesBuildDuMarcheur('correctif')
    // Valeurs OBSERVEES, pas souhaitees : ce test est un instrument de mesure.
    expect(recoveriesLuesParLaBoucle).toBe(2)
    // Le total reel qu'un run tout-rouge peut atteindre : les passages du marcheur, PLUS ceux que la
    // boucle de reparation ajoute (`MAX_ATTEMPTS = 1 + recoveries`), chacun rejouant `build`.
    // Un seul passage de marcheur : le retour rouge appartient a la boucle de reparation.
    expect(passages).toBe(1)
    const totalPire = passages + (recoveriesLuesParLaBoucle ?? 0)
    expect(totalPire).toBe(3) // 1 + maxTraversals(2) : la promesse du profil, ni plus ni moins
    console.log(
      `[MESURE correctif] passages build du marcheur = ${passages} · recoveries relues par la boucle = ${recoveriesLuesParLaBoucle} · pire cas cumule = ${totalPire}`
    )
  })

  it('MESURE le profil « feature » (retours vers build ET vers frame)', () => {
    const { passages, recoveriesLuesParLaBoucle } = passagesBuildDuMarcheur('feature')
    console.log(
      `[MESURE feature] passages build du marcheur = ${passages} · recoveries relues par la boucle = ${recoveriesLuesParLaBoucle}`
    )
  })

  it('un profil SANS retour rouge n’offre aucune reparation a relire', () => {
    // `eclair` : un seul noeud `build`, aucune arete. C'est le cas ou les deux mecaniques
    // s'accordent, faute de budget a se disputer.
    const eclair = DEFAULT_WORKFLOWS.find((p) => p.id === 'eclair')!
    expect(recoveriesFromGraph(eclair.graph!)).toBe(undefined)
    expect(passagesBuildDuMarcheur('eclair').passages).toBe(1)
  })

  it('MESURE « panel-critique » (trois juges, retour maxTraversals 3)', () => {
    const { passages, recoveriesLuesParLaBoucle } = passagesBuildDuMarcheur('panel-critique')
    console.log(
      `[MESURE panel-critique] passages build du marcheur = ${passages} · recoveries relues par la boucle = ${recoveriesLuesParLaBoucle}`
    )
    /**
     * GARDE DU CORRECTIF, et non plus constat du defaut.
     *
     * Cette assertion exigeait `> 1` passage : elle encodait la valeur du BUG, mesuree avant
     * correction (4 passages, budget de retour consomme par le marcheur PUIS relu par la boucle).
     * Depuis que `estJugeTerminal` reconnait un juge dont toutes les sorties sont des retours, le
     * marcheur s'arrete la et laisse le retour rouge a la boucle : UN seul passage, et un pire cas
     * qui vaut exactement ce que le profil annonce.
     */
    expect(passages).toBe(1)
    expect(recoveriesLuesParLaBoucle).toBe(3)
    // Le pire cas d'un run tout-rouge est desormais EXACTEMENT la promesse du profil.
    expect(passages + (recoveriesLuesParLaBoucle ?? 0)).toBe(4)
  })
})
