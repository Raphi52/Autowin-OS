/**
 * Kaizen conv-540, tour a3691bd9-88b8-4b86-bd0d-b21c34bae8f2 (2026-09-15) : RigV3 a ouvert sa
 * fenetre dans le bureau cache puis s'est ferme ~4 s plus tard ; hdesk-lancer.ps1 avait deja rendu
 * exit 0. Le lanceur doit signaler la mort de l'app DANS l'appel (exit 4), sans l'inscrire pour la TV.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe.skipIf(process.platform !== 'win32')('hdesk-lancer : une app morte apres sa fenetre', () => {
  it('rend exit 4, pret=false, le code de sortie, et ne l’inscrit pas', () => {
    const id = `kzmort${process.pid}`
    const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const r = spawnSync('powershell', [
      '-NoProfile', '-File', join(process.cwd(), 'scripts', 'hdesk-lancer.ps1'),
      '-Id', id, '-Executable', ps,
      '-Arguments', '-NoProfile -Command "Add-Type -A System.Windows.Forms; $f=New-Object Windows.Forms.Form; $f.Show(); Start-Sleep 1; exit 5"',
      '-Travail', 'test', '-Conversation', 'conv-540', '-SurvieSecondes', '6'
    ], { encoding: 'utf8', timeout: 60_000 })
    expect(r.status).toBe(4)
    const sortie = JSON.parse(r.stdout.trim().split(/\r?\n/)[0])
    expect(sortie.pret).toBe(false)
    expect(sortie.codeSortie).toBe(5)
    expect(sortie.erreur).toMatch(/fermee/)
    expect(existsSync(join(process.env.LOCALAPPDATA ?? '', 'autowin-hdesk', `${id}.json`))).toBe(false)
  }, 70_000)
})
