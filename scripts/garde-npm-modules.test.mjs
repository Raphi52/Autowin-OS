import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cheminWindows, cibleNpmQuiModifie, refusNpmModulesPartages } from './garde-npm-modules.mjs'

/*
 * LE HOOK DU DÉPÔT NE DÉPEND D'AUCUN SHELL — mesuré le 2026-10-22 (conv-1056), CLI 2.1.308.
 *
 * En forme shell (`node "$CLAUDE_PROJECT_DIR/scripts/garde-npm-modules.mjs"`), une session où le
 * CLI ne trouve pas Git Bash (Git installé dans AppData\Local\Programs, sans
 * CLAUDE_CODE_GIT_BASH_PATH) lance le hook dans PowerShell. `$CLAUDE_PROJECT_DIR` n'y est pas une
 * variable d'environnement : node cherche D:\scripts\garde-npm-modules.mjs, sort en 1, et le CLI
 * REFUSE chaque commande (« blocking because Git Bash wasn't found… ») — même un `git log`.
 * La forme exec (`command` + `args`) lance node SANS shell, et c'est le CLI qui remplace
 * `${CLAUDE_PROJECT_DIR}` (https://code.claude.com/docs/en/hooks, « Exec form and shell form »).
 */
const SCRIPT_DU_HOOK = ['$', '{CLAUDE_PROJECT_DIR}/scripts/garde-npm-modules.mjs'].join('')

function gardeNpmDuDepot(reglages) {
  for (const groupe of reglages?.hooks?.PreToolUse ?? []) {
    for (const hook of groupe.hooks ?? []) {
      if (JSON.stringify(hook).includes('garde-npm-modules.mjs'))
        return { matcher: groupe.matcher, hook }
    }
  }
  return undefined
}

const enFormeExec = (hook) =>
  hook?.command === 'node' &&
  Array.isArray(hook.args) &&
  hook.args.length === 1 &&
  hook.args[0] === SCRIPT_DU_HOOK

describe('.claude/settings.json — le hook du garde npm', () => {
  it('est en forme exec, sur Bash ET PowerShell', () => {
    const reglages = JSON.parse(
      readFileSync(new URL('../.claude/settings.json', import.meta.url), 'utf8')
    )
    const garde = gardeNpmDuDepot(reglages)
    expect(garde?.matcher).toBe('Bash|PowerShell')
    expect(enFormeExec(garde?.hook), JSON.stringify(garde?.hook)).toBe(true)
  })

  it("refuse l'ancienne forme shell, cassée quand Git Bash est introuvable", () => {
    const ancienne = {
      type: 'command',
      command: 'node "$CLAUDE_PROJECT_DIR/scripts/garde-npm-modules.mjs"'
    }
    expect(enFormeExec(ancienne)).toBe(false)
  })
})

const resoudre = (base, rel) => win32.resolve(cheminWindows(base), cheminWindows(rel))
const cible = (cmd, cwd = 'D:/Autowin') => cibleNpmQuiModifie(cmd, cwd, resoudre)?.split('\\').join('/')

describe('cibleNpmQuiModifie', () => {
  it('repère les commandes qui réécrivent node_modules (cas réel du 2026-10-05 compris)', () => {
    expect(cible('cd /d/Autowin; npm install --no-audit --no-fund 2>&1 | tail -5')).toBe('D:/Autowin')
    for (const c of ['npm ci', 'npm i -D zod', 'npm uninstall zod', 'npm rebuild', 'npm prune', 'npm.cmd install', 'npm --prefix . update']) {
      expect(cible(c), c).toBe('D:/Autowin')
    }
  })

  it('laisse passer ce qui ne touche pas node_modules', () => {
    for (const c of ['npm run dev', 'npm run typecheck && npm test', 'npm ls --all', 'npx vitest run', 'npm -v', 'echo npm install', 'npm install -g pnpm', 'npm i --location=global x']) {
      expect(cible(c), c).toBeUndefined()
    }
  })

  it('suit cd, Set-Location et --prefix', () => {
    expect(cible('cd /c/tmp/tk && npm install x')).toBe('C:/tmp/tk')
    expect(cible('Set-Location -LiteralPath "C:\\tmp\\tk"; npm install x', 'D:/Autowin')).toBe('C:/tmp/tk')
    expect(cible('npm install --prefix /c/autre x')).toBe('C:/autre')
    expect(cible('npm --prefix=../voisin ci')).toBe('D:/voisin')
  })

  it("un cd vers une variable rend le dossier inconnu : pas de faux refus (cas réel du 2026-10-05)", () => {
    expect(cible('$t="C:\\x\\npmtest2"; cd $t; npm install --no-save')).toBeUndefined()
    expect(cible('cd %TEMP% && npm install')).toBeUndefined()
    expect(cible('cd $t; npm install --prefix D:/Autowin')).toBe('D:/Autowin')
    expect(cible('cd $t; cd /d/Autowin; npm ci')).toBe('D:/Autowin')
  })
})

describe('refusNpmModulesPartages', () => {
  const sonde = (verrou) => ({
    resoudre,
    modulesReels: (d) => (/^D:[\\/]Autowin/.test(d) ? 'D:/Autowin/node_modules' : undefined),
    verrouille: (p) => verrou && /^D:[\\/]Autowin[\\/]node_modules[\\/]electron[\\/]dist[\\/]electron\.exe$/.test(p)
  })

  it('refuse npm install quand electron.exe du node_modules visé est verrouillé', () => {
    const motif = refusNpmModulesPartages('npm install', 'D:/Autowin', sonde(true))
    expect(motif).toMatch(/Refusé/)
    expect(motif).toMatch(/EBUSY/)
  })

  it("refuse aussi quand l'app tourne sur l'EXE DE DEV (conv-266) : electron.exe d'npm est libre, ses DLL non", () => {
    const seulExeDev = {
      ...sonde(false),
      verrouille: (p) => /^D:[\\/]Autowin[\\/]\.autowin-data[\\/]electron-dev[\\/]electron\.exe$/.test(p)
    }
    expect(refusNpmModulesPartages('npm install', 'D:/Autowin', seulExeDev)).toMatch(/Refusé/)
  })

  it("laisse passer quand l'app ne tourne pas, ou hors du dépôt", () => {
    expect(refusNpmModulesPartages('npm install', 'D:/Autowin', sonde(false))).toBeUndefined()
    expect(refusNpmModulesPartages('cd /c/tmp/tk && npm install x', 'D:/Autowin', sonde(true))).toBeUndefined()
    expect(refusNpmModulesPartages('npm run dev', 'D:/Autowin', sonde(true))).toBeUndefined()
  })
})

/*
 * LE SCRIPT TEL QUE GROK ET CODEX LE LANCENT : l'entrée de leur contrôle « avant commande » sur
 * stdin, le refus lu sur stdout. Les deux acceptent la forme de refus de Claude
 * (`hookSpecificOutput.permissionDecision`) : Grok, 10-hooks.md ligne 413 ; Codex,
 * https://learn.chatgpt.com/docs/hooks.
 */
const SCRIPT = fileURLToPath(new URL('./garde-npm-modules.mjs', import.meta.url))

/** Entrée RÉELLE de Grok (run_terminal_command), tracée le 2026-11-06 : camelCase ET alias snake_case. */
const grokReel = (cwd, command) => ({
  hookEventName: 'pre_tool_use',
  sessionId: 's-1',
  cwd,
  workspaceRoot: cwd,
  permissionMode: 'bypassPermissions',
  toolName: 'run_terminal_command',
  toolUseId: 'call-1',
  toolInput: { command, description: 'Run the requested command' },
  toolInputTruncated: false,
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  permission_mode: 'bypassPermissions',
  tool_name: 'run_terminal_command',
  tool_input: { command, description: 'Run the requested command' },
  tool_use_id: 'call-1'
})
/** L'exemple de la doc de Grok (10-hooks.md, lignes 384-395) : clés camelCase SEULES. */
const grokDoc = (cwd, command) => ({
  hookEventName: 'pre_tool_use',
  hook_event_name: 'PreToolUse',
  sessionId: 'abc-123',
  cwd,
  workspaceRoot: cwd,
  permissionMode: 'default',
  toolName: 'run_terminal_command',
  toolInput: { command },
  timestamp: '2026-04-14T12:00:00Z'
})
/** Codex (https://learn.chatgpt.com/docs/hooks) : `tool_input.command`, outil `Bash`. */
const codex = (cwd, command) => ({
  session_id: 's-1',
  turn_id: 't-1',
  transcript_path: null,
  cwd,
  hook_event_name: 'PreToolUse',
  model: 'gpt-5.6-terra',
  permission_mode: 'bypassPermissions',
  tool_name: 'Bash',
  tool_use_id: 'call-1',
  tool_input: { command }
})
const FORMATS = {
  'Grok (entrée réelle)': grokReel,
  'Grok (exemple de la doc)': grokDoc,
  Codex: codex
}

describe.skipIf(process.platform !== 'win32')(
  'le script, lancé comme Grok et Codex le lancent',
  () => {
    // Un faux dépôt dont l'« electron.exe » TOURNE : un programme lancé ne s'ouvre pas en écriture,
    // c'est la condition exacte de l'EBUSY de npm que la garde sonde.
    let depot
    let electron
    beforeAll(async () => {
      depot = mkdtempSync(join(tmpdir(), 'garde-npm-cli-'))
      writeFileSync(join(depot, 'package.json'), '{}')
      const dist = join(depot, 'node_modules', 'electron', 'dist')
      mkdirSync(dist, { recursive: true })
      const exe = join(dist, 'electron.exe')
      copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'PING.EXE'), exe)
      electron = spawn(exe, ['-n', '120', '127.0.0.1'], { stdio: 'ignore', windowsHide: true })
      for (let i = 0; i < 50; i++) {
        try {
          closeSync(openSync(exe, 'r+'))
        } catch {
          return
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error("le faux electron.exe ne s'est pas verrouillé")
    })
    afterAll(async () => {
      if (electron && electron.exitCode === null) {
        electron.kill()
        await once(electron, 'exit')
      }
      rmSync(depot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    })

    const lancer = (entree) =>
      spawnSync(process.execPath, [SCRIPT], {
        input: `${JSON.stringify(entree)}\n`,
        encoding: 'utf8',
        timeout: 20_000
      })

    for (const [nom, entree] of Object.entries(FORMATS)) {
      it(`${nom} : npm install est refusé`, () => {
        const r = lancer(entree(depot, 'npm install'))
        expect(r.status).toBe(0)
        const sortie = JSON.parse(r.stdout || '{}')
        expect(sortie.hookSpecificOutput?.permissionDecision, r.stdout).toBe('deny')
        expect(sortie.hookSpecificOutput?.permissionDecisionReason).toMatch(/EBUSY/)
      })

      it(`${nom} : une commande sans npm passe, en silence`, () => {
        const r = lancer(entree(depot, 'git status'))
        expect(r.status).toBe(0)
        expect(r.stdout).toBe('')
      })
    }
  }
)
