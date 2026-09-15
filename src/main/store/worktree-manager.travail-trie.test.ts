import { afterEach, describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE BANDEAU QU'ON NE PEUT PAS REFERMER.
 *
 * Vecu le 2026-08-27 (conv-1424). Le bandeau annonce des travaux non publies ; « Traiter » depose
 * un `/salvage` ; le salvage fait son travail, juge par CONTENU, et conclut deux fois de suite :
 * « rien a republier — les deux travaux sont deja dans main, sous une implementation plus
 * avancee ». Verdict SUPERSEDED, branches conservees (le prompt l'exige : « Ne supprime AUCUNE
 * branche sans avoir consigne son SHA »).
 *
 * Trente secondes plus tard le releve repasse, et le bandeau est identique. Il n'existait AUCUN
 * moyen d'enregistrer la seule conclusion correcte : « trie, abandon assume ». `travauxNonPublies`
 * ne connaissait que deux verdicts — publiable, ou deja applique au patch-id pres. Or `git cherry`
 * ne voit pas une REECRITURE : le travail est dans la base sous une autre forme, donc il compte
 * comme non publie a jamais.
 *
 * Etat mesure du depot ce jour-la : `command-edit-…-updatebanner-tsx` -> 2 patches « + », et
 * `run-f2f7fec8c587-1` -> 1, tous deux prouves SUPERSEDED par lecture du fichier cible et par le
 * commit de greffe `1bbedc81`. Le bandeau les aurait cries indefiniment.
 *
 * On ne supprime rien : on MARQUE. Et le marquage porte le SHA, donc un travail qui REPREND sur la
 * meme branche ressort — sinon on aurait remplace un bandeau qui crie par un bandeau qui se tait.
 */
describe('WorktreeManager — un travail TRIE cesse de crier, sans rien perdre', () => {
  afterEach(() => nettoyerRacines())

  function brancheDeSecours(repo: string, agentId: string, fichier: string): string {
    const base = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'branch', `autowin/recovery/${agentId}`, base)
    const chemin = join(repo, fichier)
    writeFileSync(chemin, 'contenu du travail\n')
    git(repo, 'add', fichier)
    git(repo, 'commit', '-q', '-m', `travail ${agentId}`)
    const sha = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'update-ref', `refs/heads/autowin/recovery/${agentId}`, sha)
    git(repo, 'reset', '-q', '--hard', base)
    return sha
  }

  it('le marquage retire le travail de l’inventaire — et la branche reste intacte', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const sha = brancheDeSecours(repo, 'run-superseded', 'reecrit.txt')

    // Avant : le travail crie, a juste titre — `git cherry` le voit non applique.
    expect(wm.travauxNonPublies()).toContain('run-superseded')

    wm.marquerTravailTrie('run-superseded')

    // Apres : il se tait…
    expect(wm.travauxNonPublies()).not.toContain('run-superseded')
    // …et rien n'a ete detruit : la branche et son SHA repondent toujours.
    expect(git(repo, 'rev-parse', 'autowin/recovery/run-superseded')).toBe(sha)
  })

  /*
   * LE GISEMENT QUI SE RECENSAIT MAIS NE SE MARQUAIT PAS.
   *
   * Mesure du 2026-09-12 (conv-506) : quand la publication est refusee parce que l'arbre principal
   * est sale, `poserAttenteDIntegration` depose le commit sur `refs/autowin/integration/<agentId>`.
   * Si la copie est ensuite nettoyee, cette adresse est le SEUL endroit ou le travail existe : ni
   * branche de secours, ni sauvetage, ni bureau. `marquerTravailTrie` ne resolvait que les deux
   * premiers, donc il rendait `false` et le travail restait incrementable a l'infini — le bandeau
   * qu'on ne peut pas refermer, revenu par une autre porte.
   */
  it('un travail pose sur l’adresse d’ATTENTE se marque aussi', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const base = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(repo, 'attente.txt'), 'travail refuse pour arbre sale')
    git(repo, 'add', 'attente.txt')
    git(repo, 'commit', '-q', '-m', 'travail run-attente')
    const sha = git(repo, 'rev-parse', 'HEAD')
    // SEULE trace du travail : l'adresse d'attente. Aucune branche de secours, aucun sauvetage.
    git(repo, 'update-ref', 'refs/autowin/integration/run-attente', sha)
    git(repo, 'reset', '-q', '--hard', base)

    expect(wm.marquerTravailTrie('run-attente')).toBe(true)
    // Le marquage porte le SHA JUGE, et n'a rien detruit : l'adresse repond toujours.
    expect(wm.shaTravailTrie('run-attente')).toBe(sha)
    expect(git(repo, 'rev-parse', 'refs/autowin/integration/run-attente')).toBe(sha)
  })

  /*
   * L'AUTRE MOITIE DU MEME DEFAUT : marquable ne veut pas dire VISIBLE.
   *
   * Mesure du 2026-09-12 (conv-506) : 26 adresses d'attente dormaient dans le depot, dont QUATRE
   * portant du travail jamais applique. Le recensement ne regardait que quatre gisements — branche
   * de secours, bureau pose, sauvetage, bureau sali — et jamais `refs/autowin/integration/<id>`.
   * Un travail refuse faute d'arbre propre, dont la copie a ensuite ete nettoyee, etait donc
   * INVISIBLE a jamais : exactement le travail que l'utilisateur finit par refaire.
   */
  it('un travail pose sur une adresse d’ATTENTE est RECENSE', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const base = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(repo, 'attente-recensee.txt'), 'travail refuse pour arbre sale')
    git(repo, 'add', 'attente-recensee.txt')
    git(repo, 'commit', '-q', '-m', 'travail run-attente-vu')
    const sha = git(repo, 'rev-parse', 'HEAD')
    // SEULE trace : l'adresse d'attente. Aucune branche de secours, aucun sauvetage, aucun bureau.
    git(repo, 'update-ref', 'refs/autowin/integration/run-attente-vu', sha)
    git(repo, 'reset', '-q', '--hard', base)

    // Il CRIE, parce qu'il porte du travail que la base n'a pas.
    expect(wm.travauxNonPublies()).toContain('run-attente-vu')

    // Et il se tait des qu'il est trie — sans que rien ne soit supprime.
    wm.marquerTravailTrie('run-attente-vu')
    expect(wm.travauxNonPublies()).not.toContain('run-attente-vu')
    expect(git(repo, 'rev-parse', 'refs/autowin/integration/run-attente-vu')).toBe(sha)
  })

  it('un travail qui REPREND apres le tri ressort de lui-meme', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    brancheDeSecours(repo, 'run-repris', 'premier.txt')
    wm.marquerTravailTrie('run-repris')
    expect(wm.travauxNonPublies()).not.toContain('run-repris')

    // Un commit de plus sur la branche de secours : le marquage porte l'ANCIEN sha, donc il ne
    // couvre plus ce travail-la. Un marquage qui vaudrait « pour toujours » etoufferait le suivant.
    const base = git(repo, 'rev-parse', 'HEAD')
    git(repo, 'checkout', '-q', '-B', 'tmp-repris', 'autowin/recovery/run-repris')
    writeFileSync(join(repo, 'second.txt'), 'suite du travail\n')
    git(repo, 'add', 'second.txt')
    git(repo, 'commit', '-q', '-m', 'suite')
    git(repo, 'update-ref', 'refs/heads/autowin/recovery/run-repris', git(repo, 'rev-parse', 'HEAD'))
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'branch', '-q', '-D', 'tmp-repris')
    git(repo, 'reset', '-q', '--hard', base)

    expect(wm.travauxNonPublies()).toContain('run-repris')
  })

  it('marquer un identifiant inconnu ne fabrique rien', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    expect(wm.marquerTravailTrie('run-qui-n-existe-pas')).toBe(false)
  })
})
