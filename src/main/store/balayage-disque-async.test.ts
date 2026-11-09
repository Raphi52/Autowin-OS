import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { WorktreeManager } from './worktree-manager'
import { racineDe, roots, tempRepo } from './worktree-manager.test-helpers'

/**
 * LE BALAYAGE « NON BLOQUANT » SUPPRIMAIT LA COPIE EN SYNCHRONE — heal, 2026-10-23.
 *
 * Mesuré dans `gels.jsonl` (2026-10-22, 15:27 → 15:32) : 273,7 s de fenêtre figée en 4 gels, dont
 * un de 153,8 s, sur 10 190 `unlinkSync` remontés à `fs-supprimer.ts:111 < :143` dans le bundle de
 * `worktree-manager`. Le balayage horaire passe par `sweepAbandonedAgentCopiesAsync`, écrit pour ne
 * pas tenir la boucle : seul l'appel à git était asynchrone. Quand git ne peut pas retirer la copie
 * (copie déjà oubliée par git, ou `worktree remove --force` en échec), l'escalade vers le disque
 * appelait `supprimerArbre` — un parcours SYNCHRONE de toute l'arborescence, sur le fil principal.
 *
 * Ces tests comptent les tours de boucle d'événements PENDANT le retrait : git est simulé par des
 * promesses déjà résolues (micro-tâches, aucun tour de boucle), donc tout tour compté vient du
 * retrait disque lui-même. Zéro tour = la fenêtre était figée pendant toute la suppression.
 */

afterEach(() => {
  for (const d of roots.splice(0)) {
    try {
      supprimerArbre(d)
    } catch {
      /* verrou Windows passager : le dossier temporaire sera purgé plus tard */
    }
  }
})

type AccesPrive = { balayerLeCheminAsync(path: string): Promise<boolean> }
const prive = (wm: WorktreeManager): AccesPrive => wm as unknown as AccesPrive

type Sortie = { code: number; stdout: string; stderr: string }

/** Une copie d'agent assez lourde pour que son retrait se voie : `fichiers` fichiers en 20 dossiers. */
function copieLourde(racine: string, fichiers = 400): string {
  const chemin = join(racine, 'agent__run-oublie')
  for (let i = 0; i < fichiers; i++) {
    const dossier = join(chemin, `d${i % 20}`)
    mkdirSync(dossier, { recursive: true })
    writeFileSync(join(dossier, `f${i}.txt`), 'x')
  }
  return chemin
}

/** Git simulé : `worktree remove` échoue toujours ; la copie est enregistrée ou non. */
function gitSimule(chemin: string, enregistree: boolean): (repo: string, args: string[]) => Sortie {
  return (_repo, args) => {
    if (args[0] === 'worktree' && args[1] === 'list') {
      return { code: 0, stdout: enregistree ? `worktree ${chemin}\n` : '', stderr: '' }
    }
    if (args[0] === 'worktree' && args[1] === 'remove') {
      return { code: 1, stdout: '', stderr: 'contains modified or untracked files' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
}

/** Compte les tours de boucle d'événements (phase `setImmediate`) pendant `travail`. */
async function toursPendant<T>(travail: () => Promise<T>): Promise<{ resultat: T; tours: number }> {
  let tours = 0
  let actif = true
  const tourner = (): void => {
    if (!actif) return
    tours += 1
    setImmediate(tourner)
  }
  setImmediate(tourner)
  const resultat = await travail()
  actif = false
  return { resultat, tours }
}

function preparer(enregistree: boolean): { wm: WorktreeManager; chemin: string } {
  const repo = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-balayage-async-'))
  roots.push(racine)
  const chemin = copieLourde(racine)
  const git = gitSimule(chemin, enregistree)
  const wm = new WorktreeManager({
    racineCopiesDeTaches: racineDe(racine),
    baseRepo: repo,
    worktreeRoot: racine,
    tryGitFn: git,
    tryGitAsyncFn: async (repo, args) => git(repo, args)
  })
  return { wm, chemin }
}

describe('balayage asynchrone : le retrait disque rend la main à la boucle', () => {
  it('copie oubliée de git (retrait par le disque seul) : supprimée sans figer la boucle', async () => {
    const { wm, chemin } = preparer(false)

    const { resultat, tours } = await toursPendant(() => prive(wm).balayerLeCheminAsync(chemin))

    expect(resultat).toBe(true)
    expect(existsSync(chemin)).toBe(false)
    expect(tours).toBeGreaterThan(20)
  })

  it('copie enregistrée dont `remove --force` échoue : l’escalade disque ne fige pas la boucle', async () => {
    const { wm, chemin } = preparer(true)

    const { resultat, tours } = await toursPendant(() => prive(wm).balayerLeCheminAsync(chemin))

    expect(resultat).toBe(true)
    expect(existsSync(chemin)).toBe(false)
    expect(tours).toBeGreaterThan(20)
  })

  it('un `removeDirFn` injecté seul répond aussi pour la forme asynchrone (un test qui simule le disque le simule partout)', async () => {
    const repo = tempRepo()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-balayage-async-'))
    roots.push(racine)
    const chemin = copieLourde(racine, 3)
    const git = gitSimule(chemin, false)
    const retires: string[] = []
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(racine),
      baseRepo: repo,
      worktreeRoot: racine,
      tryGitFn: git,
      tryGitAsyncFn: async (r, args) => git(r, args),
      removeDirFn: (p) => {
        retires.push(p)
        throw new Error('EBUSY: verrou Windows simulé')
      }
    })

    expect(await prive(wm).balayerLeCheminAsync(chemin)).toBe(false)
    expect(retires).toEqual([chemin])
    expect(wm.blocagesDeBalayage()[0]?.detail).toMatch(/EBUSY/)
  })
})

/**
 * LE CONTRÔLE D'APPARTENANCE DU BALAYAGE HORAIRE TENAIT LA BOUCLE — 2026-11-06.
 *
 * Mesuré dans `gels.jsonl` (heures UTC, démarrage à 10:44:52) : 4 465 ms à 11:44:50 puis 4 900 ms à
 * 12:44:53, deux passes horaires, chacune avec 3 `execFileSync git rev-parse` remontés à
 * `ownershipIssue` (4 555 puis 5 033 ms cumulés, soit 1,5 à 1,7 s par sonde).
 * `sweepAbandonedAgentCopiesAsync` rendait la main entre deux copies, mais la décision de chaque
 * copie appelait `ownershipIssue`, dont les deux sondes git (`--git-common-dir --show-toplevel` sur
 * la copie, `--git-common-dir` sur la base) passaient par `tryGitFn`, donc par `execFileSync`.
 *
 * Ce test mesure le BATTEMENT de la boucle : un minuteur de 5 ms note le plus long silence entre deux
 * battements pendant le balayage. Git est simulé à 400 ms par sonde : en synchrone, il bloque le fil
 * (attente active) ; en asynchrone, il attend sur un minuteur, comme `execFile`. L'entrée qui ferait
 * échouer ce test si la correction était fausse : une copie de plus de 3 h dont la sonde
 * d'appartenance prend 400 ms. Une seule des deux sondes laissée sur `tryGitFn` (celle de la copie
 * OU celle de la base) rend un silence d'au moins 400 ms.
 */
describe('balayage asynchrone : le contrôle d’appartenance ne fige pas la boucle', () => {
  const GIT_LENT_MS = 400
  const SILENCE_TOLERE_MS = 150
  const JOUR_MS = 24 * 60 * 60 * 1_000

  const attendreEnBloquant = (ms: number): void => {
    const fin = performance.now() + ms
    while (performance.now() < fin) {
      /* attente active : c'est ce que fait `execFileSync` au fil principal */
    }
  }

  /** Le plus long silence de la boucle d'événements pendant `travail`, battue toutes les 5 ms. */
  async function plusLongSilencePendant<T>(
    travail: () => Promise<T>
  ): Promise<{ resultat: T; silenceMs: number }> {
    let dernier = performance.now()
    let silenceMs = 0
    const battre = (): void => {
      const maintenant = performance.now()
      silenceMs = Math.max(silenceMs, maintenant - dernier)
      dernier = maintenant
    }
    const minuteur = setInterval(battre, 5)
    try {
      const resultat = await travail()
      battre()
      return { resultat, silenceMs }
    } finally {
      clearInterval(minuteur)
    }
  }

  it('trois vieilles copies, sonde git de 400 ms : la boucle bat pendant tout le balayage', async () => {
    const base = mkdtempSync(join(tmpdir(), 'autowin-appartenance-base-'))
    const racine = mkdtempSync(join(tmpdir(), 'autowin-appartenance-copies-'))
    roots.push(base, racine)
    const copiesCreees = ['run-a', 'run-b', 'run-c'].map((id) => {
      const chemin = join(racine, `agent__${id}`)
      mkdirSync(chemin)
      return chemin
    })
    const sondesSynchrones: string[] = []
    const sondesAsynchrones: string[] = []
    const estSonde = (args: string[]): boolean =>
      args[0] === 'rev-parse' && args.includes('--git-common-dir')
    const repondre = (dir: string, args: string[]): Sortie => {
      if (!estSonde(args)) return { code: 1, stdout: '', stderr: 'simulé' }
      const commun = join(base, '.git')
      return {
        code: 0,
        stdout: args.includes('--show-toplevel') ? `${commun}\n${dir}\n` : `${commun}\n`,
        stderr: ''
      }
    }
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(racine),
      baseRepo: base,
      worktreeRoot: racine,
      // Chaque copie vient d'être créée : l'horloge avancée de deux jours la rend « vieille ».
      nowFn: () => Date.now() + 2 * JOUR_MS,
      git: () => '',
      tryGitFn: (dir, args) => {
        if (estSonde(args)) {
          sondesSynchrones.push(dir)
          attendreEnBloquant(GIT_LENT_MS)
        }
        return repondre(dir, args)
      },
      tryGitAsyncFn: async (dir, args) => {
        if (estSonde(args)) {
          sondesAsynchrones.push(dir)
          await new Promise<void>((fin) => setTimeout(fin, GIT_LENT_MS))
        }
        return repondre(dir, args)
      }
    })

    const { resultat, silenceMs } = await plusLongSilencePendant(() =>
      wm.sweepAbandonedAgentCopiesAsync()
    )

    expect(silenceMs).toBeLessThan(SILENCE_TOLERE_MS)
    expect(sondesSynchrones).toEqual([])
    // Le contrôle a VRAIMENT eu lieu pour chaque copie : un « correctif » qui le sauterait serait vert
    // sur le battement et faux sur la sûreté.
    for (const chemin of copiesCreees) expect(sondesAsynchrones).toContain(chemin)
    expect(sondesAsynchrones).toContain(base)
    // Copies légitimes, HEAD illisible (simulé) : le balayage s'abstient, aucune n'est retirée.
    expect(resultat).toEqual([])
    for (const chemin of copiesCreees) expect(existsSync(chemin)).toBe(true)
  })

  /**
   * LE SECOND CONTRÔLE, CELUI DE LA PRÉSERVATION. Une copie de plus de 24 h qui porte du travail non
   * publié part dans `preserverEtLiberer`, qui reprouve l'appartenance JUSTE AVANT `switch -C` et
   * `add -A` : c'est la garde du commit 32849a15. Sa forme synchrone gardait 400 ms de sonde au fil
   * principal. L'entrée qui ferait échouer ce test si la correction était fausse : cette copie-là,
   * avec du travail non publié (`?? travail.txt`) — la sonde du balayage seule ne la couvre pas.
   * fix-ok: rouge mesuré à 418 ms puis 405 ms avant `preserverEtLibererAsync` (sonde synchrone de
   * `preserverEtLiberer`) ; ce fichier n'est édité que pour ajouter ses cas, pas pour le faire passer.
   */
  const SONDE_DE_LA_COPIE = 'copie rev-parse --git-common-dir --show-toplevel'

  function copiePreservable(opts: {
    amputeeAvantEcriture?: boolean
    bailPendantLaSonde?: number
  }): {
    wm: WorktreeManager
    copie: string
    journal: string[]
    sondesSynchrones: string[]
  } {
    const base = mkdtempSync(join(tmpdir(), 'autowin-preservation-base-'))
    const racine = mkdtempSync(join(tmpdir(), 'autowin-preservation-copies-'))
    roots.push(base, racine)
    const copie = join(racine, 'agent__run-d')
    mkdirSync(copie)
    writeFileSync(join(copie, 'travail.txt'), 'travail non publié')
    const journal: string[] = []
    const sondesSynchrones: string[] = []
    let sondesDeLaCopie = 0
    const estSonde = (args: string[]): boolean =>
      args[0] === 'rev-parse' && args.includes('--git-common-dir')
    const repondre = (dir: string, args: string[]): Sortie => {
      const commun = join(base, '.git')
      if (estSonde(args)) {
        if (!args.includes('--show-toplevel')) return { code: 0, stdout: `${commun}\n`, stderr: '' }
        sondesDeLaCopie += 1
        // Jumeau refusé : la copie a perdu son `.git` après la décision, git remonte sur la base.
        const racineVue = opts.amputeeAvantEcriture && sondesDeLaCopie > 1 ? base : dir
        return { code: 0, stdout: `${commun}\n${racineVue}\n`, stderr: '' }
      }
      if (['switch', 'add', 'commit'].includes(args[0] ?? ''))
        return { code: 0, stdout: '', stderr: '' }
      if (args.join(' ') === 'worktree list --porcelain') return { code: 0, stdout: '', stderr: '' }
      return { code: 1, stdout: '', stderr: 'simulé' }
    }
    const noter = (forme: string, dir: string, args: string[]): void => {
      journal.push(
        `${forme} ${dir === copie ? 'copie' : dir === base ? 'base' : dir} ${args.join(' ')}`
      )
    }
    const maintenant = (): number => Date.now() + 2 * JOUR_MS
    const wm = new WorktreeManager({
      racineCopiesDeTaches: racineDe(racine),
      baseRepo: base,
      worktreeRoot: racine,
      nowFn: maintenant,
      git: (dir, args) => (dir === copie && args[0] === 'status' ? '?? travail.txt\0' : ''),
      tryGitFn: (dir, args) => {
        noter('sync', dir, args)
        if (estSonde(args)) {
          sondesSynchrones.push(dir)
          attendreEnBloquant(GIT_LENT_MS)
        }
        return repondre(dir, args)
      },
      tryGitAsyncFn: async (dir, args) => {
        noter('async', dir, args)
        const rang = journal.filter((l) => l === `async ${SONDE_DE_LA_COPIE}`).length
        if (dir === copie && estSonde(args) && rang === opts.bailPendantLaSonde) {
          // Un run reprend la copie PENDANT que la sonde est attendue : il pose son bail.
          const baux = join(racine, '.leases', 'run-d')
          mkdirSync(baux, { recursive: true })
          writeFileSync(join(baux, 'spawn-pending-1'), String(maintenant()))
        }
        if (estSonde(args)) await new Promise<void>((fin) => setTimeout(fin, GIT_LENT_MS))
        return repondre(dir, args)
      }
    })
    return { wm, copie, journal, sondesSynchrones }
  }

  it('copie de plus de 24 h avec du travail non publié : préservée sans figer la boucle', async () => {
    const { wm, copie, journal, sondesSynchrones } = copiePreservable({
      amputeeAvantEcriture: false
    })

    const { resultat, silenceMs } = await plusLongSilencePendant(() =>
      wm.sweepAbandonedAgentCopiesAsync()
    )

    expect(silenceMs).toBeLessThan(SILENCE_TOLERE_MS)
    expect(sondesSynchrones).toEqual([])
    // La préservation a VRAIMENT eu lieu, et l'appartenance a été reprouvée juste avant d'écrire.
    const bascule = journal.indexOf('sync copie switch -C autowin/recovery/run-d')
    expect(bascule).toBeGreaterThan(-1)
    expect(journal.slice(0, bascule).filter((l) => l.endsWith(SONDE_DE_LA_COPIE))).toEqual([
      `async ${SONDE_DE_LA_COPIE}`,
      `async ${SONDE_DE_LA_COPIE}`
    ])
    expect(resultat).toEqual(['run-d'])
    expect(existsSync(copie)).toBe(false)
  })

  it('jumeau refusé : la copie amputée juste avant l’écriture n’est ni basculée ni indexée', async () => {
    const { wm, copie, journal, sondesSynchrones } = copiePreservable({
      amputeeAvantEcriture: true
    })

    const { resultat, silenceMs } = await plusLongSilencePendant(() =>
      wm.sweepAbandonedAgentCopiesAsync()
    )

    expect(silenceMs).toBeLessThan(SILENCE_TOLERE_MS)
    expect(sondesSynchrones).toEqual([])
    expect(journal.filter((l) => / copie (switch|add|commit)\b/.test(l))).toEqual([])
    expect(resultat).toEqual([])
    expect(existsSync(join(copie, 'travail.txt'))).toBe(true)
  })

  for (const rang of [1, 2]) {
    it(`jumeau refusé : un run reprend la copie pendant la sonde n°${rang}, rien n’est écrit`, async () => {
      const { wm, copie, journal } = copiePreservable({ bailPendantLaSonde: rang })

      const resultat = await wm.sweepAbandonedAgentCopiesAsync()

      expect(journal.filter((l) => l === `async ${SONDE_DE_LA_COPIE}`)).toHaveLength(rang)
      expect(journal.filter((l) => / copie (switch|add|commit)\b/.test(l))).toEqual([])
      expect(resultat).toEqual([])
      expect(existsSync(join(copie, 'travail.txt'))).toBe(true)
    })
  }
})
