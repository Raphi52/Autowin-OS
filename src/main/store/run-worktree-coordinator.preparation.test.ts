import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, manager, nettoyerRacines, tempRepo } from './worktree-manager.test-helpers'
import { RunWorktreeCoordinator } from './run-worktree-coordinator'
import { preparerCopie } from '../scripts-copie-main'

afterEach(nettoyerRacines)
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

/**
 * LA PRÉPARATION ATTEINT-ELLE VRAIMENT LA COPIE D'UN AGENT ?
 *
 * Vrai dépôt git, vrai manager, vraie préparation (`scripts-copie-main.ts`), câblée comme dans
 * `os.ts` : un faux prouverait surtout que le faux est bien écrit. Ce qui est vérifié : le `.env`
 * ignoré par git arrive dans la copie, la commande déclarée tourne DANS la copie, la trace le dit —
 * et rien de tout cela pour une copie de commande (`role: 'command'`).
 */
describe('coordinateur — préparation des copies d’agent', () => {
  const scene = (
    preparer?: ConstructorParameters<typeof RunWorktreeCoordinator>[0]['preparerCopie']
  ): { c: RunWorktreeCoordinator; repo: string; persistes: Array<{ detail?: string }> } => {
    const repo = tempRepo()
    writeFileSync(join(repo, '.gitignore'), '.env\n')
    mkdirSync(join(repo, '.autowin'))
    writeFileSync(
      join(repo, '.autowin', 'scripts.json'),
      JSON.stringify({
        preparation: `node -e "require('fs').writeFileSync('prepare.txt', 'port ' + process.argv[1])" $AUTOWIN_PORT`,
        copier: ['.env', 'notes.local']
      })
    )
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'scripts de copie')
    // Ignoré par git : c'est précisément ce qu'une copie ne reçoit pas d'elle-même.
    writeFileSync(join(repo, '.env'), 'CLE_LOCALE=42\n')
    // NON ignoré : recopié, il serait commité avec le travail de l'agent. Il doit être refusé.
    writeFileSync(join(repo, 'notes.local'), 'brouillon perso\n')
    const persistes: Array<{ detail?: string }> = []
    const stateStore = {
      list: () => [],
      get: () => undefined,
      save: (e: { detail?: string }) => persistes.push(e),
      remove: () => {}
    }
    const c = new RunWorktreeCoordinator({
      manager: manager(repo) as never,
      stateStore: stateStore as never,
      preparerCopie:
        preparer ??
        (async (copie, signaler) =>
          (
            await preparerCopie(
              { depot: copie.depot, chemin: copie.chemin, nom: copie.runId },
              { auDebut: signaler }
            )
          )?.resume)
    } as never)
    return { c, repo, persistes }
  }

  it('copie d’agent : .env copié, préparation jouée DANS la copie, résultat dans la trace', async () => {
    const { c, repo, persistes } = scene()
    const copie = await c.beginAsync('run-prep', 'Agent', true, { role: 'build', task: 'x' })
    expect(copie).toBeTruthy()
    expect(readFileSync(join(copie!, '.env'), 'utf8')).toBe('CLE_LOCALE=42\n')
    expect(readFileSync(join(copie!, 'prepare.txt'), 'utf8')).toMatch(/^port \d{5}$/)
    expect(existsSync(join(repo, 'prepare.txt'))).toBe(false)
    const detail = persistes.map((p) => p.detail ?? '').join('\n')
    expect(detail).toContain('Préparation de la copie (.autowin/scripts.json)')
    expect(detail).toContain('réussie')
    expect(detail).toContain('1 fichier(s) copié(s) (.env)')
    // Un fichier non ignoré n'est PAS recopié : il partirait dans la publication.
    expect(existsSync(join(copie!, 'notes.local'))).toBe(false)
    expect(detail).toContain('NON copié(s) car non ignoré(s) par git')
    expect(detail).toContain('notes.local')
    // Ce que la préparation laisse de publiable est NOMMÉ (prepare.txt n'est pas ignoré).
    expect(detail).toMatch(
      /ATTENTION : 1 fichier\(s\) laissé\(s\) par la préparation[^\n]*\(prepare\.txt\)/
    )
  })

  it('une préparation dont les produits sont ignorés par git ne signale rien de publiable', async () => {
    const { c, repo, persistes } = scene()
    writeFileSync(join(repo, '.gitignore'), '.env\nprepare.txt\n')
    git(repo, 'add', '.gitignore')
    git(repo, 'commit', '-q', '-m', 'ignore prepare.txt')
    const copie = await c.beginAsync('run-propre', 'Agent', true, { role: 'build' })
    expect(readFileSync(join(copie!, 'prepare.txt'), 'utf8')).toMatch(/^port /)
    expect(persistes.map((p) => p.detail ?? '').join('\n')).not.toContain('ATTENTION')
  })

  it('copie de COMMANDE (run, verify, edit_file) : aucune préparation', async () => {
    const preparer = vi.fn(async () => 'ne doit pas arriver')
    const { c, persistes } = scene(preparer)
    const copie = await c.beginAsync('run-cmd', 'Commande verify', true, {
      role: 'command',
      task: 'verify'
    })
    expect(copie).toBeTruthy()
    expect(preparer).not.toHaveBeenCalled()
    expect(existsSync(join(copie!, '.env'))).toBe(false)
    expect(persistes.map((p) => p.detail ?? '').join('')).not.toContain('Préparation')
  })

  it('une préparation qui JETTE ne bloque pas le run : elle est rapportée', async () => {
    const { c, persistes } = scene(async () => {
      throw new Error('disque plein')
    })
    const copie = await c.beginAsync('run-casse', 'Agent', true, { role: 'build' })
    expect(copie).toBeTruthy()
    expect(persistes.map((p) => p.detail ?? '').join('\n')).toContain(
      'Préparation de la copie impossible : disque plein'
    )
  })

  it('pendant la préparation, la trace dit « en cours »', async () => {
    const vus: string[] = []
    const { c } = scene(async (_copie, signaler) => {
      signaler('Préparation de la copie en cours : « npm ci »…')
      vus.push(
        String(
          (c as unknown as { runs: Map<string, { detail?: string }> }).runs.get('run-vu')?.detail
        )
      )
      return 'fini'
    })
    await c.beginAsync('run-vu', 'Agent', true, { role: 'build' })
    // L'avertissement habituel (notes.local non committé dans le dépôt) reste en tête, le
    // « en cours » s'y ajoute : l'un n'efface pas l'autre.
    expect(vus).toHaveLength(1)
    expect(vus[0]).toMatch(/notes\.local[\s\S]*\nPréparation de la copie en cours : « npm ci »…$/)
  })
})
