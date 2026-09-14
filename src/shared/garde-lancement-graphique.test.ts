import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { refusLancementGraphique, scriptHookGardeGraphique } from './garde-lancement-graphique'

// Les deux commandes REELLES qui ont ouvert Roblox Studio sur l'ecran de l'utilisateur (conv-526).
const VECU_BASH = `"/c/Program Files (x86)/Roblox/Versions/version-93202a13414c4131/RobloxStudioBeta.exe" "D:\\\\BrainRotRoyale\\\\BrainRotRoyale.rbxlx" &`
const VECU_PS = `powershell -NoProfile -Command "Start-Process -FilePath 'C:\\Program Files (x86)\\Roblox\\Versions\\version-93202a13414c4131\\RobloxStudioBeta.exe' -ArgumentList 'D:\\BrainRotRoyale\\BrainRotRoyale.rbxlx' -WindowStyle Maximized; Start-Sleep 35; 'ok'"`

describe('refusLancementGraphique', () => {
  it('refuse les deux lancements vecus de conv-526', () => {
    expect(refusLancementGraphique(VECU_BASH)).toMatch(/hdesk-lancer\.ps1/)
    expect(refusLancementGraphique(VECU_PS)).toMatch(/Start-Process/)
  })

  it('refuse les autres formes de premier plan', () => {
    for (const c of [
      'notepad.exe D:/a.txt',
      'cmd /c start "" D:/BrainRotRoyale/BrainRotRoyale.rbxlx',
      'Invoke-Item D:/x.rbxlx',
      'explorer.exe D:/BrainRotRoyale',
      '"C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe" .',
      'code .',
      // Forme PowerShell reelle de l'outil shell du CLI (preuve du 2026-09-13).
      '& "C:/Program Files/AutowinFaux/faux.exe" --preuve',
      'git status; & "C:\\Program Files (x86)\\Roblox\\Versions\\v\\RobloxStudioBeta.exe" x.rbxlx'
    ]) {
      expect(refusLancementGraphique(c), c).toBeDefined()
    }
  })

  it('laisse passer la voie cachee et les outils en ligne de commande', () => {
    for (const c of [
      `powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id roblox -Executable "C:\\Program Files (x86)\\Roblox\\Versions\\v\\RobloxStudioBeta.exe"`,
      'powershell -NoProfile -ExecutionPolicy Bypass -File tools/studio-run-cache.ps1 -Secondes 40',
      `powershell -NoProfile -File scripts/hors-ecran-capture.ps1 -Executable "C:\\Program Files (x86)\\Roblox\\Versions\\v\\RobloxStudioBeta.exe" -Output D:/tmp/x.png`,
      'git log --oneline -5',
      'npx vitest run src/shared/garde-lancement-graphique.test.ts',
      'python build.py --autotest',
      'Start-Process node -ArgumentList x.js -NoNewWindow -Wait',
      'Start-Process powershell -WindowStyle Hidden',
      'grep -n "unicode" src/main/claude.ts',
      // Faux positif vecu (conv-526, 2026-09-13) : lire le binaire n'est pas le lancer.
      'V="/c/Program Files (x86)/Roblox/Versions/v"; grep -a -o "Flip" "$V/RobloxStudioBeta.exe" | sort -u',
      'ls "/c/Program Files (x86)/Roblox/Versions/v/RobloxStudioBeta.exe"',
      'Get-Item "C:\\Program Files\\App\\app.exe" | Select Length',
      'echo "exit code"'
    ]) {
      expect(refusLancementGraphique(c), c).toBeUndefined()
    }
  })
})

describe('scriptHookGardeGraphique — le hook reel du CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'garde-graphique-'))
  const script = join(dir, 'hook.mjs')
  writeFileSync(script, scriptHookGardeGraphique(), 'utf8')
  const lancer = (command: string) =>
    spawnSync(process.execPath, [script], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf8'
    })

  it('refuse (permissionDecision deny + motif) le lancement vecu', () => {
    const r = lancer(VECU_BASH)
    expect(r.status).toBe(0)
    const sortie = JSON.parse(r.stdout)
    expect(sortie.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(sortie.hookSpecificOutput.permissionDecisionReason).toMatch(/hdesk-lancer\.ps1/)
  })

  it('laisse passer (exit 0) une commande ordinaire', () => {
    const r = lancer('git status --short')
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('')
    expect(execFileSync(process.execPath, ['--check', script]).toString()).toBe('')
  })
})

describe('cablage', () => {
  it('le CLI recoit le hook PreToolUse(Bash) et la commande run consulte le garde', async () => {
    const { readFileSync } = await import('node:fs')
    const { reglagesCliAutowin } = await import('../main/providers/claude')
    const r = reglagesCliAutowin('C:\\tmp\\garde.mjs') as {
      autoMemoryDirectory: string
      hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }
    }
    expect(r.autoMemoryDirectory).toBe('')
    expect(r.hooks.PreToolUse[0].matcher).toBe('Bash|PowerShell')
    expect(r.hooks.PreToolUse[0].hooks[0].command).toBe('node "C:/tmp/garde.mjs"')
    const claude = readFileSync(join(__dirname, '../main/providers/claude.ts'), 'utf8')
    expect(claude).toMatch(/scriptHookGardeGraphique\(\)/)
    const commands = readFileSync(join(__dirname, '../main/commands.ts'), 'utf8')
    expect(commands).toMatch(/refusLancementGraphique\(ligne\)/)
  })
})
