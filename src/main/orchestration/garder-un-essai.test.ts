import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { avancerLaBaseDuFil, lireLaBaseDuFil } from '../git/photo-du-code'
import {
  estUnPassageDePorte,
  garderLeTravailDuFil,
  type PublicationDUneCopie
} from './garder-un-essai'
import { WorktreeManager } from '../store/worktree-manager'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]): Promise<string> =>
  (await run('git', args, { cwd })).stdout

const dossiers: string[] = []
afterEach(() => {
  for (const dossier of dossiers.splice(0)) supprimerArbre(dossier)
})

/** Le travail du fil : une ligne changée, un fichier ajouté, un supprimé, un fichier ignoré écrit. */
function travaillerDansLaCopie(copie: string): void {
  writeFileSync(join(copie, 'a.txt'), 'ligne 1 — façon 1\nligne 2\nligne 3\n')
  writeFileSync(join(copie, 'b.txt'), 'nouveau\n')
  rmSync(join(copie, 'c.txt'))
  mkdirSync(join(copie, 'ignore'))
  writeFileSync(join(copie, 'ignore', 'cache.txt'), 'jetable\n')
}

/**
 * LA PORTE D'UN FIL EN COPIE : « Garder » en fin de tour, base = la base du fil (`photo-du-code.ts`,
 * `lireLaBaseDuFil`), qui AVANCE à chaque passage. Tout ce que la copie porte appartient au fil :
 * rien n'est à prouver, seul l'écart depuis la base entre dans main.
 *
 * La publication est la VRAIE (`WorktreeManager` : copie neuve sur main, puis finalisation en avance
 * rapide), pas une imitation : « le travail arrive dans main » se lit dans la branche ET le dossier.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - main a reçu le travail d'un AUTRE fil depuis la copie : une version qui pose l'arbre de la copie
 *    sur main au lieu de fusionner à trois voies le déferait ;
 *  - un second passage : une base qui n'avance pas republierait les fichiers du premier ;
 *  - la base avance jusqu'à l'arbre de la COPIE : prise sur main, elle avalerait le travail des autres ;
 *  - un conflit avec main, un passage sans changement, une base disparue : trois refus distincts,
 *    aucun n'écrit dans main, et une base absente ne publie JAMAIS toute la copie.
 */
describe('garderLeTravailDuFil — la porte d’un fil en copie vers main', () => {
  async function filEnCopie(): Promise<{ repo: string; copie: string; base: string }> {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-porte-'))
    dossiers.push(racine)
    const repo = join(racine, 'depot')
    mkdirSync(repo)
    await git(repo, 'init', '-b', 'main')
    await git(repo, 'config', 'user.name', 'Test')
    await git(repo, 'config', 'user.email', 'test@example.invalid')
    await git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'a.txt'), 'ligne 1\nligne 2\nligne 3\n')
    writeFileSync(join(repo, 'c.txt'), 'à supprimer\n')
    writeFileSync(join(repo, 'autre.txt'), 'version commitée\n')
    writeFileSync(join(repo, '.gitignore'), 'ignore/\n')
    await git(repo, 'add', '-A')
    await git(repo, 'commit', '-m', 'base')
    const copie = join(racine, 'copies', 'conv-1')
    await git(repo, 'worktree', 'add', '--detach', copie, 'main')
    const base = await avancerLaBaseDuFil({
      dossier: copie,
      conversationId: 'conv-1',
      depuis: null,
      vers: 'HEAD'
    })
    if (!base.ok) throw new Error(base.raison)
    return { repo, copie, base: base.sha }
  }

  /** Le chemin de publication d'une copie de l'app, sur un vrai `WorktreeManager`. */
  function publicationReelle(repo: string): PublicationDUneCopie & { ouvertes: string[] } {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-porte-wt-'))
    dossiers.push(racine)
    const wm = new WorktreeManager({ baseRepo: repo, worktreeRoot: racine })
    const ouvertes: string[] = []
    return {
      ouvertes,
      ouvrir: async (runId) => {
        ouvertes.push(runId)
        return wm.acquire(runId)
      },
      fermer: async (runId, publier) => {
        if (publier) return wm.finalize(runId)
        wm.discard(runId)
        return undefined
      }
    }
  }

  const commitsEntres = async (repo: string, depuis: string): Promise<string[]> =>
    (await git(repo, 'rev-list', `${depuis}..main`)).split('\n').filter(Boolean)

  it('le travail du fil arrive dans main par la fusion à trois voies, et la base du fil avance', async () => {
    const { repo, copie, base } = await filEnCopie()
    // Un autre fil a fait entrer son travail dans main depuis la naissance de la copie.
    writeFileSync(join(repo, 'autre.txt'), 'travail d’un autre fil, déjà dans main\n')
    await git(repo, 'commit', '-m', 'autre fil', '--', 'autre.txt')
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    travaillerDansLaCopie(copie)

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): change la ligne 1 (conv-1)',
      publication: publicationReelle(repo),
      runId: 'porte-test-1'
    })

    expect(garde).toMatchObject({ ok: true, etat: 'publie', fichiers: ['a.txt', 'b.txt', 'c.txt'] })
    if (!garde.ok || garde.etat !== 'publie') return
    // Dans main : la branche ET le dossier, sans le fichier ignoré, avec le travail de l'autre fil.
    expect(await git(repo, 'show', 'main:a.txt')).toBe('ligne 1 — façon 1\nligne 2\nligne 3\n')
    // fix-ok: cause mesurée — le git système de ce poste extrait en CRLF (`git config --system
    // core.autocrlf` = true) : le dossier lit `nouveau\r\n`, la branche `nouveau\n`. Seul le contenu compte.
    expect(readFileSync(join(repo, 'b.txt'), 'utf8').replace(/\r\n/gu, '\n')).toBe('nouveau\n')
    expect(existsSync(join(repo, 'c.txt'))).toBe(false)
    expect(await git(repo, 'ls-tree', '-r', '--name-only', 'main')).not.toContain(
      'ignore/cache.txt'
    )
    expect(await git(repo, 'show', 'main:autre.txt')).toBe(
      'travail d’un autre fil, déjà dans main\n'
    )
    expect(await git(repo, 'status', '--porcelain')).toBe('')
    // La base avance au commit de ce que la COPIE portait (sa version d'`autre.txt`), fils de l'ancienne.
    const nouvelleBase = await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })
    expect(nouvelleBase).toBe(garde.passage)
    expect(nouvelleBase).not.toBe(base)
    expect(garde.base).toEqual({ ok: true, sha: nouvelleBase })
    expect((await git(repo, 'rev-parse', `${nouvelleBase}^`)).trim()).toBe(base)
    expect(await git(repo, 'show', `${nouvelleBase}:autre.txt`)).toBe('version commitée\n')
    expect(await commitsEntres(repo, mainAvant)).toHaveLength(1)
  })

  it('chaque commit de la porte finit par la ligne `Porte: conv-NNN`, que `git log --grep` retrouve', async () => {
    const { repo, copie } = await filEnCopie()
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    const publication = publicationReelle(repo)
    travaillerDansLaCopie(copie)
    await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): premier passage (conv-1)',
      publication,
      runId: 'porte-test-2a'
    })
    writeFileSync(join(copie, 'd.txt'), 'second passage\n')
    await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(d): second passage (conv-1)',
      publication,
      runId: 'porte-test-2b'
    })

    const commits = await commitsEntres(repo, mainAvant)
    expect(commits).toHaveLength(2)
    for (const sha of commits) {
      const lignes = (await git(repo, 'log', '-1', '--format=%B', sha)).trimEnd().split('\n')
      expect(lignes.at(-1)).toBe('Porte: conv-1')
    }
    expect((await git(repo, 'log', '-1', '--format=%s', commits[0])).trim()).toBe(
      'feat(d): second passage (conv-1)'
    )
    const trouves = (await git(repo, 'log', 'main', '--format=%H', '--grep=^Porte: conv-1$'))
      .split('\n')
      .filter(Boolean)
    expect(trouves.sort()).toEqual([...commits].sort())
  })

  it('un second passage ne publie que l’écart depuis le premier', async () => {
    const { repo, copie } = await filEnCopie()
    const publication = publicationReelle(repo)
    travaillerDansLaCopie(copie)
    const premier = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): premier passage (conv-1)',
      publication,
      runId: 'porte-test-3a'
    })
    expect(premier).toMatchObject({ ok: true, etat: 'publie' })
    // Entre les deux passages, main change la ligne 3 d'`a.txt` : le second ne doit pas la défaire.
    writeFileSync(join(repo, 'a.txt'), 'ligne 1 — façon 1\nligne 2\nligne 3 — main\n')
    await git(repo, 'commit', '-m', 'main bouge', '--', 'a.txt')
    writeFileSync(join(copie, 'd.txt'), 'second passage\n')

    const second = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(d): second passage (conv-1)',
      publication,
      runId: 'porte-test-3b'
    })

    expect(second).toMatchObject({ ok: true, etat: 'publie', fichiers: ['d.txt'] })
    expect(
      (await git(repo, 'show', '--name-only', '--format=', 'main')).split('\n').filter(Boolean)
    ).toEqual(['d.txt'])
    expect(await git(repo, 'show', 'main:a.txt')).toBe(
      'ligne 1 — façon 1\nligne 2\nligne 3 — main\n'
    )
    expect(await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })).toBe(
      second.ok && second.etat === 'publie' ? second.passage : 'aucun passage'
    )
  })

  it('conflit avec main : refus qui nomme les fichiers, rien n’entre dans main, la base ne bouge pas', async () => {
    const { repo, copie, base } = await filEnCopie()
    writeFileSync(join(repo, 'a.txt'), 'ligne 1 — changée dans main\nligne 2\nligne 3\n')
    await git(repo, 'commit', '-m', 'main bouge', '--', 'a.txt')
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    travaillerDansLaCopie(copie)
    const publication = publicationReelle(repo)

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): change la ligne 1 (conv-1)',
      publication,
      runId: 'porte-test-4'
    })

    expect(garde).toMatchObject({ ok: false, motif: 'conflit', fichiers: ['a.txt'] })
    if (garde.ok) return
    expect(garde.raison).toContain('a.txt')
    expect((await git(repo, 'rev-parse', 'main')).trim()).toBe(mainAvant)
    expect(await git(repo, 'status', '--porcelain')).toBe('')
    expect(await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })).toBe(base)
    // Le travail du fil reste dans sa copie.
    expect(readFileSync(join(copie, 'b.txt'), 'utf8')).toBe('nouveau\n')
  })

  it('passage sans changement : refus « rien à garder », aucune copie de publication ouverte', async () => {
    const { repo, copie } = await filEnCopie()
    const publication = publicationReelle(repo)
    // Seul un fichier ignoré a bougé : ce n'est pas du code à garder.
    mkdirSync(join(copie, 'ignore'))
    writeFileSync(join(copie, 'ignore', 'cache.txt'), 'jetable\n')

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'chore: rien (conv-1)',
      publication,
      runId: 'porte-test-5'
    })

    expect(garde).toMatchObject({ ok: false, motif: 'rien-a-garder' })
    if (garde.ok) return
    expect(garde.raison).toContain('rien à garder')
    expect(publication.ouvertes).toEqual([])
  })

  /**
   * Un profil FICTIF d'entreprise sur le poste, exclu de git comme un vrai `entreprise/` : la porte
   * le lit depuis le dépôt principal, et le passage ne doit pas le porter.
   */
  function avecProfilDEntreprise(repo: string): void {
    mkdirSync(join(repo, '.git', 'info'), { recursive: true })
    writeFileSync(join(repo, '.git', 'info', 'exclude'), 'entreprise/\n')
    mkdirSync(join(repo, 'entreprise', 'acme'), { recursive: true })
    writeFileSync(
      join(repo, 'entreprise', 'acme', 'identite.json'),
      JSON.stringify({ termesInterdits: [{ motif: 'zorglub' }] })
    )
  }

  it('un passage qui porte un terme d’entreprise est refusé au commit : rien n’entre dans main, la base ne bouge pas', async () => {
    const { repo, copie, base } = await filEnCopie()
    avecProfilDEntreprise(repo)
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    writeFileSync(join(copie, 'a.txt'), 'le serveur zorglub\n')
    const publication = publicationReelle(repo)

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): change la ligne 1 (conv-1)',
      publication,
      runId: 'porte-test-separation-1'
    })

    expect(garde).toMatchObject({ ok: false })
    if (garde.ok) return
    expect(garde.raison).toContain('a.txt')
    expect((await git(repo, 'rev-parse', 'main')).trim()).toBe(mainAvant)
    expect(await lireLaBaseDuFil({ dossier: copie, conversationId: 'conv-1' })).toBe(base)
    expect(publication.ouvertes).toEqual([])
  })

  it('profil mal formé : le travail propre passe, et le résultat porte l’avertissement', async () => {
    const { repo, copie } = await filEnCopie()
    avecProfilDEntreprise(repo)
    writeFileSync(join(repo, 'entreprise', 'acme', 'identite.json'), '{ pas du json')
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    travaillerDansLaCopie(copie)

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): change la ligne 1 (conv-1)',
      publication: publicationReelle(repo),
      runId: 'porte-test-separation-3'
    })

    expect(garde).toMatchObject({ ok: true, etat: 'publie', fichiers: ['a.txt', 'b.txt', 'c.txt'] })
    expect((await git(repo, 'rev-parse', 'main')).trim()).not.toBe(mainAvant)
    expect(garde).toMatchObject({ avertissement: expect.stringContaining('mal formé') })
  })

  it('jumeau accepté : le même travail, sans terme, passe avec le même profil sur le poste', async () => {
    const { repo, copie } = await filEnCopie()
    avecProfilDEntreprise(repo)
    travaillerDansLaCopie(copie)

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): change la ligne 1 (conv-1)',
      publication: publicationReelle(repo),
      runId: 'porte-test-separation-2'
    })

    expect(garde).toMatchObject({ ok: true, etat: 'publie', fichiers: ['a.txt', 'b.txt', 'c.txt'] })
  })

  it('base disparue : refus avec la raison, jamais la copie entière publiée', async () => {
    const { repo, copie } = await filEnCopie()
    travaillerDansLaCopie(copie)
    await git(repo, 'update-ref', '-d', 'refs/autowin/base-de-fil/conv-1')
    const mainAvant = (await git(repo, 'rev-parse', 'main')).trim()
    const publication = publicationReelle(repo)

    const garde = await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: 'feat(a): change la ligne 1 (conv-1)',
      publication,
      runId: 'porte-test-6'
    })

    expect(garde).toMatchObject({ ok: false, motif: 'base-absente' })
    if (garde.ok) return
    expect(garde.raison).toContain('base')
    expect(publication.ouvertes).toEqual([])
    expect((await git(repo, 'rev-parse', 'main')).trim()).toBe(mainAvant)
  })

  it('le titre se tire des fichiers du passage, et le passage se reconnaît comme porte', async () => {
    const { repo, copie } = await filEnCopie()
    travaillerDansLaCopie(copie)
    const publication = publicationReelle(repo)

    await garderLeTravailDuFil({
      copie,
      conversationId: 'conv-1',
      titre: (fichiers) => `feat: ${fichiers.join(' ')} (conv-1)`,
      publication
    })

    expect((await git(repo, 'log', '-1', '--format=%s', 'main')).trim()).toBe(
      'feat: a.txt b.txt c.txt (conv-1)'
    )
    expect(publication.ouvertes).toHaveLength(1)
    expect(estUnPassageDePorte(publication.ouvertes[0] ?? '')).toBe(true)
    // Les autres publications d'une copie gardent leur envoi vers le distant.
    expect(estUnPassageDePorte('essai-1000-1-abc')).toBe(false)
    expect(estUnPassageDePorte('run-ea7117339b80-1')).toBe(false)
  })
})

/**
 * LE BRANCHEMENT DANS LE PROCESSUS PRINCIPAL, lu dans son code (le constructeur de l'app ne se joue
 * pas en test). Mesuré : une copie publiée par `endAsync({ merge: true })` appelle
 * `onRecoveredPublication`, qui pousse main vers le distant quand l'enchaînement auto est allumé.
 * Une garde par lecture de source prouve seulement que le câblage n'est pas ABSENT.
 */
describe('la porte branchée dans le processus principal', () => {
  const source = ((): string => {
    const racine = join(process.cwd(), 'src', 'main')
    for (const nom of readdirSync(racine, { recursive: true, encoding: 'utf8' })) {
      if (!nom.endsWith('.ts') || nom.endsWith('.test.ts')) continue
      const texte = readFileSync(join(racine, nom), 'utf8')
      if (texte.includes('onRecoveredPublication: async')) return texte
    }
    return ''
  })()

  it('la publication d’un passage de porte n’enchaîne aucun envoi vers le distant', () => {
    const rappel = source.slice(source.indexOf('onRecoveredPublication: async'))
    const garde = rappel.indexOf('!estUnPassageDePorte(publication.runId)')
    expect(garde).toBeGreaterThan(-1)
    expect(garde).toBeLessThan(rappel.indexOf('closeGreenRunOnDisk('))
  })

  it('la fin de tour du chat reçoit la porte, montée sur la publication d’une copie', () => {
    const appel = source.slice(source.indexOf('await publierTourDeChat({')).slice(0, 1500)
    expect(appel).toMatch(/porte: \{\s*depot,\s*publication: \{/u)
    expect(appel).toContain('worktrees.endAsync(runId, { merge: publier })')
  })
})
