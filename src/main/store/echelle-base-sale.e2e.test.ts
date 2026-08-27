import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'

afterEach(nettoyerRacines)
/*
 * Suites git REELLES : `vi.setConfig` comme les autres suites `worktree-manager.*` (convention
 * maison, cf. `worktree-manager.publication.test.ts:31`). Un depot temporaire, un worktree, un
 * merge : 15 a 30 s seuls, davantage quand quatre workers tournent en parallele. Le plafond global
 * de 20 s les faisait echouer en LOT alors qu'elles passent seules — un faux rouge de charge, qui
 * ferait douter de tests parfaitement valides.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })


/**
 * PARCOURS COMPLET, EN ENVIRONNEMENT ISOLE — le bout en bout que l'arbre partage interdisait.
 *
 * Mesure du 2026-08-27 : la preuve tentee dans le depot reel a ete rendue ININTERPRETABLE par un
 * acteur concurrent — une autre session a committe la base pendant l'observation, et le travail est
 * arrive par son commit, pas par la publication de l'app. On ne peut pas mesurer une publication
 * dans un arbre que d'autres ecrivent (reflexe : mesurer un systeme pendant qu'un tiers ecrit dedans
 * ne mesure pas le systeme).
 *
 * Ici, tout est a nous : un depot git TEMPORAIRE, un manager reel, un coordinateur reel, et le
 * balayage appele explicitement. Aucun mock du git, aucune session concurrente. Ce qui est verifie
 * est la CHAINE, pas une piece : refus -> attente atteignable -> la collision disparait -> le
 * balayage l'observe -> le travail atterrit, sans aucun geste humain.
 */
describe('e2e isole — une base sale n aboutit plus jamais a un echec', () => {
  const scenario = (): {
    repo: string
    wm: ReturnType<typeof manager>
    coordinateur: RunWorktreeCoordinator
    runId: string
  } => {
    const repo = tempRepo()
    const wm = manager(repo)
    const runId = 'builder'
    /*
     * Un fichier assez LONG, committe d'abord.
     *
     * Trois versions de ce test se sont cassees sur la taille du fichier de depart : sur trois
     * lignes, deux editions meme non superposees tombent dans le meme hunk et git conflicte — un
     * conflit fabrique par le scenario, pas par le code. Ici les deux apports sont a dix lignes
     * l'un de l'autre : la fusion a 3 branches est propre, et c'est bien la COLLISION DE FICHIER
     * qu'on mesure, la seule que l'echelle a le droit de resoudre seule.
     */
    const lignes = Array.from({ length: 20 }, (_, i) => `ligne ${i + 1}`)
    writeFileSync(join(repo, 'long.txt'), lignes.join('\n') + '\n')
    git(repo, 'add', 'long.txt')
    git(repo, 'commit', '-m', 'fichier de travail')

    const copie = wm.acquire(runId)
    // La copie apporte son travail vers la FIN du fichier...
    const versionCopie = [...lignes]
    versionCopie[17] = 'MILIEU MODIFIE PAR LA COPIE'
    writeFileSync(join(copie, 'long.txt'), versionCopie.join('\n') + '\n')
    // ...et l'utilisateur a une edition non committee au DEBUT du MEME fichier : collision certaine.
    const versionUtilisateur = [...lignes]
    versionUtilisateur[1] = 'PREMIERE LIGNE UTILISATEUR'
    writeFileSync(join(repo, 'long.txt'), versionUtilisateur.join('\n') + '\n')

    const etat = new Map<string, unknown>()
    const stateStore = {
      list: () => [...etat.values()],
      get: (id: string) => etat.get(id),
      save: (enregistrement: { runId: string }) => etat.set(enregistrement.runId, enregistrement),
      remove: (id: string) => etat.delete(id)
    }
    const coordinateur = new RunWorktreeCoordinator({
      manager: wm as never,
      stateStore: stateStore as never
    } as never)
    return { repo, wm, coordinateur, runId }
  }

  it('la chaine entiere : refus, attente, collision levee, atterrissage automatique', () => {
    const { repo, wm, coordinateur, runId } = scenario()

    // 1. REFUS — la publication est refusee, et elle ne perd rien.
    const refus = wm.finalize(runId)
    expect(refus).toMatchObject({ outcome: 'blocked', reason: 'base-dirty' })
    // 2. ATTENTE ATTEIGNABLE — le travail a une adresse, l'arbre de l'utilisateur est intact.
    const attente = (refus as { stagedRef?: string }).stagedRef
    expect(attente).toBe(`refs/autowin/integration/${runId}`)
    expect(git(repo, 'show', `${attente}:long.txt`)).toContain('MILIEU MODIFIE PAR LA COPIE')
    // Son edition est intacte, et le travail de la copie n'a PAS ete ecrit chez lui.
    const sonFichier = readFileSync(join(repo, 'long.txt'), 'utf8')
    expect(sonFichier).toContain('PREMIERE LIGNE UTILISATEUR')
    expect(sonFichier).not.toContain('MILIEU MODIFIE PAR LA COPIE')
    expect(git(repo, 'show', 'HEAD:long.txt')).not.toContain('MILIEU MODIFIE PAR LA COPIE')

    // 3. LA COLLISION DISPARAIT — l'utilisateur committe son edition, comme dans la vraie vie.
    git(repo, 'add', 'long.txt')
    git(repo, 'commit', '-m', 'mon travail a moi')
    expect(git(repo, 'status', '--porcelain=v1')).toBe('')

    // 4. LE BALAYAGE OBSERVE ET PUBLIE — aucun geste humain sur la publication.
    const apres = wm.finalize(runId)
    expect(apres.outcome).toBe('merged')
    const contenu = readFileSync(join(repo, 'long.txt'), 'utf8')
    expect(contenu).toContain('MILIEU MODIFIE PAR LA COPIE')
    // Son commit n'a pas ete perdu par la publication : les deux apports coexistent.
    expect(contenu).toContain('PREMIERE LIGNE UTILISATEUR')
    void coordinateur
  })

  it('barreau 2 en isolement : le travail atterrit SANS attendre, et son edition survit', () => {
    const { repo, wm, runId } = scenario()
    // Son edition est au DEBUT, celle de la copie a la ligne 18 : la fusion a 3 branches doit tenir
    // les deux. C'est le scenario que le barreau 2 est fait pour resoudre sans rien perdre.
    const sonDebut = Array.from({ length: 20 }, (_, i) => `ligne ${i + 1}`)
    sonDebut[1] = 'AVANT UTILISATEUR'
    writeFileSync(join(repo, 'long.txt'), sonDebut.join('\n') + '\n')

    const res = wm.finalize(runId, { preserverEditionLocale: true })

    expect(res.outcome).toBe('merged')
    const contenu = readFileSync(join(repo, 'long.txt'), 'utf8')
    expect(contenu).toContain('MILIEU MODIFIE PAR LA COPIE')
    expect(contenu).toContain('AVANT UTILISATEUR')
    // Son travail reste NON COMMITTE — on publie celui de la copie, on ne s'approprie pas le sien.
    expect(git(repo, 'status', '--porcelain=v1')).toContain('long.txt')
    expect(git(repo, 'show', 'HEAD:long.txt')).not.toContain('AVANT UTILISATEUR')
    // Et la sauvegarde de son etat d'origine existe, comme filet.
    expect(git(repo, 'rev-parse', '--verify', `refs/autowin/safety/${runId}`)).toBeTruthy()
  })
})
