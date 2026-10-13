import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brainEstUnDepot, sharedBrainRoot } from './brain-paths'
import { appliquerBrainReglage, brainReglageFile, effacerBrainReglage, lireBrainReglage } from './brain-reglage'
import { resolveBrainRuntime } from './brain-server-launch'
import { captureCloseBaseline, closeGreenRunOnDisk, type GitRunner } from './run-autoclose'

/**
 * LE BRAIN SE RENSEIGNE DANS LES RÉGLAGES (demande utilisateur du 2026-10-13) : un chemin et/ou un
 * dépôt. Au travail, un simple dossier sur un partage réseau sans aucune commande git ; à la maison, un dépôt.
 */
const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})
function temp(prefixe = 'autowin-brain-reglage-'): string {
  const d = mkdtempSync(join(tmpdir(), prefixe))
  dossiers.push(d)
  return d
}
/** Un poste : son APPDATA (où vit le réglage) et son LOCALAPPDATA (dossier local d'Autowin). */
function poste(): NodeJS.ProcessEnv {
  const racine = temp()
  return { APPDATA: join(racine, 'Roaming'), LOCALAPPDATA: join(racine, 'Local') }
}
const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const realGit: GitRunner = async (args, cwd) => git(args, cwd)

describe('réglage du Brain — chemin et/ou dépôt', () => {
  it('chemin seul : c’est la racine du Brain, et ce n’est PAS un dépôt', async () => {
    const env = poste()
    const brain = temp()
    await appliquerBrainReglage({ chemin: brain }, { env, racineParDefaut: 'X:/jamais' })

    expect(lireBrainReglage(env)).toEqual({ chemin: brain })
    expect(sharedBrainRoot(env)).toBe(brain)
    expect(resolveBrainRuntime(env).brainRoot, 'le serveur qui écrit les notes suit le même dossier').toBe(brain)
    expect(brainEstUnDepot(env)).toBe(false)
  })

  it('dépôt sans chemin : cloné dans le dossier local d’Autowin, qui devient la racine', async () => {
    const env = poste()
    const source = temp()
    git(['init', '-b', 'main'], source)
    git(['-c', 'user.email=t@t.t', '-c', 'user.name=T', 'commit', '--allow-empty', '-m', 'init'], source)
    const parDefaut = join(env.LOCALAPPDATA!, 'AutowinBrain', 'brain')

    await appliquerBrainReglage({ depot: source }, { env, racineParDefaut: parDefaut })

    expect(existsSync(join(parDefaut, '.git')), 'le dépôt doit être cloné').toBe(true)
    expect(sharedBrainRoot(env)).toBe(parDefaut)
    expect(brainEstUnDepot(env)).toBe(true)
  })

  it('refuse un chemin incomplet, un dossier introuvable, ou un dépôt sur un dossier rempli qui n’en est pas un', async () => {
    const env = poste()
    const rempli = temp()
    writeFileSync(join(rempli, 'note.md'), '# x\n')
    const deps = { env, racineParDefaut: 'X:/jamais', cloner: async () => undefined }

    await expect(appliquerBrainReglage({ chemin: 'brain' }, deps)).rejects.toThrow(/incomplet/)
    await expect(appliquerBrainReglage({ chemin: join(rempli, 'absent') }, deps)).rejects.toThrow(/introuvable/)
    await expect(appliquerBrainReglage({ chemin: rempli, depot: 'https://x/brain.git' }, deps)).rejects.toThrow(
      /n'est pas un dépôt git/
    )
    expect(existsSync(brainReglageFile(env)!), 'rien n’est enregistré sur un refus').toBe(false)
  })

  it('effacer le réglage rend la résolution d’avant', async () => {
    const env = poste()
    const avant = sharedBrainRoot(env)
    await appliquerBrainReglage({ chemin: temp() }, { env, racineParDefaut: 'X:/jamais' })
    effacerBrainReglage(env)
    expect(sharedBrainRoot(env)).toBe(avant)
  })

  it('une racine posée sous le nom neutre pour CE process garde la main', async () => {
    const env = poste()
    await appliquerBrainReglage({ chemin: temp() }, { env, racineParDefaut: 'X:/jamais' })
    expect(sharedBrainRoot({ ...env, AUTOWIN_BRAIN_ROOT: 'D:/impose' })).toBe('D:/impose')
  })
})

describe('Brain sans dépôt : la clôture d’un run n’y lance aucune commande git', () => {
  it('LE CAS DEMANDÉ : Brain simple dossier (partage réseau) → rien de commité, aucun git lancé sur lui', async () => {
    const projet = temp()
    git(['init', '-b', 'travail'], projet)
    git(['-c', 'user.email=t@t.t', '-c', 'user.name=T', 'commit', '--allow-empty', '-m', 'base'], projet)
    // Le dossier du Brain porte un `.git` (comme le partage de l'entreprise aujourd'hui) : il ne doit pas compter.
    const brain = temp()
    git(['init', '-b', 'main'], brain)
    mkdirSync(join(brain, 'inbox'))
    const appelsBrain: string[][] = []
    const espion: GitRunner = async (args, cwd, options) => {
      if (cwd === brain) appelsBrain.push(args)
      return realGit(args, cwd, options)
    }

    const baseline = await captureCloseBaseline(projet, undefined, espion)
    writeFileSync(join(brain, 'inbox', 'lecon.md'), 'Provenance Autowin (v1):\n- run: run-1\n')
    const report = await closeGreenRunOnDisk({
      runId: 'run-1',
      task: 't',
      projectRepo: projet,
      brainRepo: undefined,
      baseline,
      runGit: espion
    })

    expect(report.brain).toEqual({ status: 'skipped', reason: 'brain-sans-depot' })
    expect(appelsBrain, 'aucune commande git sur le Brain').toEqual([])
    expect(git(['status', '--porcelain', '-uall'], brain)).toContain('inbox/lecon.md')
  })

  it('le réglage est bien branché dans la clôture des runs de l’app (os.ts)', () => {
    const os = readFileSync(join(__dirname, 'os.ts'), 'utf8')
    expect(os.match(/brainEstUnDepot\(\) \? sharedBrainRoot\(\) : undefined/g) ?? []).toHaveLength(3)
    expect(os).not.toMatch(/brainRepo: sharedBrainRoot\(\)/)
  })
})
