import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { win32 } from 'node:path'
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
