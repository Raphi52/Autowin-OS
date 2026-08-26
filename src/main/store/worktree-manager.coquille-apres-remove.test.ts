import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorktreeManager } from './worktree-manager'
import { nettoyerRacines, roots, tempRepo } from './worktree-manager.test-helpers'

afterEach(nettoyerRacines)

/**
 * GIT REND 0 — CA NE PROUVE PAS QUE LE DOSSIER EST PARTI.
 *
 * MESURE le 2026-08-25 : deux bureaux liberes par `git worktree remove --force` (code de sortie 0)
 * ont laisse leur dossier en place — zero fichier utile, un `.git` orphelin, ~1 Mo piece. Le
 * nettoyage concluait `ok` sur le seul code de sortie, sans jamais REGARDER le disque. C'est tres
 * probablement l'origine des douze coquilles trouvees le meme jour dans ce depot.
 *
 * ET UNE COQUILLE MENT A QUI LA MESURE : un `git status` lance dedans ne repond pas « vide », git
 * remonte l'arborescence et rapporte l'etat du depot PARENT. Les douze coquilles ont ainsi paru
 * porter exactement les memes fichiers modifies — ceux de la session en cours — et cette fausse
 * lecture a ete propagee jusque dans un message de commit avant d'etre rattrapee.
 *
 * Le mensonge est reproduit au plus pres : git repond normalement PARTOUT, sauf sur
 * `worktree remove` ou il rend 0 sans rien faire. Les deux branches de la regle du cadrage sont
 * tenues — purger ce dont l'absence de valeur est demontree, ne JAMAIS toucher a ce qui porte du
 * travail.
 */
function managerDontLeRemoveMent(): { wm: WorktreeManager; racine: string } {
  const repo = tempRepo()
  const racine = mkdtempSync(join(tmpdir(), 'autowin-coquille-'))
  roots.push(racine)
  const wm = new WorktreeManager({
    baseRepo: repo,
    worktreeRoot: racine,
    tryGitFn: (dir: string, args: string[]) => {
      if (args[0] === 'worktree' && args[1] === 'remove') {
        return { code: 0, stdout: '', stderr: '' }
      }
      try {
        const stdout = execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
        return { code: 0, stdout, stderr: '' }
      } catch (erreur) {
        const e = erreur as { status?: number; stdout?: string; stderr?: string }
        return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
      }
    },
    // Le disque, LUI, repond normalement. C'est le defaut reel : git ment, le systeme de fichiers
    // aurait tres bien pu retirer le dossier — encore fallait-il REGARDER s'il etait la.
    removeDirFn: (chemin: string) => rmSync(chemin, { recursive: true, force: true })
  })
  return { wm, racine }
}

/** Vide le bureau de tout son contenu utile, en laissant `.git` — l'etat exact d'une coquille. */
function viderSaufGit(chemin: string): void {
  for (const entree of readdirSync(chemin)) {
    if (entree === '.git') continue
    rmSync(join(chemin, entree), { recursive: true, force: true })
  }
}

describe('cleanupWorktree — regarder le disque, pas le code de sortie de git', () => {
  it('git rend 0 en laissant une coquille VIDE : elle est retiree', () => {
    const { wm } = managerDontLeRemoveMent()
    const chemin = wm.acquire('sujet')
    viderSaufGit(chemin)
    expect(existsSync(chemin)).toBe(true)

    wm.discard('sujet')

    expect(existsSync(chemin)).toBe(false)
  })

  it('git rend 0 et le bureau porte du TRAVAIL : il reste INTACT', () => {
    const { wm } = managerDontLeRemoveMent()
    const chemin = wm.acquire('sujet')
    viderSaufGit(chemin)
    // L'entree qui doit faire echouer une purge trop large : un seul fichier jamais publie.
    writeFileSync(join(chemin, 'jamais-publie.ts'), 'export const precieux = 1')

    try {
      wm.discard('sujet')
    } catch {
      /* Le nettoyage peut echouer : ce qui compte est que le travail survive. */
    }

    expect(existsSync(join(chemin, 'jamais-publie.ts'))).toBe(true)
  })
})
