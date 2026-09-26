import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scriptHookGardes } from '../shared/garde-git-destructeur'
import * as garde from './prod-run-guard'

/**
 * LES AGENTS LANCÉS PAR `orchestrate` FACE AU SQL DE PRODUCTION (revue conv-738, 2026-09-21).
 * Leur terminal ne passe ni par `run` ni par `sql_query` : seul le hook PreToolUse du CLI les voit.
 * Il ne peut pas ouvrir la fenêtre de confirmation, donc une base prod OU inconnue est refusée net ;
 * seules les bases déclarées `non-prod` dans la liste d'autorité passent.
 */
function hook(commande: string, basesNonProd: string[] = ['Formation']): string {
  const g = garde as unknown as Record<string, unknown>
  const script = join(mkdtempSync(join(tmpdir(), 'garde-sql-')), 'garde.mjs')
  const fabrique = scriptHookGardes as unknown as (...a: unknown[]) => string
  writeFileSync(script, fabrique(g.refusReglageProd, g.refusSqlAgent, basesNonProd), 'utf8')
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: commande } }),
    encoding: 'utf8'
  }).stdout
}
const refuse = (s: string) => s !== '' && JSON.parse(s).hookSpecificOutput.permissionDecision === 'deny'

describe('hook des agents — SQL vers la production', () => {
  it.each([
    'sqlcmd -S srv-prod -d Ventes -Q "DELETE FROM clients"',
    'SQLCMD.EXE -S srv-prod -Q "select 1"',
    'osql -S srv -d Greffe75 -Q "update t set a=1"',
    'bcp Greffe75.dbo.t out x.dat -S srv',
    'powershell -c "Invoke-Sqlcmd -ServerInstance srv -Database Greffe75 -Query \'delete t\'"',
    'Invoke-Sqlcmd -ServerInstance srv -Query "select 1"'
  ])('refuse %s (base prod ou inconnue)', (c) => {
    expect(refuse(hook(c))).toBe(true)
  })
  it('laisse passer une base déclarée non-prod', () => {
    expect(hook('sqlcmd -S srv -d Formation -Q "select 1"')).toBe('')
    expect(hook('Invoke-Sqlcmd -ServerInstance srv -Database formation -Query "select 1"')).toBe('')
  })
  it('laisse passer ce qui n’est pas un client SQL', () => {
    expect(hook('git status')).toBe('')
    expect(hook('npm run sqlcmd-docs')).toBe('')
  })

  // conv-770, 2026-09-26 : le motif appliqué à TOUTE la ligne bloquait deux fois une simple lecture
  // (un grep dont le motif nommait un client SQL). Seul un APPEL doit être bloqué.
  it.each([
    'grep -c "sqlcmd|osql" src/main/prod-run-guard.ts',
    'git grep -n -E "sqlcmdPath" origin/main -- src',
    'rg -n osql docs',
    "Select-String -Path x.ps1 -Pattern 'Invoke-Sqlcmd'",
    'echo "on utilisera sqlcmd plus tard"',
    'powershell -c "Select-String -Pattern \'bcp\' notes.txt"'
  ])('laisse passer une simple MENTION : %s', (c) => {
    expect(hook(c)).toBe('')
  })

  it.each([
    'echo ok && sqlcmd -S srv -d Ventes -Q "select 1"',
    'cat requete.sql | osql -S srv -d Ventes',
    '"C:\\Program Files\\SQL\\SQLCMD.EXE" -S srv -Q "select 1"',
    "& 'C:\\Tools\\sqlcmd.exe' -S srv -Q 'select 1'",
    'bash -c "sqlcmd -S srv -d Ventes -Q \'select 1\'"',
    'cmd /c sqlcmd -S srv -d Ventes -Q "select 1"',
    'echo "resultat : $(sqlcmd -S srv -Q \'select 1\')"',
    'X=1 sqlcmd -S srv -Q "select 1"',
    'timeout 60 sqlcmd -S srv -Q "select 1"',
    'sudo -u admin sqlcmd -S srv -Q "select 1"',
    'Start-Process sqlcmd -ArgumentList "-S srv"',
    'find . -name "*.sql" -exec sqlcmd -S srv -i {} ;',
    'Get-ChildItem *.sql | ForEach-Object { Invoke-Sqlcmd -InputFile $_ }',
    'node -e "require(\'child_process\').execSync(\'sqlcmd -S srv -Q x\')"',
    'sqlcmd -S srv -Q "guillemet non ferme'
  ])('refuse toujours un APPEL : %s', (c) => {
    expect(refuse(hook(c))).toBe(true)
  })
  it('claude.ts branche la garde SQL et la liste non-prod au site d’appel', () => {
    expect(readFileSync(join(__dirname, 'providers/claude.ts'), 'utf8')).toMatch(
      /scriptHookGardes\(refusReglageProd, refusSqlAgent, /
    )
  })
})
