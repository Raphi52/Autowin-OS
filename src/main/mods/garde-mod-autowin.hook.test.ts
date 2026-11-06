import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scriptHookGardes } from '../../shared/garde-git-destructeur'
import { refusReglageProd, refusSqlAgent } from '../prod/prod-run-guard'

/**
 * GARDE DU MOD AUTOWIN (plan-387b99e7, lot 4 — reprise du lot 1). `mods/autowin` est chargé par
 * CHAQUE run (`--plugin-dir`, src/main/providers/claude.ts) et « un mod a tous les droits du CLI » :
 * un run qui l'écrit change le comportement de tous les runs suivants, sans contrôle final. Le vrai
 * script de garde PreToolUse est construit puis exécuté ici, comme le CLI le lance.
 *
 * Entrée qui ferait échouer ce test si la correction était fausse : un `Write` vers
 * `D:\SOurcees\Autowin-OS\mods\autowin\hooks\regles.js` avec AUTOWIN_HDESK_ID posé (doit être refusé),
 * et son jumeau `D:/SOurcees/Autowin-OS/mods/autowin-copie/x.js` (doit passer : un simple test de
 * préfixe de chaîne le refuserait à tort).
 */
const MOD = 'D:\\SOurcees\\Autowin-OS\\mods\\autowin'
const COPIE = 'D:\\SOurcees\\Autowin-OS\\.autowin-data\\worktrees\\abc\\agent__run-1'

function hook(entree: Record<string, unknown>, run: boolean): string {
  const script = join(mkdtempSync(join(tmpdir(), 'garde-mod-')), 'garde.mjs')
  const fabrique = scriptHookGardes as unknown as (...a: unknown[]) => string
  writeFileSync(script, fabrique(refusReglageProd, refusSqlAgent, [], MOD), 'utf8')
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Ce test tourne souvent DANS un run : sa propre variable ne doit pas fausser le cas « hors run ».
  delete env.AUTOWIN_HDESK_ID
  if (run) env.AUTOWIN_HDESK_ID = 'run-test-1'
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({ cwd: COPIE, ...entree }),
    encoding: 'utf8',
    env
  }).stdout
}
const refuse = (s: string): boolean => !!s && JSON.parse(s).hookSpecificOutput?.permissionDecision === 'deny'

describe('hook du CLI — un run n’écrit pas dans le mod Autowin du dépôt principal', () => {
  it('refuse Write/Edit/MultiEdit/NotebookEdit sous mods/autowin, quelle que soit l’écriture du chemin', () => {
    expect(refuse(hook({ tool_name: 'Write', tool_input: { file_path: `${MOD}\\hooks\\regles.js`, content: 'x' } }, true))).toBe(true)
    expect(refuse(hook({ tool_name: 'Edit', tool_input: { file_path: 'd:/sourcees/autowin-os/mods/autowin/hooks/register.js' } }, true))).toBe(true)
    expect(refuse(hook({ tool_name: 'MultiEdit', tool_input: { file_path: `${MOD}/.claude-plugin/plugin.json` } }, true))).toBe(true)
    expect(refuse(hook({ tool_name: 'NotebookEdit', tool_input: { notebook_path: `${MOD}\\x.ipynb` } }, true))).toBe(true)
    // Remontée par `..` depuis la copie de travail du run.
    expect(refuse(hook({ tool_name: 'Write', tool_input: { file_path: `${COPIE}\\..\\..\\..\\..\\mods\\autowin\\a.js` } }, true))).toBe(true)
  })

  it('refuse une commande de terminal qui écrit sous mods/autowin, en chemin Windows ou Git Bash', () => {
    expect(refuse(hook({ tool_name: 'PowerShell', tool_input: { command: `Set-Content -Path "${MOD}\\hooks\\regles.js" -Value x` } }, true))).toBe(true)
    expect(refuse(hook({ tool_name: 'Bash', tool_input: { command: 'echo x > /d/SOurcees/Autowin-OS/mods/autowin/hooks/regles.js' } }, true))).toBe(true)
    expect(refuse(hook({ tool_name: 'Bash', tool_input: { command: 'cp a.js D:/SOurcees/Autowin-OS/mods/autowin/hooks/' } }, true))).toBe(true)
    expect(refuse(hook({ tool_name: 'Monitor', tool_input: { command: 'rm -rf "D:/SOurcees/Autowin-OS/mods/autowin"' } }, true))).toBe(true)
  })

  it('le motif dit pourquoi et où écrire à la place', () => {
    const r = JSON.parse(hook({ tool_name: 'Write', tool_input: { file_path: `${MOD}\\hooks\\regles.js` } }, true))
    expect(r.hookSpecificOutput.permissionDecisionReason).toMatch(/mod Autowin/)
    expect(r.hookSpecificOutput.permissionDecisionReason).toMatch(/copie de travail/)
  })

  it('jumeaux acceptés : copie du run, dossier voisin, lecture, et agent hors run', () => {
    // La copie de travail du run a son propre mods/autowin : c'est là qu'il travaille.
    expect(hook({ tool_name: 'Write', tool_input: { file_path: `${COPIE}\\mods\\autowin\\hooks\\regles.js` } }, true)).toBe('')
    expect(hook({ tool_name: 'Edit', tool_input: { file_path: 'mods/autowin/hooks/regles.js' } }, true)).toBe('')
    // Même début de chemin, autre dossier.
    expect(hook({ tool_name: 'Write', tool_input: { file_path: 'D:/SOurcees/Autowin-OS/mods/autowin-copie/x.js' } }, true)).toBe('')
    // Lire le mod reste permis.
    expect(hook({ tool_name: 'Bash', tool_input: { command: 'cat D:/SOurcees/Autowin-OS/mods/autowin/hooks/regles.js' } }, true)).toBe('')
    expect(hook({ tool_name: 'PowerShell', tool_input: { command: `Get-Content "${MOD}\\hooks\\regles.js"` } }, true)).toBe('')
    // Hors run (pas de AUTOWIN_HDESK_ID) : la garde ne s'applique pas.
    expect(hook({ tool_name: 'Write', tool_input: { file_path: `${MOD}\\hooks\\regles.js` } }, false)).toBe('')
  })

  it('au site d’appel : la garde courante reçoit le dossier du mod chargé', () => {
    expect(readFileSync(join(__dirname, '../providers/claude.ts'), 'utf8')).toMatch(
      // `[,)]` : un argument peut suivre le dossier du mod (le fichier de rappels, conv-1457).
      /scriptHookGardes\(refusReglageProd, refusSqlAgent, basesNonProdDeclarees\(\), dossierModsAutowin[,)]/
    )
  })
})
