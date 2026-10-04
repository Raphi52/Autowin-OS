import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
// @ts-expect-error module .mjs du mod, sans déclaration de types
import { redirigerVersBureauCache, descriptionOutilTerminal } from '../../mods/autowin/hooks/logique.mjs'
import { dossierModAutowin } from '../main/providers/claude'

const ctx = { conversation: 'conv-58', scriptLanceur: 'D:/Autowin/scripts/hdesk-lancer.ps1' }
const r = (c: string): string | undefined => redirigerVersBureauCache(c, ctx)

describe('mod Autowin — point 1 : redirection vers le bureau caché', () => {
  it.each([
    ['notepad C:/x.txt', "Get-Command 'notepad'"],
    ['Start-Process notepad -ArgumentList C:/x.txt', "Get-Command 'notepad'"],
    ['Start-Process -FilePath "C:\\Program Files\\App\\app.exe"', "'C:\\Program Files\\App\\app.exe'"],
    ['& "C:\\Users\\U\\AppData\\Local\\Programs\\Code\\Code.exe" .', 'Code.exe'],
    ['msedge https://example.com', "Get-Command 'msedge'"]
  ])('réécrit %s', (c, attendu) => {
    const s = r(c)!
    expect(s).toMatch(/^powershell -NoProfile -Command "& 'D:\/Autowin\/scripts\/hdesk-lancer\.ps1' -Id 'chat-conv-58'/)
    expect(s).toContain(attendu)
    expect(s).toContain("-Conversation 'conv-58'")
  })
  it('passe les arguments', () => {
    expect(r('notepad C:/x.txt')).toContain("-Arguments 'C:/x.txt'")
  })
  it.each([
    'notepad C:/x.txt # ecran-utilisateur',
    'git status',
    'npm test',
    'notepad a.txt; echo fin',
    'Start-Process notepad -WindowStyle Hidden',
    'Start-Process notepad -Wait',
    'powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id x -Executable notepad',
    'cat "C:\\Program Files\\App\\app.exe"'
  ])('laisse intact %s', (c) => expect(r(c)).toBeUndefined())
  it('sans conversation connue, ne réécrit rien', () => {
    expect(redirigerVersBureauCache('notepad', { conversation: '', scriptLanceur: 'x' })).toBeUndefined()
  })
})

describe('mod Autowin — points 2 et 3 : description des outils terminal', () => {
  const bash =
    '- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. With it…'
  it('corrige la promesse fausse sur les tâches de fond', () => {
    const d = descriptionOutilTerminal(bash)
    expect(d).not.toContain('keeps running across turns')
    expect(d).toContain('STOPPED when the current turn ends')
  })
  it('ajoute les règles bureau caché, marqueur et arrêt par nom', () => {
    const d = descriptionOutilTerminal('x')
    expect(d).toContain('hdesk-lancer.ps1')
    expect(d).toContain('# ecran-utilisateur')
    expect(d).toContain('taskkill /IM')
  })
})

describe('dossierModAutowin', () => {
  it('trouve mods/autowin en remontant depuis out/main/chunks', () => {
    const racine = join('D:', 'Autowin')
    const vise = join(racine, 'mods', 'autowin', '.claude-plugin', 'plugin.json')
    expect(dossierModAutowin([join(racine, 'out', 'main', 'chunks')], (p) => p === vise)).toBe(
      join(racine, 'mods', 'autowin')
    )
  })
  it('rend undefined sans mod', () => {
    expect(dossierModAutowin([join('D:', 'ailleurs')], () => false)).toBeUndefined()
  })
  it('trouve le vrai mod du dépôt', () => {
    expect(dossierModAutowin([__dirname])).toBe(join(__dirname, '..', '..', 'mods', 'autowin'))
  })
})
