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
    expect(motif).toMatch(/revert --abort/)
    expect(motif).toMatch(/git show HEAD:<chemin> > \/tmp\//)
    expect(motif).not.toMatch(/git stash/)
  })

  it('refuse aussi la forme enchainee et le retablissement de tout l arbre', () => {
    expect(refusGitDestructeur('git revert --abort ; git reset --hard HEAD')).toBeTruthy()
    expect(refusGitDestructeur('git checkout -- .')).toBeTruthy()
    expect(refusGitDestructeur('git clean -fd')).toBeTruthy()
  })

  it('refuse git stash (toutes formes mutantes) et recommande git show HEAD:chemin > /tmp', () => {
    for (const c of ['git stash', 'git stash push -u', 'git stash pop', 'git stash drop', 'git stash clear', 'git -C D:/AutoWinOS stash save x', 'git status && git stash']) {
      const m = refusGitDestructeur(c)
      expect(m, c).toBeTruthy()
      expect(m).toMatch(/git show HEAD:<chemin> > \/tmp\//)
    }
    expect(refusGitDestructeur('git stash list')).toBeUndefined()
    expect(refusGitDestructeur('git stash show -p')).toBeUndefined()
  })

  it('laisse passer les voies de secours et les lectures', () => {
    expect(refusGitDestructeur('git revert --abort')).toBeUndefined()
    expect(refusGitDestructeur('git checkout HEAD -- src/main/orchestrator.ts')).toBeUndefined()
    expect(refusGitDestructeur('git restore src/main/commands.ts')).toBeUndefined()
    expect(refusGitDestructeur('git status --short')).toBeUndefined()
    expect(refusGitDestructeur('git clean -n')).toBeUndefined()
    expect(refusGitDestructeur('git log -S "reset --hard"')).toBeUndefined()
  })

  // conv-770, 2026-09-28 : la ligne etait coupee sur `|` `;` MEME ENTRE GUILLEMETS. Un grep dont le
  // motif nommait `git stash` a ete refuse pendant la maintenance du jour. Seul un APPEL est refuse.
  it.each([
    "grep -o 'x\\|git stash [a-z]\\+' trace.jsonl",
    'git commit -m "fix; git reset --hard n est plus propose"',
    'echo "git clean -fd"',
    'rg -n "git checkout -- ." docs',
    'git log --grep "stash|reset --hard"',
    "Select-String -Pattern 'git stash drop' notes.md",
    "echo '$(git stash)'"
  ])('laisse passer une simple MENTION : %s', (c) => {
    expect(refusGitDestructeur(c)).toBeUndefined()
  })

  it.each([
    'bash -c "cd repo; git reset --hard"',
    'bash -c "git reset --hard"',
    'cmd /c git clean -fd',
    'powershell -NoProfile -Command "git stash"',
    'echo "$(git stash pop)"',
    'echo `git checkout .`',
    'sudo git reset --hard',
    'sudo -i git reset --hard',
    'GIT_DIR=.git git stash drop',
    '"C:\\Program Files\\Git\\bin\\git.exe" reset --hard',
    '& git checkout .',
    'cd repo && git clean -fdx',
    'find . -name x | xargs git checkout .',
    'Start-Process git -ArgumentList "stash"',
    'git stash push -m "guillemet non ferme'
  ])('refuse toujours un APPEL : %s', (c) => {
    expect(refusGitDestructeur(c)).toBeTruthy()
  })

  it('est cable aux DEUX points d execution : le hook du CLI et la commande run interne', () => {
    const src = (p: string) => readFileSync(join(__dirname, p), 'utf8')
    expect(src('./garde-git-destructeur.ts')).toMatch(/scriptHookGardes/)
    // La commande run lit la ligne SANS le texte de ses heredocs (rejeu du 2026-10-01, heredocs.ts).
    expect(src('../main/commands.ts')).toMatch(/const shell = sansHeredocsDeDonnees\(ligne\)/)
    expect(src('../main/commands.ts')).toMatch(/refusGitDestructeur\(shell\)/)
  })
})

describe('hook reel du CLI', () => {
  it('rend un refus deny pour git reset --hard', async () => {
    const { execFileSync, spawnSync } = await import('node:child_process')
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { scriptHookGardes } = await import('./garde-git-destructeur')
    const script = join(mkdtempSync(join(tmpdir(), 'garde-git-')), 'garde.mjs')
    writeFileSync(script, scriptHookGardes(() => undefined), 'utf8')
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
    // La lecture « comme un shell » (fonctions internes) survit a la serialisation dans le script :
    // une MENTION passe, un APPEL cache derriere `bash -c` est refuse (conv-770, 2026-09-28).
    const passe = (commande: string): string =>
      spawnSync(process.execPath, [script], {
        input: JSON.stringify({ tool_input: { command: commande } }),
        encoding: 'utf8'
      }).stdout
    expect(passe("grep -o 'x\\|git stash [a-z]\\+' trace.jsonl")).toBe('')
    expect(
      JSON.parse(passe('bash -c "git reset --hard"')).hookSpecificOutput.permissionDecision
    ).toBe('deny')
    // Demande conv-114 : rien de créé que l'utilisateur ne pourrait supprimer dans le Task Manager.
    const tache = JSON.parse(passe('schtasks /create /tn X /tr notepad.exe /sc daily'))
    expect(tache.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(tache.hookSpecificOutput.permissionDecisionReason).toMatch(/task_create/)
    expect(passe('schtasks /query /fo list')).toBe('')
  })
})
