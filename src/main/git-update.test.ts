import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  abortUpdateConflict,
  checkForUpdate,
  applyUpdate,
  INCOMING_FILES_MAX,
  parseIncomingCommits,
  type GitRunner
} from './git-update'

/** Clé exacte de la commande qui lit les commits entrants (cf. `readIncoming`). */
const LOG_INCOMING =
  '-c core.quotePath=false log --max-count=20 --format=%x1e%H%x1f%an%x1f%aI%x1f%s --name-only HEAD..origin/main'
const RS = String.fromCharCode(0x1e)
const US = String.fromCharCode(0x1f)
const NL = String.fromCharCode(10)
const CR = String.fromCharCode(13)

function runnerFrom(map: Record<string, string>, throwOn?: string): GitRunner {
  return async (args) => {
    const key = args.join(' ')
    if (throwOn && key.includes(throwOn)) throw new Error(`fail: ${key}`)
    return { stdout: map[key] ?? '' }
  }
}

describe('checkForUpdate', () => {
  it('en retard de N commits → available avec behind=N', async () => {
    const run = runnerFrom({
      'fetch --quiet': '',
      'rev-parse --abbrev-ref HEAD': 'main',
      'rev-list --count HEAD..origin/main': '3',
      [LOG_INCOMING]: `${RS}abc123${US}Emmanuel${US}2026-09-25T10:00:00+02:00${US}fix: rail${NL}${NL}src/a.ts${NL}`
    })
    // La reference comparee est l'etat d'EQUIPE (origin/main), pas l'upstream de la branche sortie.
    // `toEqual` volontairement EXHAUSTIF : un champ ajoute au contrat doit forcer une relecture de ce
    // test, pas passer inapercu. `dirty` et `strategies` sont remontes pour que l'interface puisse
    // annoncer ce qui va se passer AVANT le clic.
    expect(await checkForUpdate('/r', run)).toEqual({
      available: true,
      behind: 3,
      branch: 'main',
      reference: 'origin/main',
      dirty: false,
      conflicted: false,
      strategies: ['fast-forward'],
      incoming: [
        {
          hash: 'abc123',
          author: 'Emmanuel',
          date: '2026-09-25T10:00:00+02:00',
          subject: 'fix: rail',
          files: ['src/a.ts'],
          fileCount: 1
        }
      ]
    })
  })

  it('à jour (behind=0) → non available', async () => {
    const run = runnerFrom({
      'fetch --quiet': '',
      'rev-parse --abbrev-ref HEAD': 'main',
      'rev-list --count HEAD..origin/main': '0'
    })
    expect(await checkForUpdate('/r', run)).toMatchObject({ available: false, behind: 0 })
  })

  it('hors repo git / fetch échoue → indisponible silencieux (pas de throw)', async () => {
    const run = runnerFrom({}, 'fetch')
    const r = await checkForUpdate('/r', run)
    expect(r.available).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('fusion déjà en conflit → rend l’action d’annulation disponible même sans retard', async () => {
    const run = runnerFrom({
      'fetch --quiet': '',
      'rev-parse --abbrev-ref HEAD': 'feat/x',
      'rev-list --count HEAD..origin/main': '0',
      'status --porcelain': 'UU src/x.ts',
      'diff --name-only --diff-filter=U': 'src/x.ts',
      'rev-parse --verify --quiet MERGE_HEAD': 'abc123'
    })
    expect(await checkForUpdate('/r', run)).toMatchObject({
      available: true,
      behind: 0,
      conflicted: true,
      conflictOperation: 'merge'
    })
  })

  it('fusion en conflit + remote indisponible → garde l’annulation locale sans fetch', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'diff --name-only --diff-filter=U') return { stdout: 'src/x.ts' }
      if (key === 'rev-parse --verify --quiet MERGE_HEAD') return { stdout: 'abc123' }
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'feat/x' }
      if (key === 'fetch --quiet') throw new Error('remote indisponible')
      return { stdout: '' }
    }

    expect(await checkForUpdate('/r', run)).toMatchObject({
      available: true,
      conflicted: true,
      conflictOperation: 'merge'
    })
    expect(calls).not.toContainEqual(['fetch', '--quiet'])
  })
})

describe('abortUpdateConflict', () => {
  it('annule une vraie fusion puis vérifie que les conflits ont disparu', async () => {
    const calls: string[][] = []
    let aborted = false
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'diff --name-only --diff-filter=U') return { stdout: aborted ? '' : 'src/x.ts' }
      if (key === 'rev-parse --verify --quiet MERGE_HEAD') return { stdout: 'abc123' }
      if (key === 'merge --abort') aborted = true
      return { stdout: '' }
    }

    expect(await abortUpdateConflict('/r', run)).toMatchObject({
      ok: true,
      effect: 'none',
      reload: false,
      relaunch: false
    })
    expect(calls).toContainEqual(['merge', '--abort'])
  })

  it('refuse si des fichiers sont en conflit mais aucune fusion MERGE_HEAD n’est ouverte', async () => {
    const run = runnerFrom({
      'diff --name-only --diff-filter=U': 'src/x.ts',
      'rev-parse --verify --quiet MERGE_HEAD': ''
    })
    const result = await abortUpdateConflict('/r', run)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/aucune fusion/i)
  })
})

describe('applyUpdate', () => {
  it('arbre SALE → mise à jour tentée TELLE QUELLE, AUCUN stash', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return { stdout: 'main' }
      if (args.join(' ') === 'status --porcelain') return { stdout: ' M src/x.ts' }
      if (args.join(' ') === 'diff --name-only --diff-filter=U') return { stdout: '' }
      return { stdout: '' }
    }
    const r = await applyUpdate('/r', {}, run, async () => {})
    expect(r.ok).toBe(true)
    // Plus JAMAIS de stash : la mécanique push/pop a déjà effacé du travail non committé.
    expect(calls.some((args) => args[0] === 'stash')).toBe(false)
    expect(calls).toContainEqual(['merge', '--ff-only', 'origin/main'])
  })

  it('main DIVERGÉE → pose le choix rebaser/fusionner au lieu de tenter une avance impossible', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'main' }
      if (key === 'rev-list --count origin/main..HEAD') return { stdout: '2' }
      if (key === 'diff --name-only --diff-filter=U') return { stdout: '' }
      if (key === 'status --porcelain') return { stdout: '' }
      return { stdout: '' }
    }
    const r = await applyUpdate('/r', {}, run, async () => {})
    expect(r.ok).toBe(false)
    expect(r.needsChoice).toBe(true)
    expect(r.strategies).toEqual(['rebase', 'merge'])
    // Le geste qui ne pouvait QUE échouer n'est même plus tenté.
    expect(calls).not.toContainEqual(['merge', '--ff-only', 'origin/main'])
  })

  it('main divergée + arbre SALE → le rebase ne se propose plus (git le refuse à coup sûr)', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'main' }
      if (key === 'rev-list --count origin/main..HEAD') return { stdout: '2' }
      if (key === 'diff --name-only --diff-filter=U') return { stdout: '' }
      if (key === 'status --porcelain') return { stdout: ' M src/a.ts' }
      return { stdout: '' }
    }
    const r = await applyUpdate('/r', {}, run, async () => {})
    expect(r.needsChoice).toBe(true)
    expect(r.strategies).toEqual(['merge'])
    const forced = await applyUpdate('/r', { strategy: 'rebase' }, run, async () => {})
    expect(forced.ok).toBe(false)
    expect(calls).not.toContainEqual(['rebase', 'origin/main'])
  })

  it('main divergée + stratégie NOMMÉE → rebase accepté depuis main', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'main' }
      if (key === 'rev-list --count origin/main..HEAD') return { stdout: '2' }
      if (key === 'diff --name-only --diff-filter=U') return { stdout: '' }
      if (key === 'status --porcelain') return { stdout: '' }
      return { stdout: '' }
    }
    const r = await applyUpdate('/r', { strategy: 'rebase' }, run, async () => {})
    expect(r.ok).toBe(true)
    expect(calls).toContainEqual(['rebase', 'origin/main'])
  })

  it('dépôt déjà en conflit → refuse avant stash ou mise à jour', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return { stdout: 'feat/x' }
      if (args.join(' ') === 'diff --name-only --diff-filter=U') return { stdout: 'src/conflit.ts' }
      return { stdout: '' }
    }

    const r = await applyUpdate('/r', { strategy: 'merge' }, run, async () => {})
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/déjà en conflit/i)
    expect(calls.some((args) => ['stash', 'merge', 'pull', 'rebase'].includes(args[0]))).toBe(false)
  })

  it('fusion échouée → annule la fusion, travail local INTACT (aucun stash)', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'feat/x' }
      if (key === 'status --porcelain') return { stdout: ' M src/x.ts' }
      if (key === 'merge origin/main') throw new Error('CONFLICT')
      return { stdout: '' }
    }

    const r = await applyUpdate('/r', { strategy: 'merge' }, run, async () => {})
    expect(r.ok).toBe(false)
    const merge = calls.findIndex((args) => args.join(' ') === 'merge origin/main')
    const abort = calls.findIndex((args) => args.join(' ') === 'merge --abort')
    expect(abort).toBeGreaterThan(merge)
    expect(calls.some((args) => args[0] === 'stash')).toBe(false)
    expect(r.error).toMatch(/intact/i)
  })

  it('arbre sale bloquant la MàJ → le DIT, travail intact, sans stash', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'main' }
      if (key === 'status --porcelain') return { stdout: ' M src/x.ts' }
      if (key === 'merge --ff-only origin/main')
        throw new Error('local changes would be overwritten')
      return { stdout: '' }
    }

    const r = await applyUpdate('/r', {}, run, async () => {})
    expect(r).toMatchObject({ ok: false, strategy: 'fast-forward' })
    expect(calls.some((args) => args[0] === 'stash')).toBe(false)
    expect(r.error).toMatch(/intact/i)
    expect(r.error).toMatch(/committe|mets-le de côté/i)
  })

  it('sur main : fast-forward par defaut, relaunch, npm install seulement si package a change', async () => {
    const run: GitRunner = async (args) =>
      args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? { stdout: 'main' } : { stdout: '' }
    const npm = vi.fn().mockResolvedValue(undefined)
    const r = await applyUpdate('/r', {}, run, npm)
    expect(r).toMatchObject({ ok: true, relaunch: true, strategy: 'fast-forward' })
    expect(npm).not.toHaveBeenCalled()
  })
})

describe('applyUpdate — souplesse HORS de main, sans mutation non demandee', () => {
  const onBranch =
    (calls: string[][]): GitRunner =>
    async (args) => {
      calls.push(args)
      return args.join(' ') === 'rev-parse --abbrev-ref HEAD'
        ? { stdout: 'feat/x' }
        : { stdout: '' }
    }

  it('sans strategie explicite : ne touche a RIEN et POSE la question', async () => {
    const calls: string[][] = []
    const r = await applyUpdate('/r', {}, onBranch(calls), async () => {})
    expect(r.needsChoice).toBe(true)
    expect(r.strategies).toEqual(['merge', 'rebase', 'switch-main'])
    // Aucune commande mutante : c'est une question, pas un echec, et surtout pas un merge fabrique.
    expect(calls.some((c) => ['pull', 'merge', 'rebase', 'switch'].includes(c[0]))).toBe(false)
  })

  it('strategie merge : fusionne origin/main sans autostash implicite', async () => {
    const calls: string[][] = []
    const r = await applyUpdate('/r', { strategy: 'merge' }, onBranch(calls), async () => {})
    expect(r).toMatchObject({ ok: true, strategy: 'merge' })
    expect(calls).toContainEqual(['merge', 'origin/main'])
  })

  it('strategie rebase : rejoue par-dessus origin/main', async () => {
    const calls: string[][] = []
    const r = await applyUpdate('/r', { strategy: 'rebase' }, onBranch(calls), async () => {})
    expect(r).toMatchObject({ ok: true, strategy: 'rebase' })
    expect(calls).toContainEqual(['rebase', 'origin/main'])
  })

  it('strategie switch-main : bascule PUIS avance, sans toucher au travail de la branche', async () => {
    const calls: string[][] = []
    const r = await applyUpdate('/r', { strategy: 'switch-main' }, onBranch(calls), async () => {})
    expect(r).toMatchObject({ ok: true, strategy: 'switch-main' })
    expect(calls).toContainEqual(['switch', 'main'])
    expect(calls).toContainEqual(['merge', '--ff-only', 'origin/main'])
    expect(calls).toContainEqual(['switch', 'feat/x'])
  })

  it('switch-main sur arbre sale : bascule et revient, SANS stash', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'feat/x' }
      if (key === 'status --porcelain') return { stdout: ' M src/x.ts' }
      return { stdout: '' }
    }

    expect(await applyUpdate('/r', { strategy: 'switch-main' }, run, async () => {})).toMatchObject(
      {
        ok: true,
        strategy: 'switch-main'
      }
    )
    expect(calls.some((args) => args[0] === 'stash')).toBe(false)
    const main = calls.findIndex((args) => args.join(' ') === 'switch main')
    const pull = calls.findIndex((args) => args.join(' ') === 'merge --ff-only origin/main')
    const origin = calls.findIndex((args) => args.join(' ') === 'switch feat/x')
    expect(main).toBeGreaterThan(-1)
    expect(pull).toBeGreaterThan(main)
    expect(origin).toBeGreaterThan(pull)
  })

  it('switch-main échoué : revient sur la branche, sans stash pop', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'feat/x' }
      if (key === 'status --porcelain') return { stdout: ' M src/x.ts' }
      if (key === 'merge --ff-only origin/main') throw new Error('remote indisponible')
      return { stdout: '' }
    }

    expect(await applyUpdate('/r', { strategy: 'switch-main' }, run, async () => {})).toMatchObject(
      {
        ok: false,
        strategy: 'switch-main'
      }
    )
    const pull = calls.findIndex((args) => args.join(' ') === 'merge --ff-only origin/main')
    const origin = calls.findIndex((args) => args.join(' ') === 'switch feat/x')
    expect(origin).toBeGreaterThan(pull)
    expect(calls.some((args) => args[0] === 'stash')).toBe(false)
  })

  it('refuse une strategie INAPPLICABLE ici plutot que de faire autre chose', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      return args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? { stdout: 'main' } : { stdout: '' }
    }
    const r = await applyUpdate('/r', { strategy: 'rebase' }, run, async () => {})
    expect(r.ok).toBe(false)
    expect(r.strategies).toEqual(['fast-forward'])
    expect(calls.some((c) => c[0] === 'rebase')).toBe(false)
  })
})

describe('checkForUpdate — reference equipe (trous constates)', () => {
  it('sur une branche de FEATURE, mesure le retard sur origin/main (pas sur sa propre branche)', async () => {
    // Trou constate : la banniere annoncait « a jour » alors que main avait avance.
    const run = runnerFrom({
      'fetch --quiet': '',
      'rev-parse --abbrev-ref HEAD': 'feat/quotas',
      'rev-list --count HEAD..origin/main': '7',
      'rev-list --count HEAD..@{u}': '0'
    })
    expect(await checkForUpdate('/r', run)).toMatchObject({
      available: true,
      behind: 7,
      branch: 'feat/quotas',
      reference: 'origin/main'
    })
  })

  it('sans origin/main (fork, autre branche par defaut) : repli sur upstream, jamais un silence', async () => {
    const run: GitRunner = async (args) => {
      const key = args.join(' ')
      if (key === 'rev-list --count HEAD..origin/main') throw new Error('unknown revision')
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'develop' }
      if (key === 'rev-list --count HEAD..@{u}') return { stdout: '2' }
      return { stdout: '' }
    }
    expect(await checkForUpdate('/r', run)).toMatchObject({
      available: true,
      behind: 2,
      reference: '@{u}'
    })
  })
})

describe('applyUpdate — jamais de mutation silencieuse dune branche', () => {
  it('sur une branche de feature → REFUSE d avancer, explique quoi faire', async () => {
    const pulled = vi.fn()
    const run: GitRunner = async (args) => {
      const key = args.join(' ')
      if (args[0] === 'pull' || args.includes('--ff-only')) pulled()
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'feat/quotas' }
      return { stdout: '' } // status vide = propre
    }
    const r = await applyUpdate('/r', {}, run, async () => {})
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/feat\/quotas/)
    expect(pulled).not.toHaveBeenCalled()
  })

  // `git pull` relit FETCH_HEAD, un fichier PARTAGE : un fetch concurrent (agents, copies de travail)
  // y ecrit plusieurs branches « a fusionner » et git refuse alors avec « Cannot fast-forward to
  // multiple branches », alors qu'AUCUN conflit reel n'existe. On avance donc sur une reference
  // NOMMEE. Mesure du 2026-09-02 : mise a jour bloquee sur un arbre propre en retard pur.
  it('sur main → avance sur origin/main NOMMEE, sans jamais appeler pull', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      const key = args.join(' ')
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'main' }
      return { stdout: '' }
    }
    const r = await applyUpdate('/r', {}, run, async () => {})
    expect(r).toMatchObject({ ok: true, relaunch: true })
    expect(calls).toContainEqual(['merge', '--ff-only', 'origin/main'])
    expect(calls.some((args) => args[0] === 'pull')).toBe(false)
  })
})

/**
 * Le check tournait sur `process.cwd()`. En DÉVELOPPEMENT le cwd EST le dépôt, donc la bannière
 * marchait — par accident. Dans l'app PACKAGÉE, le cwd est le dossier de lancement de l'exe :
 * `git fetch` y échoue (« not a git repository »), l'erreur est capturée en `{available:false}`
 * et la bannière reste MUETTE. Symptôme rapporté le 2026-08-04 : des merges sur `main` ne
 * déclenchaient aucun bouton chez les collègues.
 */
describe('le check de mise à jour vise le DÉPÔT, pas le dossier de lancement', () => {
  const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const handlers = source.slice(
    source.indexOf("ipcMain.handle('update:check'"),
    source.indexOf("ipcMain.handle('update:apply'") + 900
  )

  it('passe le workspace canonique aux deux handlers', () => {
    expect(handlers).toContain('checkForUpdate(os.executionWorkspace)')
    expect(handlers).toContain('applyUpdate(os.executionWorkspace')
  })

  it('n’utilise plus process.cwd() pour la mise à jour', () => {
    // On écarte les lignes de commentaire : elles CITENT `process.cwd()` pour expliquer le défaut.
    const code = handlers
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(code).not.toContain('process.cwd()')
  })

  it('une erreur de fetch reste silencieuse — d’où l’importance du bon dossier', () => {
    // Confirme le mécanisme du symptôme : hors dépôt, aucun signal n'atteint l'utilisateur.
    const throwing: GitRunner = async () => {
      throw new Error('fatal: not a git repository')
    }
    return checkForUpdate('/pas-un-depot', throwing).then((status) => {
      expect(status.available).toBe(false)
      expect(status.behind).toBe(0)
    })
  })
})

describe('checkForUpdate — qui a poussé quoi (commits entrants)', () => {
  it('lecture des commits en échec → le compte reste, AUCUN blocage, aucun champ inventé', async () => {
    const run = runnerFrom(
      {
        'fetch --quiet': '',
        'rev-parse --abbrev-ref HEAD': 'main',
        'rev-list --count HEAD..origin/main': '2'
      },
      ' log '
    )
    const status = await checkForUpdate('/r', run)
    expect(status).toMatchObject({ available: true, behind: 2 })
    expect(status).not.toHaveProperty('incoming')
  })

  it('à jour → git log n’est même pas lancé', async () => {
    const calls: string[] = []
    const run: GitRunner = async (args) => {
      calls.push(args.join(' '))
      return { stdout: args.includes('--count') ? '0' : '' }
    }
    await checkForUpdate('/r', run)
    expect(calls.some((c) => c.includes(' log '))).toBe(false)
  })

  it('découpe auteur / date / sujet / fichiers, merges sans fichiers compris, chemins accentués intacts', () => {
    const stdout =
      `${RS}h1${US}Emmanuel Heurtier${US}2026-09-25T09:00:00+02:00${US}Merge pull request #12${US}suite${NL}` +
      `${RS}h2${US}raphael${US}2026-09-24T18:00:00+02:00${US}feat: rail${CR}${NL}${CR}${NL}` +
      `src/éditeur.ts${CR}${NL}README.md${CR}${NL}`
    expect(parseIncomingCommits(stdout)).toEqual([
      {
        hash: 'h1',
        author: 'Emmanuel Heurtier',
        date: '2026-09-25T09:00:00+02:00',
        subject: `Merge pull request #12${US}suite`,
        files: [],
        fileCount: 0
      },
      {
        hash: 'h2',
        author: 'raphael',
        date: '2026-09-24T18:00:00+02:00',
        subject: 'feat: rail',
        files: ['src/éditeur.ts', 'README.md'],
        fileCount: 2
      }
    ])
  })

  it('beaucoup de fichiers → liste tronquée, total conservé', () => {
    const files = Array.from({ length: INCOMING_FILES_MAX + 5 }, (_, i) => `f${i}.ts`)
    const [commit] = parseIncomingCommits(`${RS}h${US}a${US}d${US}s${NL}${NL}${files.join(NL)}${NL}`)
    expect(commit.files).toHaveLength(INCOMING_FILES_MAX)
    expect(commit.fileCount).toBe(INCOMING_FILES_MAX + 5)
  })

  it('sortie vide → aucune ligne fantôme', () => {
    expect(parseIncomingCommits('')).toEqual([])
    expect(parseIncomingCommits(`${NL}${NL}`)).toEqual([])
  })
})
