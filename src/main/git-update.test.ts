import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkForUpdate, applyUpdate, type GitRunner } from './git-update'

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
      'rev-list --count HEAD..origin/main': '3'
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
      strategies: ['fast-forward']
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
})

describe('applyUpdate', () => {
  it('arbre SALE → met le travail de cote via --autostash au lieu de REFUSER', async () => {
    // L'ancien comportement refusait, ce qui obligeait a commiter n'importe quoi pour recuperer une
    // mise a jour. `--autostash` est confie a git : il remet le travail meme si l'operation echoue.
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return { stdout: 'main' }
      if (args.join(' ') === 'status --porcelain') return { stdout: ' M src/x.ts' }
      return { stdout: '' }
    }
    const r = await applyUpdate('/r', {}, run, async () => {})
    expect(r.ok).toBe(true)
    expect(calls).toContainEqual(['pull', '--ff-only', '--autostash'])
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
  const onBranch = (calls: string[][]): GitRunner => async (args) => {
    calls.push(args)
    return args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? { stdout: 'feat/x' } : { stdout: '' }
  }

  it('sans strategie explicite : ne touche a RIEN et POSE la question', async () => {
    const calls: string[][] = []
    const r = await applyUpdate('/r', {}, onBranch(calls), async () => {})
    expect(r.needsChoice).toBe(true)
    expect(r.strategies).toEqual(['merge', 'rebase', 'switch-main'])
    // Aucune commande mutante : c'est une question, pas un echec, et surtout pas un merge fabrique.
    expect(calls.some((c) => ['pull', 'merge', 'rebase', 'switch'].includes(c[0]))).toBe(false)
  })

  it('strategie merge : fusionne origin/main avec autostash', async () => {
    const calls: string[][] = []
    const r = await applyUpdate('/r', { strategy: 'merge' }, onBranch(calls), async () => {})
    expect(r).toMatchObject({ ok: true, strategy: 'merge' })
    expect(calls).toContainEqual(['merge', '--autostash', 'origin/main'])
  })

  it('strategie rebase : rejoue par-dessus origin/main', async () => {
    const calls: string[][] = []
    const r = await applyUpdate('/r', { strategy: 'rebase' }, onBranch(calls), async () => {})
    expect(r).toMatchObject({ ok: true, strategy: 'rebase' })
    expect(calls).toContainEqual(['rebase', '--autostash', 'origin/main'])
  })

  it('strategie switch-main : bascule PUIS avance, sans toucher au travail de la branche', async () => {
    const calls: string[][] = []
    const r = await applyUpdate('/r', { strategy: 'switch-main' }, onBranch(calls), async () => {})
    expect(r).toMatchObject({ ok: true, strategy: 'switch-main' })
    expect(calls).toContainEqual(['switch', 'main'])
    expect(calls).toContainEqual(['pull', '--ff-only', '--autostash'])
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
  it('sur une branche de feature → REFUSE de pull, explique quoi faire', async () => {
    const pulled = vi.fn()
    const run: GitRunner = async (args) => {
      const key = args.join(' ')
      if (args[0] === 'pull') pulled()
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'feat/quotas' }
      return { stdout: '' } // status vide = propre
    }
    const r = await applyUpdate('/r', {}, run, async () => {})
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/feat\/quotas/)
    expect(pulled).not.toHaveBeenCalled()
  })

  it('sur main → pull ff-only normal', async () => {
    const pulled = vi.fn()
    const run: GitRunner = async (args) => {
      const key = args.join(' ')
      if (args[0] === 'pull') pulled()
      if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'main' }
      return { stdout: '' }
    }
    const r = await applyUpdate('/r', {}, run, async () => {})
    expect(r).toMatchObject({ ok: true, relaunch: true })
    expect(pulled).toHaveBeenCalledOnce()
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
