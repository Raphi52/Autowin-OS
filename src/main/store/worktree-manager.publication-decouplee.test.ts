import { afterEach, describe, expect, it, vi } from 'vitest'

/** Vrais dépôts git en tmp : mêmes contraintes d'I/O que la suite publication. */
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { WorktreeManager } from './worktree-manager'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, roots, tempRepo } from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)

/**
 * DÉCOUPLER LA PUBLICATION DE L'ÉTAT DE L'ARBRE DE L'UTILISATEUR.
 *
 * Défaut mesuré le 2026-08-18 : 216 `base-in-progress` contre 86 `base-dirty` dans
 * `runs/**‍/trace.json`. La cause n'est PAS une course entre agents — `MERGE_HEAD` et `index` sont
 * par copie (`.git/worktrees/<id>/…`), donc aucun run ne peut bloquer un autre. Ce qui bloque, c'est
 * que la publication avance la branche CHECKOUTÉE par l'utilisateur, et exige donc son arbre au repos
 * à un instant qu'elle ne choisit pas — pendant qu'il y travaille en continu.
 *
 * Le refus arrivait AVANT que le travail de la copie soit committé : il restait en fichiers libres
 * dans un dossier de worktree, sans adresse, pendant que le rapport annonçait « rien n'est publié ».
 *
 * Deux pistes ont été écartées, et pour des raisons qui valent d'être écrites :
 *   1. réutiliser `refs/autowin/publications/<id>` — REFUSÉ : c'est le candidat d'une transaction
 *      dont la reprise exige `baseSha` ET `sha` pour ancêtres ; y écrire tôt transformerait un
 *      réessai réparable en `merge-failed` dur dès que la base avance ;
 *   2. desserrer `validate_initial_workspace` dans le hook `reference-transaction` pour ce ref —
 *      REFUSÉ : cette atomicité alimente le mécanisme de compensation, et la toucher pour un gain
 *      qu'un ref distinct offre gratuitement serait un risque sans contrepartie.
 *
 * D'où `refs/autowin/rescue/<agentId>` : une adresse qui ne promet rien d'autre que « le travail est
 * là, atteignable, non publié ». Le chemin de publication et sa compensation restent INTACTS.
 *
 * Ce que ces tests exigent : sur une base occupée, le travail devient ATTEIGNABLE sans que la branche
 * de l'utilisateur ni son arbre ne bougent d'un octet — et la garde `base-dirty` continue de primer.
 */
describe('publication découplée de l’arbre utilisateur', () => {
  /** Met la base dans un état d'opération en cours, comme un `pull --rebase` humain à cet instant. */
  function baseEnOperation(repo: string): { head: string; status: string } {
    git(repo, 'checkout', '-q', '-b', 'cote-utilisateur')
    writeFileSync(join(repo, 'conflit.txt'), 'version utilisateur\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'côté utilisateur')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'conflit.txt'), 'version main\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'côté main')
    // Merge volontairement conflictuel, laissé EN COURS : c'est l'état réel d'un humain au travail.
    // `git()` lève sur code ≠ 0, et un merge en conflit sort en 1 : l'échec est ATTENDU, pas un raté.
    try {
      git(repo, 'merge', 'cote-utilisateur')
      throw new Error('le merge devait entrer en conflit — le décor du test ne tient plus')
    } catch (erreur) {
      const texte = erreur instanceof Error ? erreur.message : String(erreur)
      if (texte.includes('le décor du test')) throw erreur
    }
    // Le décor n'est valide QUE si la base est réellement en opération.
    expect(() => git(repo, 'rev-parse', 'MERGE_HEAD')).not.toThrow()
    return { head: git(repo, 'rev-parse', 'HEAD'), status: git(repo, 'status', '--porcelain') }
  }

  it('base occupée → le travail de l’agent est ATTEIGNABLE par le ref privé', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l’agent\n')
    baseEnOperation(repo)

    const res = wm.finalize('builder')

    // On n'exige PAS `merged` : la branche de l'utilisateur n'a pas avancé, et c'est normal.
    expect(res.outcome).not.toBe('merged')
    // Mais le travail doit être atteignable : le ref privé existe et porte le livrable.
    const ref = git(repo, 'rev-parse', '--verify', 'refs/autowin/rescue/builder')
    expect(ref).toMatch(/^[0-9a-f]{40}$/)
    expect(git(repo, 'show', `${ref}:livrable.txt`)).toContain('travail de l’agent')
  })

  it('l’arbre et la branche de l’utilisateur ne bougent PAS d’un octet', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l’agent\n')
    const avant = baseEnOperation(repo)

    const res = wm.finalize('builder')

    // ANCRAGE sur la précondition : sans elle ce test était NON DISCRIMINANT — un juge externe a
    // montré qu'il restait vert quand RIEN n'était écrit du tout, l'immobilité étant trivialement
    // satisfaite par un no-op. Il ne prouve l'innocuité que si l'écriture a bien eu lieu.
    expect((res as { rescueRef?: string }).rescueRef).toBe('refs/autowin/rescue/builder')

    expect(git(repo, 'rev-parse', 'HEAD')).toBe(avant.head)
    expect(git(repo, 'status', '--porcelain')).toBe(avant.status)
    // Le merge humain en cours n'est ni terminé ni annulé par Autowin.
    expect(() => git(repo, 'rev-parse', 'MERGE_HEAD')).not.toThrow()
    expect(readFileSync(join(repo, 'conflit.txt'), 'utf8')).toContain('version main')
  })

  it('la garde base-dirty reste intacte : elle prime et n’écrit AUCUN ref', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    // Conflit RÉEL avec du travail non committé de l'utilisateur sur le même fichier.
    writeFileSync(join(repo, 'a.txt'), 'travail local non committé\n')
    writeFileSync(join(path, 'a.txt'), 'travail de la copie\n')

    const res = wm.finalize('builder')

    expect(res).toMatchObject({ outcome: 'blocked', reason: 'base-dirty' })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('travail local non committé')
    // Découpler ne veut pas dire publier par-dessus le travail de l'utilisateur.
    expect(() => git(repo, 'rev-parse', '--verify', 'refs/autowin/rescue/builder')).toThrow()
  })

  it('base au repos → le confort actuel ne régresse pas : ça fusionne pour de vrai', () => {
    const repo = tempRepo()
    const wm = manager(repo)
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l’agent\n')

    const res = wm.finalize('builder')

    expect(res.outcome).toBe('merged')
    expect(readFileSync(join(repo, 'livrable.txt'), 'utf8')).toContain('travail de l’agent')
  })
})

/**
 * NE JAMAIS ANNONCER UNE ADRESSE POUR UN TRAVAIL INEXISTANT.
 *
 * Défaut trouvé par un juge externe le 2026-08-18, sur du code déjà poussé, et REPRODUIT par lui en
 * isolation. La détection « rien à sauver » reposait sur `git rev-parse HEAD@{1}` :
 *
 *     if (!dirty && baseSha.code === 0 && baseSha.stdout.trim() === sha) return false
 *     return this.tryGitFn(baseRepo, ['update-ref', rescueRef, sha]).code === 0
 *
 * Quand le reflog est absent — `core.logAllRefUpdates=false`, une configuration git réelle et hors du
 * contrôle de l'app — `HEAD@{1}` sort en code 128. La garde ne se déclenche donc PAS, l'exécution
 * tombe dans la branche d'écriture, et un ref est posé sur un commit STRICTEMENT INCHANGÉ en rendant
 * `true` : l'utilisateur lit « travail atteignable » pour un travail qui n'existe pas. C'est
 * exactement le faux vert que le commentaire de la fonction prétendait combattre — un commentaire
 * MENTEUR, donc, et le pire mode de panne de ce module.
 *
 * La leçon est de forme, pas de détail : sur une AMBIGUÏTÉ, ce chemin doit échouer FERMÉ. On n'écrit
 * une adresse que sur preuve POSITIVE que la copie a produit quelque chose.
 */
describe('aucune adresse pour un travail inexistant (fail-closed)', () => {
  it('copie SANS aucun changement + reflog absent → AUCUN ref, même base occupée', () => {
    const repo = tempRepo()
    // Le déclencheur exact du juge : git ne tiendra aucun reflog dans ce dépôt ni ses copies.
    git(repo, 'config', 'core.logAllRefUpdates', 'false')
    const wm = manager(repo)
    wm.acquire('builder')
    // On n'écrit RIEN dans la copie : il n'y a rien à sauver, et rien ne doit être annoncé.
    git(repo, 'checkout', '-q', '-b', 'cote-utilisateur')
    writeFileSync(join(repo, 'conflit.txt'), 'version utilisateur\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'côté utilisateur')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'conflit.txt'), 'version main\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'côté main')
    try {
      git(repo, 'merge', 'cote-utilisateur')
      throw new Error('le merge devait entrer en conflit — le décor du test ne tient plus')
    } catch (erreur) {
      const texte = erreur instanceof Error ? erreur.message : String(erreur)
      if (texte.includes('le décor du test')) throw erreur
    }

    const res = wm.finalize('builder')

    expect(res.outcome).not.toBe('merged')
    // AUCUNE adresse ne doit être posée ni annoncée pour une copie qui n'a rien produit.
    expect(() => git(repo, 'rev-parse', '--verify', 'refs/autowin/rescue/builder')).toThrow()
    expect((res as { rescueRef?: string }).rescueRef).toBeUndefined()
  })
})

/**
 * NE JAMAIS SE DÉCLARER PUBLIÉ SANS L'ÊTRE — la contrainte HARD de ce chantier.
 *
 * Case DoD que j'avais cochée à tort : mon test forçait une base OCCUPÉE, c'est-à-dire l'état AMONT
 * du refus, jamais un échec de la publication elle-même. Un juge externe l'a relevé le 2026-08-18 et
 * a nommé le moyen que je n'avais pas réutilisé : les tests voisins injectent un `tryGitFn` pour
 * intercepter le git du chemin de publication. C'est donc fait ici, sur le geste qui compte —
 * l'écriture du marqueur durable et le fast-forward.
 */
describe('jamais publié sans l’être', () => {
  it('la publication durable échoue → l’issue n’est PAS « merged » et rien n’est annoncé publié', () => {
    const repo = tempRepo()
    const wtRoot = mkdtempSync(join(tmpdir(), 'autowin-wmroot-echec-'))
    roots.push(wtRoot)
    let interceptions = 0
    // Tout passe au vrai git, SAUF les écritures du chemin de publication qu'on fait échouer.
    const tryGitFn = (dir: string, args: string[]) => {
      const cible =
        (args.includes('update-ref') && args.some((a) => a.startsWith('refs/autowin/publications/'))) ||
        (args.includes('merge') && args.includes('--ff-only'))
      if (cible) {
        interceptions += 1
        return { code: 1, stdout: '', stderr: 'echec injecte de la publication durable' }
      }
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
      return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    }
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: wtRoot, tryGitFn })
    const path = wm.acquire('builder')
    writeFileSync(join(path, 'livrable.txt'), 'travail de l’agent\n')
    const headAvant = git(repo, 'rev-parse', 'HEAD')

    const res = wm.finalize('builder')

    // Le décor doit avoir mordu : sans interception, ce test ne prouverait rien.
    expect(interceptions).toBeGreaterThan(0)
    expect(res.outcome).not.toBe('merged')
    // Aucune SHA publiée ne doit être annoncée, et la branche de l'utilisateur n'a pas bougé.
    expect((res as { publishedSha?: string }).publishedSha).toBeUndefined()
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(headAvant)
  })
})
