import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { gestesDeVerification, VERIFY_SANS_ISOLATION } from './verification-isolee'

/**
 * UN VERDICT RENDU DANS UN DOSSIER PARTAGÉ NE PROUVE RIEN.
 *
 * DÉFAUT MESURÉ le 2026-09-02 (conv-133) : pendant un lot de tests, un autre agent a réécrit
 * `src/main/runs/conv-runs.ts` à 14:23:44 puis l'a remis à l'identique. La suite a échoué au
 * chargement sur un fichier sain — un faux rouge. La même fenêtre rend un faux VERT possible.
 *
 * Ce contrat verrouille les deux moitiés de la correction : `verify` tourne dans une COPIE, et
 * cette copie porte l'état COURANT (y compris ce qui n'est pas committé), sinon elle répondrait à
 * une question que personne ne pose.
 */

const aNettoyer: string[] = []
afterEach(() => {
  for (const chemin of aNettoyer.splice(0)) rmSync(chemin, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true })
}

/** Espace de travail RÉEL (dépôt git) : c'est git qui nomme les fichiers non committés. */
function espaceDeTravail(): string {
  const racine = mkdtempSync(join(tmpdir(), 'aos-verify-ws-'))
  aNettoyer.push(racine)
  writeFileSync(join(racine, 'package.json'), JSON.stringify({ scripts: { 'test:unit': 'x' } }))
  mkdirSync(join(racine, 'src'), { recursive: true })
  writeFileSync(join(racine, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(racine, 'src', 'parti.ts'), 'export const parti = true\n')
  git(racine, 'init')
  git(racine, 'add', '.')
  git(racine, '-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-m', 'base', '--no-verify')
  return racine
}

/** La copie telle qu'un `git worktree add` la rend : le COMMIT, sans le travail en cours. */
function copieSurLeCommit(source: string): string {
  const copie = mkdtempSync(join(tmpdir(), 'aos-verify-copie-'))
  aNettoyer.push(copie)
  writeFileSync(join(copie, 'package.json'), readFileSync(join(source, 'package.json')))
  mkdirSync(join(copie, 'src'), { recursive: true })
  writeFileSync(join(copie, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(copie, 'src', 'parti.ts'), 'export const parti = true\n')
  return copie
}

function busSur(
  workspace: string,
  copie: string | undefined
): { bus: AppCommandBus; dossiers: string[] } {
  const dossiers: string[] = []
  const os = {
    executionWorkspace: workspace,
    conversations: { get: () => ({ id: 'conv-1', messages: [] }), list: () => [] },
    ...(copie
      ? { worktrees: { begin: () => copie, travauxNonPublies: () => [] } }
      : { worktrees: undefined })
  }
  const bus = new AppCommandBus(os as never, () => {})
  // On intercepte le lancement : ce test juge OÙ la suite tourne, pas ce qu'elle rend.
  ;(bus as unknown as { spawnVerify: unknown }).spawnVerify = async (
    _argv: string[],
    cwd: string
  ) => {
    dossiers.push(cwd)
    return { allowed: true, output: 'ok', exitCode: 0, command: 'npm run test:unit', ok: true }
  }
  return { bus, dossiers }
}

describe('verify — la suite tourne dans une copie isolée, à l’état courant', () => {
  it('la commande part dans la COPIE, jamais dans le dossier partagé', async () => {
    const workspace = espaceDeTravail()
    const copie = copieSurLeCommit(workspace)
    const { bus, dossiers } = busSur(workspace, copie)

    await bus.exec('verify', {}, 'conv-1')

    expect(dossiers).toEqual([copie])
    expect(dossiers).not.toContain(workspace)
  })

  it('la copie porte le travail NON COMMITTÉ : modifié, ajouté, supprimé', async () => {
    const workspace = espaceDeTravail()
    const copie = copieSurLeCommit(workspace)
    // L'état courant : un fichier modifié, un fichier tout neuf dans un dossier neuf, un supprimé.
    writeFileSync(join(workspace, 'src', 'a.ts'), 'export const a = 2 // en cours\n')
    mkdirSync(join(workspace, 'src', 'neuf'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'neuf', 'b.ts'), 'export const b = 3\n')
    rmSync(join(workspace, 'src', 'parti.ts'))
    const { bus } = busSur(workspace, copie)

    await bus.exec('verify', {}, 'conv-1')

    expect(readFileSync(join(copie, 'src', 'a.ts'), 'utf8')).toBe(
      'export const a = 2 // en cours\n'
    )
    expect(readFileSync(join(copie, 'src', 'neuf', 'b.ts'), 'utf8')).toBe('export const b = 3\n')
    expect(existsSync(join(copie, 'src', 'parti.ts'))).toBe(false)
    // Le dossier partagé n'est PAS touché : le flux va workspace → copie, jamais l'inverse.
    expect(existsSync(join(workspace, 'src', 'parti.ts'))).toBe(false)
    expect(readFileSync(join(workspace, 'src', 'a.ts'), 'utf8')).toBe(
      'export const a = 2 // en cours\n'
    )
  })

  it('sans isolation possible, le verdict le DIT au lieu de passer pour un verdict propre', async () => {
    const workspace = espaceDeTravail()
    const { bus, dossiers } = busSur(workspace, undefined)

    // `exec` enveloppe le résultat : le verdict vit dans `data`.
    const brut = (await bus.exec('verify', {}, 'conv-1')) as { data?: { output?: string } }

    expect(dossiers).toEqual([workspace])
    expect(brut.data?.output ?? '').toContain(VERIFY_SANS_ISOLATION)
  })

  it('un secret ou un dossier protégé ne part jamais dans la copie', () => {
    const gestes = gestesDeVerification(
      ['.env', 'node_modules/x.js', '../dehors.ts', 'src/a.ts'],
      'C:/ws',
      'C:/copie',
      // Seul l'espace de travail porte le fichier : la copie ne l'a pas encore.
      (chemin) => {
        const pose = chemin.split(String.fromCharCode(92)).join('/')
        return pose.endsWith('ws/src/a.ts') ? Uint8Array.from([1]) : undefined
      }
    )

    expect(gestes.filter((g) => g.action === 'copier').map((g) => g.relatif)).toEqual(['src/a.ts'])
    expect(gestes.filter((g) => g.action === 'ignorer').length).toBe(3)
  })
})
