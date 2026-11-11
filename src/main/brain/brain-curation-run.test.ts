import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CURATION_REVIEWER,
  pendingCandidateCount,
  resetBrainCurationAttempt,
  startBrainCuration
} from './brain-curation-run'

function fauxBrain(candidats: string[]): { root: string; tooling: string; python: string } {
  const root = mkdtempSync(join(tmpdir(), 'curation-'))
  const tooling = join(root, 'tooling')
  mkdirSync(join(root, 'inbox'), { recursive: true })
  mkdirSync(tooling, { recursive: true })
  writeFileSync(join(root, 'inbox', 'README.md'), '# Inbox')
  for (const nom of candidats) writeFileSync(join(root, 'inbox', nom), '---\nstatus: candidate\n---\n')
  const python = join(tooling, 'python.exe')
  writeFileSync(python, '')
  writeFileSync(join(tooling, 'brain_curate.py'), '')
  return { root, tooling, python }
}

describe('déclencheur de curation Brain', () => {
  afterEach(() => resetBrainCurationAttempt())

  it('ne compte pas le README parmi les candidats en attente', () => {
    const { root } = fauxBrain(['a.md', 'b.md'])
    expect(pendingCandidateCount(root)).toBe(2)
  })

  it('lance la curation en --apply avec un relecteur distinct de l’auteur', () => {
    const { root, tooling, python } = fauxBrain(['a.md'])
    const appels: string[][] = []
    const spawnFn = (_bin: string, args: readonly string[]) => {
      appels.push([...args])
      return { unref: vi.fn() }
    }
    const resultat = startBrainCuration(
      { AUTOWIN_BRAIN_ROOT: root, AUTOWIN_BRAIN_TOOLING: tooling, AUTOWIN_BRAIN_PYTHON: python },
      spawnFn
    )
    expect(resultat.status).toBe('launched')
    const args = appels[0]
    expect(args).toContain('--apply')
    expect(args[args.indexOf('--reviewer') + 1]).toBe(CURATION_REVIEWER)
    expect(CURATION_REVIEWER.split(':')[0]).not.toBe('autowin-os')
  })

  it('vise la boîte et l’index de la RACINE du Brain, pas le dossier du code installé', () => {
    // Mesuré le 2026-09-29 : sans `--brain`, brain_curate.py prend le parent de son propre dossier
    // (%LOCALAPPDATA%\AcmeBrain, sans inbox/) — la curation de démarrage ne voyait AUCUN
    // candidat alors que l'app en comptait un sur le partage. Prouvé en vrai à 08:57:24 : avec
    // `--brain`, le candidat en attente a été promu dès le démarrage.
    const { root, python } = fauxBrain(['a.md'])
    const installe = mkdtempSync(join(tmpdir(), 'curation-tooling-'))
    writeFileSync(join(installe, 'brain_curate.py'), '')
    const appels: string[][] = []
    const spawnFn = (_bin: string, args: readonly string[]) => {
      appels.push([...args])
      return { unref: vi.fn() }
    }
    // Code installé HORS de la racine, comme en vrai (%LOCALAPPDATA%\AcmeBrain\tooling).
    const env = {
      AUTOWIN_BRAIN_ROOT: root,
      AUTOWIN_BRAIN_TOOLING: installe,
      AUTOWIN_BRAIN_PYTHON: python
    }
    expect(startBrainCuration(env, spawnFn).status).toBe('launched')
    const args = appels[0]
    expect(args[args.indexOf('--brain') + 1]).toBe(root)
    expect(args[args.indexOf('--index') + 1]).toBe(join(root, 'tooling', 'index'))
    // Le script lui-même reste celui du code INSTALLÉ, et la promotion reste demandée.
    expect(args).toContain(join(installe, 'brain_curate.py'))
    expect(args).toContain('--apply')
  })

  it('écrit la sortie de la curation dans un journal sous LOCALAPPDATA, au lieu de la jeter', () => {
    const { root, tooling, python } = fauxBrain(['a.md'])
    const local = mkdtempSync(join(tmpdir(), 'curation-local-'))
    const options: Record<string, unknown>[] = []
    const spawnFn = (_bin: string, _args: readonly string[], opts: Record<string, unknown>) => {
      options.push(opts)
      return { unref: vi.fn() }
    }
    const env = {
      AUTOWIN_BRAIN_ROOT: root,
      AUTOWIN_BRAIN_TOOLING: tooling,
      AUTOWIN_BRAIN_PYTHON: python,
      LOCALAPPDATA: local
    }
    expect(startBrainCuration(env, spawnFn).status).toBe('launched')
    const journal = join(local, 'autowin-brain-curation.log')
    expect(readFileSync(journal, 'utf8')).toContain(`curation de ${root} (1 candidat(s))`)
    const stdio = options[0].stdio as unknown[]
    expect(typeof stdio[1]).toBe('number')
    expect(stdio[2]).toBe(stdio[1])
  })

  it('sans LOCALAPPDATA (hors Windows), la sortie reste ignorée et aucun journal n’est écrit', () => {
    const { root, tooling, python } = fauxBrain(['a.md'])
    const options: Record<string, unknown>[] = []
    const spawnFn = (_bin: string, _args: readonly string[], opts: Record<string, unknown>) => {
      options.push(opts)
      return { unref: vi.fn() }
    }
    const env = {
      AUTOWIN_BRAIN_ROOT: root,
      AUTOWIN_BRAIN_TOOLING: tooling,
      AUTOWIN_BRAIN_PYTHON: python
    }
    expect(startBrainCuration(env, spawnFn).status).toBe('launched')
    expect(options[0].stdio).toBe('ignore')
  })

  it('lance le Python de BASE sans console quand le venv est un venv uv, jamais son relais python.exe', () => {
    // Le python.exe d'un venv uv est un relais CONSOLE : il lance le Python de base dans une fenêtre
    // neuve, celle qui s'affichait à l'écran. Le serveur passait déjà par le pythonw de base ; la
    // curation, elle, lançait le relais.
    const { root, tooling } = fauxBrain(['a.md'])
    const venv = mkdtempSync(join(tmpdir(), 'curation-uv-venv-'))
    const base = mkdtempSync(join(tmpdir(), 'curation-uv-base-'))
    mkdirSync(join(venv, 'Scripts'), { recursive: true })
    writeFileSync(join(venv, 'Scripts', 'python.exe'), '')
    writeFileSync(join(venv, 'Scripts', 'pythonw.exe'), '')
    writeFileSync(join(base, 'pythonw.exe'), '')
    writeFileSync(join(venv, 'pyvenv.cfg'), `home = ${base}\nuv = 0.12.7\n`)
    const lances: { ligne: string; env: NodeJS.ProcessEnv | undefined }[] = []
    const spawnFn = (
      bin: string,
      args: readonly string[],
      options: { env?: NodeJS.ProcessEnv }
    ) => {
      lances.push({ ligne: [bin, ...args].join(' '), env: options.env })
      return { unref: vi.fn() }
    }
    const env = {
      AUTOWIN_BRAIN_ROOT: root,
      AUTOWIN_BRAIN_TOOLING: tooling,
      AUTOWIN_BRAIN_PYTHON: join(venv, 'Scripts', 'python.exe')
    }
    expect(startBrainCuration(env, spawnFn as never).status).toBe('launched')
    expect(lances[0].ligne).toContain(join(base, 'pythonw.exe'))
    expect(lances[0].ligne).not.toContain(join(venv, 'Scripts', 'python.exe'))
    // Le Python de base ignore le venv : ses paquets se retrouvent par PYTHONPATH.
    expect(lances[0].env?.PYTHONPATH).toBe(join(venv, 'Lib', 'site-packages'))
  })

  it('refuse une racine qui contient un caractère interprété par cmd.exe', () => {
    const { root, tooling, python } = fauxBrain(['a.md'])
    const piegee = join(root, 'a&b')
    mkdirSync(join(piegee, 'inbox'), { recursive: true })
    writeFileSync(join(piegee, 'inbox', 'x.md'), '---\nstatus: candidate\n---\n')
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    // Racine contenant « & » : passée à cmd.exe, elle couperait la ligne de commande.
    const env = {
      AUTOWIN_BRAIN_ROOT: piegee,
      AUTOWIN_BRAIN_TOOLING: tooling,
      AUTOWIN_BRAIN_PYTHON: python
    }
    const r = startBrainCuration(env, spawnFn)
    if (process.platform === 'win32') {
      expect(r.status).toBe('unavailable')
      expect(r.detail).toMatch(/racine du Brain refusée/)
      expect(spawnFn).not.toHaveBeenCalled()
    }
  })

  it('une instance de TEST ne cure jamais le Brain partagé', () => {
    // Mesuré le 2026-09-29 à 09:04:21 : une instance isolée lancée par un autre fil a
    // démarré sa propre maintenance du Brain de production, en parallèle de l'app principale.
    const { root, tooling, python } = fauxBrain(['a.md'])
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const r = startBrainCuration(
      { AUTOWIN_BRAIN_ROOT: root, AUTOWIN_BRAIN_TOOLING: tooling, AUTOWIN_BRAIN_PYTHON: python },
      spawnFn,
      undefined,
      true
    )
    expect(r.status).toBe('nothing-to-do')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('ne lance rien quand la file est vide', () => {
    const { root, tooling, python } = fauxBrain([])
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const resultat = startBrainCuration(
      { AUTOWIN_BRAIN_ROOT: root, AUTOWIN_BRAIN_TOOLING: tooling, AUTOWIN_BRAIN_PYTHON: python },
      spawnFn
    )
    expect(resultat.status).toBe('nothing-to-do')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('la curation attend la fin de python, puis appelle la suite SEULEMENT si elle a promu', () => {
    // Mesuré le 2026-09-29 : des notes promues par `--apply` laissaient l'index périmé (503) —
    // rien n'enchaînait la reconstruction après la curation. `cmd /c start /wait` rend 0 même
    // quand python échoue : le code ne dit donc rien. Le seul signal fiable est la boîte : une
    // promotion en SORT le candidat. Mesuré aussi : une curation qui ne fait que proposer une
    // fusion (verdict `merge`, le candidat reste) relançait une reconstruction pour rien.
    const { root, tooling, python } = fauxBrain(['a.md'])
    const env = {
      AUTOWIN_BRAIN_ROOT: root,
      AUTOWIN_BRAIN_TOOLING: tooling,
      AUTOWIN_BRAIN_PYTHON: python
    }
    const fins: ((code: number) => void)[] = []
    const appels: string[][] = []
    const spawnFn = (_bin: string, args: readonly string[]) => {
      appels.push([...args])
      return {
        unref: vi.fn(),
        once: (ev: string, cb: (...a: unknown[]) => void) => {
          if (ev === 'exit') fins.push(cb as (code: number) => void)
        }
      }
    }
    // Fin SANS promotion (fusion proposée) : le candidat reste, aucune suite.
    const apresFusion = vi.fn()
    expect(startBrainCuration(env, spawnFn as never, apresFusion).status).toBe('launched')
    if (process.platform === 'win32') expect(appels[0]).toContain('/wait')
    fins[0](0)
    expect(apresFusion).not.toHaveBeenCalled()

    // Fin AVEC promotion, même sur un code non nul : le candidat a quitté la boîte.
    resetBrainCurationAttempt()
    const apres = vi.fn()
    startBrainCuration(env, spawnFn as never, apres)
    expect(apres).not.toHaveBeenCalled()
    unlinkSync(join(root, 'inbox', 'a.md'))
    fins[1](2)
    expect(apres).toHaveBeenCalledTimes(1)
  })

  describe('verrou inbox/.curation.lock (celui de la skill curate, étape 0)', () => {
    // Mesuré le 2026-09-29 : la curation de démarrage a promu une note à 08:57:24 alors que le
    // verrou d'une passe /curate d'un autre poste était posé depuis 08:34:04. Deux passes sur la
    // même boîte se volent les candidats (mesuré le 2026-09-26 : 9 sur 10 déplacés entre le
    // rapport et l'application de la seconde).
    const env = (root: string, tooling: string, python: string): NodeJS.ProcessEnv => ({
      AUTOWIN_BRAIN_ROOT: root,
      AUTOWIN_BRAIN_TOOLING: tooling,
      AUTOWIN_BRAIN_PYTHON: python
    })
    const verrouDe = (root: string): string => join(root, 'inbox', '.curation.lock')

    it('le prend AVANT de lancer --apply, le garde pendant la curation et le rend à la fin', () => {
      const { root, tooling, python } = fauxBrain(['a.md'])
      const fins: ((code: number) => void)[] = []
      let tenuAuLancement = false
      const spawnFn = (): unknown => {
        tenuAuLancement = existsSync(verrouDe(root))
        return {
          unref: vi.fn(),
          once: (ev: string, cb: (code: number) => void) => {
            if (ev === 'exit') fins.push(cb)
          }
        }
      }
      // Sans `apresCuration` : le verrou doit être rendu quand même.
      expect(startBrainCuration(env(root, tooling, python), spawnFn as never).status).toBe(
        'launched'
      )
      expect(tenuAuLancement).toBe(true)
      expect(existsSync(verrouDe(root))).toBe(true)
      fins[0](0)
      expect(existsSync(verrouDe(root))).toBe(false)
    })

    it('renonce quand une autre passe le tient, sans y toucher ni consommer la tentative', () => {
      const { root, tooling, python } = fauxBrain(['a.md'])
      mkdirSync(verrouDe(root))
      const spawnFn = vi.fn(() => ({ unref: vi.fn(), once: vi.fn() }))
      const r = startBrainCuration(env(root, tooling, python), spawnFn)
      expect(r.status).toBe('busy')
      expect(r.detail).toMatch(/verrou/)
      expect(spawnFn).not.toHaveBeenCalled()
      expect(existsSync(verrouDe(root))).toBe(true)
      // L'autre passe a rendu le verrou : une nouvelle demande peut lancer.
      rmdirSync(verrouDe(root))
      expect(startBrainCuration(env(root, tooling, python), spawnFn).status).toBe('launched')
      expect(spawnFn).toHaveBeenCalledTimes(1)
    })

    it('le rend si le lancement échoue (erreur émise, ou exception)', () => {
      const { root, tooling, python } = fauxBrain(['a.md'])
      const erreurs: ((e: Error) => void)[] = []
      const spawnErreur = (): unknown => ({
        unref: vi.fn(),
        once: (ev: string, cb: (e: Error) => void) => {
          if (ev === 'error') erreurs.push(cb)
        }
      })
      expect(startBrainCuration(env(root, tooling, python), spawnErreur as never).status).toBe(
        'launched'
      )
      expect(existsSync(verrouDe(root))).toBe(true)
      erreurs[0](new Error('spawn ENOENT'))
      expect(existsSync(verrouDe(root))).toBe(false)

      resetBrainCurationAttempt()
      const spawnQuiLeve = (): never => {
        throw new Error('spawn EPERM')
      }
      const r = startBrainCuration(env(root, tooling, python), spawnQuiLeve)
      expect(r.status).toBe('unavailable')
      expect(existsSync(verrouDe(root))).toBe(false)
    })
  })

  it('ne relance pas une deuxième fois dans la même session', () => {
    const { root, tooling, python } = fauxBrain(['a.md'])
    const spawnFn = vi.fn(() => ({ unref: vi.fn() }))
    const env = { AUTOWIN_BRAIN_ROOT: root, AUTOWIN_BRAIN_TOOLING: tooling, AUTOWIN_BRAIN_PYTHON: python }
    startBrainCuration(env, spawnFn)
    expect(startBrainCuration(env, spawnFn).status).toBe('nothing-to-do')
    expect(spawnFn).toHaveBeenCalledTimes(1)
  })
})
