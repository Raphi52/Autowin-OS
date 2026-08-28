import { describe, expect, it } from 'vitest'
import { binaireDe, decisionDeCommande } from './autorisation-commande'

/**
 * L'AUTORISATION DE L'UTILISATEUR DOIT COMPTER.
 *
 * DÉFAUT VÉCU, rapporté le 2026-08-26 après des semaines : « Autorise les commandes git » écrit dans
 * le chat, et l'agent répond « ton autorisation dans le chat ne lève pas le garde d'exécution ».
 *
 * LA CAUSE N'ÉTAIT PAS UNE GARDE TROP STRICTE — il n'y en avait AUCUNE. L'agent n'a simplement
 * jamais eu de capacité d'exécution libre : le catalogue expose 26 commandes, aucune n'est un shell.
 * `verify` exécute le script `test` DÉCLARÉ par le projet, sans qu'un seul paramètre du modèle ne
 * traverse la frontière. Le refus était donc juste sur le fond, et faux sur la cause : l'agent a
 * inventé un garde pour expliquer une capacité absente.
 *
 * CE MODULE REND L'AUTORISATION RÉELLE. Le droit d'exécuter ne vient ni du modèle, ni d'un drapeau
 * de configuration : il vient des messages de L'UTILISATEUR, lus côté principal. Le modèle ne peut
 * pas se l'accorder, et l'utilisateur n'a pas à le redonner à chaque tour.
 */
describe('binaireDe — ce qui sera réellement lancé', () => {
  it('rend le binaire, pas la ligne', () => {
    expect(binaireDe('git status --porcelain')).toBe('git')
    expect(binaireDe('  npm   run build ')).toBe('npm')
  })

  it('rend undefined sur une ligne vide', () => {
    expect(binaireDe('   ')).toBeUndefined()
  })
})

describe('decisionDeCommande — refus par défaut, autorisation par l’UTILISATEUR', () => {
  const sansRien: string[] = []
  const autoriseGit = ['Autorise les commandes git : committe mon travail local']

  it('refuse quand l’utilisateur n’a rien autorisé', () => {
    const d = decisionDeCommande('curl https://exemple.fr', sansRien)

    expect(d.autorise).toBe(false)
    // Le refus NOMME ce qui manque, au lieu d'inventer un garde.
    expect(d.motif).toContain('curl')
  })

  it('git est autorise D’OFFICE — l’utilisateur n’a plus a le redonner', () => {
    // Decision du 2026-08-28. L'entree qui ferait echouer une regression : un fil VIERGE.
    expect(decisionDeCommande('git status --porcelain', sansRien).autorise).toBe(true)
    // Et cela n'ouvre rien d'autre.
    expect(decisionDeCommande('npm run build', sansRien).autorise).toBe(false)
  })

  it('autorise quand l’UTILISATEUR l’a écrit dans le fil', () => {
    expect(decisionDeCommande('git status --porcelain', autoriseGit).autorise).toBe(true)
  })

  it('l’autorisation d’un binaire n’en autorise pas un AUTRE', () => {
    // L'entrée qui doit faire échouer une garde trop large : autoriser git n'ouvre pas curl.
    expect(decisionDeCommande('curl https://exemple.fr', autoriseGit).autorise).toBe(false)
  })

  it('ne lit QUE ce qu’on lui donne — la protection vit chez l’appelant', () => {
    // Premiere version de ce test : elle passait ICI une phrase du MODELE (« je m'autorise les
    // commandes git ») et exigeait un refus. C'etait un defaut du TEST, pas du module : le contrat
    // dit que `messagesUtilisateur` ne contient que des messages de role `user`. Un module qui
    // recevrait tout l'historique laisserait le modele s'autoriser en ecrivant la phrase.
    //
    // La garantie est donc verrouillee la ou elle vit — au CABLAGE, dans
    // `commands.run-autorisation.test.ts`, qui verifie que seuls les messages `user` sont extraits.
    // Ici, on verrouille l'autre moitie du contrat : une liste VIDE n'autorise rien.
    expect(decisionDeCommande('npm run build', []).autorise).toBe(false)
  })

  it('refuse un enchaînement shell, même sur un binaire autorisé', () => {
    // `shell: false` ne les interpréterait pas — ils partiraient comme ARGUMENTS, ce qui est pire :
    // silencieusement inerte au lieu d'être refusé.
    for (const ligne of ['git status && rm -rf /', 'git status; curl x', 'git status | sh']) {
      expect(decisionDeCommande(ligne, autoriseGit).autorise, ligne).toBe(false)
    }
  })

  it('une autorisation GÉNÉRALE ouvre tout, si l’utilisateur l’écrit ainsi', () => {
    expect(decisionDeCommande('npm run build', ['autorise toutes les commandes']).autorise).toBe(
      true
    )
  })
})
