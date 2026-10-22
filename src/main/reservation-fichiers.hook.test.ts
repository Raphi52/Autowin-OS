import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scriptHookGardes } from '../shared/garde-git-destructeur'
import { refusReglageProd } from './prod-run-guard'

/*
 * LE VRAI SCRIPT DU HOOK REFUSE L'ÉDITION D'UN FICHIER RÉSERVÉ PAR UN AUTRE FIL (conv-1083).
 *
 * Deux lancements d'agent = deux dossiers de réglages, chacun avec son `reservation.json` (le fil
 * qui écrit) ; un seul registre partagé. Entrée qui ferait échouer ce banc si le branchement était
 * faux : `Edit` de conv-B sur le fichier que conv-A vient d'éditer, hors dépôt git (état inconnu)
 * → refus qui nomme conv-A.
 */
const dossiers: string[] = []
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

function banc() {
  const racine = mkdtempSync(join(tmpdir(), 'reservation-hook-'))
  dossiers.push(racine)
  const registre = join(racine, 'reservations.json')
  const lancement = (fil?: string) => {
    const dossier = mkdtempSync(join(racine, 'lancement-'))
    const script = join(dossier, 'garde.mjs')
    writeFileSync(script, scriptHookGardes(refusReglageProd), 'utf8')
    if (fil)
      writeFileSync(join(dossier, 'reservation.json'), JSON.stringify({ fil, registre }), 'utf8')
    return (entree: unknown): string =>
      spawnSync(process.execPath, [script], { input: JSON.stringify(entree), encoding: 'utf8' })
        .stdout
  }
  const projet = join(racine, 'projet')
  mkdirSync(projet)
  return { lancement, registre, projet }
}

const refus = (sortie: string): string | undefined =>
  sortie ? JSON.parse(sortie).hookSpecificOutput?.permissionDecisionReason : undefined

describe('hook du CLI — réservation des fichiers entre fils', () => {
  it('conv-A édite, conv-B est refusée sur le MÊME fichier en nommant conv-A', () => {
    const { lancement, projet } = banc()
    const a = lancement('conv-A')
    const b = lancement('conv-B')
    const x = join(projet, 'x.ts')
    expect(
      a({ tool_name: 'Edit', tool_input: { file_path: x, old_string: 'a', new_string: 'b' } })
    ).toBe('')
    expect(refus(b({ tool_name: 'Write', tool_input: { file_path: x, content: 'z' } }))).toMatch(
      /conv-A/
    )
    expect(refus(b({ tool_name: 'MultiEdit', tool_input: { file_path: x, edits: [] } }))).toMatch(
      /conv-A/
    )
  })

  it('jumeaux acceptés : autre fichier, simple lecture, ou le fil propriétaire lui-même', () => {
    const { lancement, projet } = banc()
    const a = lancement('conv-A')
    const b = lancement('conv-B')
    const x = join(projet, 'x.ts')
    a({ tool_name: 'Edit', tool_input: { file_path: x } })
    expect(b({ tool_name: 'Edit', tool_input: { file_path: join(projet, 'y.ts') } })).toBe('')
    expect(b({ tool_name: 'Read', tool_input: { file_path: x } })).toBe('')
    expect(a({ tool_name: 'Edit', tool_input: { file_path: x } })).toBe('')
  })

  it('le fichier commité libère la réservation : git le dit propre, conv-B le reprend', () => {
    const { lancement, projet } = banc()
    const git = (...args: string[]) =>
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
        cwd: projet,
        encoding: 'utf8'
      })
    git('init', '-q')
    const x = join(projet, 'x.ts')
    writeFileSync(x, 'a\n', 'utf8')
    lancement('conv-A')({ tool_name: 'Edit', tool_input: { file_path: x } })
    // Encore modifié (non suivi) : refus.
    expect(refus(lancement('conv-B')({ tool_name: 'Edit', tool_input: { file_path: x } }))).toMatch(
      /conv-A/
    )
    git('add', 'x.ts')
    git('commit', '-q', '-m', 'x')
    expect(lancement('conv-B')({ tool_name: 'Edit', tool_input: { file_path: x } })).toBe('')
  })

  /*
   * LE COMMIT (objection du contrôle final, 2026-10-22). Entrée qui ferait échouer ce test si le
   * branchement était faux : conv-B lance `git commit -am wip` dans le dépôt où conv-A vient
   * d'éditer x.ts (modifié, non commité) → refus qui nomme conv-A.
   */
  it('conv-B : un commit qui emporterait x.ts de conv-A est refusé en nommant conv-A ; jumeaux acceptés', () => {
    const { lancement, projet: brut } = banc()
    const projet = realpathSync.native(brut)
    const git = (...args: string[]) =>
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
        cwd: projet,
        encoding: 'utf8'
      })
    git('init', '-q')
    const x = join(projet, 'x.ts')
    writeFileSync(x, 'a\n', 'utf8')
    writeFileSync(join(projet, 'y.ts'), 'a\n', 'utf8')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    const a = lancement('conv-A')
    const b = lancement('conv-B')
    a({ tool_name: 'Edit', tool_input: { file_path: x } })
    writeFileSync(x, 'b\n', 'utf8')
    writeFileSync(join(projet, 'y.ts'), 'b\n', 'utf8')
    const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command }, cwd: projet })

    expect(refus(b(bash('git commit -am wip')))).toMatch(/conv-A/)
    expect(refus(b(bash('git add -A && git commit -m wip')))).toMatch(/conv-A/)
    // Jumeaux acceptés : ses propres chemins nommés, le propriétaire, une commande qui ne commite pas.
    expect(b(bash('git commit -m wip -- y.ts'))).toBe('')
    expect(a(bash('git commit -am wip'))).toBe('')
    expect(b(bash('git status && git diff'))).toBe('')
    // Déjà dans l'index partagé : un commit sans chemins l'emporterait.
    git('add', 'x.ts')
    expect(refus(b(bash('git commit -m wip')))).toMatch(/conv-A/)
    // conv-A commite : la réservation tombe.
    git('commit', '-q', '-m', 'travail de conv-A')
    expect(b(bash('git commit -am wip'))).toBe('')
  })

  it('un lancement sans fil connu (ancien réglage) ne réserve ni ne refuse rien', () => {
    const { lancement, registre, projet } = banc()
    const x = join(projet, 'x.ts')
    expect(lancement()({ tool_name: 'Edit', tool_input: { file_path: x } })).toBe('')
    expect(() => readFileSync(registre, 'utf8')).toThrow()
  })
})
