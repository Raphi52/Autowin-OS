import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { refusGitDestructeur } from './garde-git-destructeur'

/**
 * Preuve du defaut d'origine : conv-587, saisie ts=1789550244094. Un `git reset --hard` de nettoyage
 * a detruit trois fichiers modifies non commites hors perimetre. Perte irreversible.
 */
describe('refusGitDestructeur', () => {
  it('refuse git reset --hard, la commande qui a detruit le travail en cours (conv-587)', () => {
    const motif = refusGitDestructeur('git reset --hard')
    expect(motif).toBeTruthy()
    expect(motif).toMatch(/revert --abort|stash/)
  })

  it('refuse aussi la forme enchainee et le retablissement de tout l arbre', () => {
    expect(refusGitDestructeur('git revert --abort ; git reset --hard HEAD')).toBeTruthy()
    expect(refusGitDestructeur('git checkout -- .')).toBeTruthy()
    expect(refusGitDestructeur('git clean -fd')).toBeTruthy()
  })

  it('laisse passer les voies de secours et les lectures', () => {
    expect(refusGitDestructeur('git revert --abort')).toBeUndefined()
    expect(refusGitDestructeur('git checkout HEAD -- src/main/orchestrator.ts')).toBeUndefined()
    expect(refusGitDestructeur('git restore src/main/commands.ts')).toBeUndefined()
    expect(refusGitDestructeur('git status --short')).toBeUndefined()
    expect(refusGitDestructeur('git clean -n')).toBeUndefined()
    expect(refusGitDestructeur('git log -S "reset --hard"')).toBeUndefined()
  })

  it('est cable aux DEUX points d execution : le hook du CLI et la commande run interne', () => {
    const src = (p: string) => readFileSync(join(__dirname, p), 'utf8')
    expect(src('./garde-lancement-graphique.ts')).toMatch(/refusGitDestructeur/)
    expect(src('../main/commands.ts')).toMatch(/refusGitDestructeur\(ligne\)/)
  })
})

describe('hook reel du CLI', () => {
  it('rend un refus deny pour git reset --hard', async () => {
    const { execFileSync, spawnSync } = await import('node:child_process')
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { scriptHookGardeGraphique } = await import('./garde-lancement-graphique')
    const script = join(mkdtempSync(join(tmpdir(), 'garde-git-')), 'garde.mjs')
    writeFileSync(script, scriptHookGardeGraphique(), 'utf8')
    expect(execFileSync(process.execPath, ['--check', script]).toString()).toBe('')
    const r = spawnSync(process.execPath, [script], {
      input: JSON.stringify({ tool_input: { command: 'git reset --hard' } }),
      encoding: 'utf8'
    })
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny')
    const ok = spawnSync(process.execPath, [script], {
      input: JSON.stringify({ tool_input: { command: 'git status --short' } }),
      encoding: 'utf8'
    })
    expect(ok.stdout).toBe('')
  })
})
