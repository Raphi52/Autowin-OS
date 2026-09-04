import { describe, expect, it } from 'vitest'
import { binaireDe, decisionDeCommande, decouperArguments } from './autorisation-commande'

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

describe('les guillemets GROUPENT — un message en plusieurs mots arrive intact', () => {
  /**
   * DÉFAUT VÉCU (conv-46, 2026-09-01) : `git commit -m "trois mots"` repartait en autant
   * d'arguments, guillemets compris, et git répondait « pathspec 'trois' did not match any
   * file(s) ». Le lanceur coupait la ligne avec un simple `split(/\s+/)` : rien de guillemeté ne
   * survivait. Ces cas sont TOUS rouges avec l'ancien découpage.
   */
  it('garde un message entre guillemets doubles en UN seul argument', () => {
    expect(decouperArguments('git commit -m "message en plusieurs mots"')).toEqual([
      'git',
      'commit',
      '-m',
      'message en plusieurs mots'
    ])
  })

  it('accepte aussi les apostrophes', () => {
    expect(decouperArguments("git commit -m 'trois mots ici'")).toEqual([
      'git',
      'commit',
      '-m',
      'trois mots ici'
    ])
  })

  it('transmet un script entier a bash -c sans le tronquer', () => {
    expect(decouperArguments('bash -c "ALLOW_MAIN_PUSH=1 git push origin main"')).toEqual([
      'bash',
      '-c',
      'ALLOW_MAIN_PUSH=1 git push origin main'
    ])
  })

  it('ne change rien a une ligne sans guillemets', () => {
    expect(decouperArguments('  git status --short  ')).toEqual(['git', 'status', '--short'])
  })

  it('ferme un guillemet reste ouvert au lieu de perdre la fin de la ligne', () => {
    expect(decouperArguments('git commit -m "fin manquante')).toEqual([
      'git',
      'commit',
      '-m',
      'fin manquante'
    ])
  })
})

describe('decisionDeCommande — plus aucune autorisation a retaper', () => {
  const sansRien: string[] = []
  const autoriseGit = ['Autorise les commandes git : committe mon travail local']

  /**
   * DECISION DU 2026-08-28 : « je ne veux plus qu'Autowin me demande de dire autorise nanani
   * pour me debloquer ». Le refus par defaut a ete leve (`AUTORISATION_GENERALE_PAR_DEFAUT`).
   * Ce qui RESTE verrouille est la propriete 3 — aucun enchainement shell —, testee plus bas :
   * c'est elle, et non la liste nominale, qui empeche `git status && rm -rf /`.
   */
  it('un binaire jamais nomme part quand meme, sur un fil VIERGE', () => {
    expect(decisionDeCommande('curl https://exemple.fr', sansRien).autorise).toBe(true)
    expect(decisionDeCommande('npm run build', []).autorise).toBe(true)
  })

  it('git part toujours d’office', () => {
    expect(decisionDeCommande('git status --porcelain', sansRien).autorise).toBe(true)
  })

  it('autorise quand l’UTILISATEUR l’a écrit dans le fil', () => {
    expect(decisionDeCommande('git status --porcelain', autoriseGit).autorise).toBe(true)
  })

  it('une ligne vide n’est jamais une commande', () => {
    // Ce que l'ouverture generale ne doit PAS emporter : un binaire vide ou biscornu.
    expect(decisionDeCommande('   ', sansRien).autorise).toBe(false)
    expect(decisionDeCommande('ls>/tmp/x', sansRien).autorise).toBe(false)
  })

  /*
   * UN OPERATEUR ENTRE GUILLEMETS EST DU TEXTE, PAS UN ENCHAINEMENT.
   *
   * Mesure le 2026-09-04 (conv-233) : une ligne dont le `||` vivait a l'interieur d'une chaine de
   * caracteres etait refusee comme enchainement shell — deux appels perdus. La ligne part en
   * `shell: false` : ce qui est guillemete devient UN argument litteral, il n'enchaine rien.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retester la ligne ENTIERE au lieu de ses seuls
   * caracteres hors guillemets.
   */
  it('accepte un opérateur situé À L’INTÉRIEUR d’une chaîne de caractères', () => {
    for (const ligne of [
      'python -c "print(1 || 2)"',
      'node -e "console.log(a && b)"',
      "git commit -m 'corrige a; b'"
    ]) {
      expect(decisionDeCommande(ligne, []).autorise).toBe(true)
    }
  })

  /* La garde reste entiere HORS guillemets : c'est elle qui empeche `git status && rm -rf /`. */
  it('refuse toujours un enchaînement réel quand la ligne porte aussi des guillemets', () => {
    expect(decisionDeCommande('git commit -m "ok" && rm -rf /', []).autorise).toBe(false)
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
