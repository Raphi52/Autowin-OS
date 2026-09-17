/**
 * conv-617 : « mes travaux en parallele se parasitent car ils utilisent pas mon systeme de bureau
 * virtuel ». Le bureau cache, le dossier WebView2 et la fiche de la TV sont tous nommes par -Id :
 * deux travaux paralleles qui prennent le meme Id partagent tout. Le lanceur doit REFUSER tant que
 * l'occupant vit, et nommer un identifiant libre.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe.skipIf(process.platform !== 'win32')('hdesk-lancer : identifiant deja pris', () => {
  it('refuse (exit 5) sans rien lancer et propose un identifiant libre', () => {
    const id = `kzcol${process.pid}`
    const registre = join(process.env.LOCALAPPDATA ?? '', 'autowin-hdesk')
    mkdirSync(registre, { recursive: true })
    const fiche = join(registre, `${id}.json`)
    // Occupant VIVANT : le process de test lui-meme.
    writeFileSync(fiche, JSON.stringify({ id, pid: process.pid, travail: 'autre travail', conversationId: 'conv-000' }), 'utf8')
    try {
      const ps = join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const r = spawnSync('powershell', [
        '-NoProfile', '-File', join(process.cwd(), 'scripts', 'hdesk-lancer.ps1'),
        '-Id', id, '-Executable', ps, '-Travail', 'test', '-Conversation', 'conv-617'
      ], { encoding: 'utf8', timeout: 60_000 })
      expect(r.status).toBe(5)
      const sortie = JSON.parse(r.stdout.trim().split(/\r?\n/)[0])
      expect(sortie.pret).toBe(false)
      expect(sortie.conversationOccupante).toBe('conv-000')
      expect(sortie.idLibre).toContain(id)
      expect(sortie.erreur).toMatch(/deja utilise/i)
    } finally {
      rmSync(fiche, { force: true })
    }
  }, 70_000)
})
