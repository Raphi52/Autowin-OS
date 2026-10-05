import { describe, expect, it } from 'vitest'
import { win32 } from 'node:path'
import { cheminWindows, cibleNpmQuiModifie, refusNpmModulesPartages } from './garde-npm-modules.mjs'

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

  it("laisse passer quand l'app ne tourne pas, ou hors du dépôt", () => {
    expect(refusNpmModulesPartages('npm install', 'D:/Autowin', sonde(false))).toBeUndefined()
    expect(refusNpmModulesPartages('cd /c/tmp/tk && npm install x', 'D:/Autowin', sonde(true))).toBeUndefined()
    expect(refusNpmModulesPartages('npm run dev', 'D:/Autowin', sonde(true))).toBeUndefined()
  })
})
