/**
 * conv-617 : « mes travaux en parallele se parasitent car ils utilisent pas mon systeme de bureau
 * virtuel ». Le bureau cache, le dossier WebView2 et la fiche de la TV sont tous nommes par -Id :
 * deux travaux paralleles qui prennent le meme Id partagent tout. Le lanceur doit REFUSER tant que
 * l'occupant vit, et nommer un identifiant libre.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe.skipIf(process.platform !== 'win32')('hdesk-lancer : identifiant deja pris', () => {
  it('refuse (exit 5) sans rien lancer et propose un identifiant libre', () => {
    const id = `kzcol${process.pid}`
    // Registre PROPRE au test : l'app Autowin en marche purge du registre reel toute fiche sans
    // bureau cache vivant en ~0,5 s, et le lanceur ne voyait alors plus l'occupant (exit 3).
    const registre = mkdtempSync(join(tmpdir(), 'hdesk-registre-'))
    const fiche = join(registre, `${id}.json`)
    // Occupant VIVANT : le process de test lui-meme.
    writeFileSync(
      fiche,
      JSON.stringify({
        id,
        pid: process.pid,
        travail: 'autre travail',
        conversationId: 'conv-000'
      }),
      'utf8'
    )
    try {
      const ps = join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      )
      const r = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-File',
          join(process.cwd(), 'scripts', 'hdesk-lancer.ps1'),
          '-Id',
          id,
          '-Executable',
          ps,
          '-Travail',
          'test',
          '-Conversation',
          'conv-617',
          '-Registre',
          registre
        ],
        { encoding: 'utf8', timeout: 60_000 }
      )
      expect(r.status).toBe(5)
      const sortie = JSON.parse(r.stdout.trim().split(/\r?\n/)[0])
      expect(sortie.pret).toBe(false)
      expect(sortie.conversationOccupante).toBe('conv-000')
      expect(sortie.idLibre).toContain(id)
      expect(sortie.erreur).toMatch(/deja utilise/i)
    } finally {
      rmSync(registre, { recursive: true, force: true })
    }
  }, 70_000)
})

/**
 * conv-344 (scout n°13) : le refus « occupé » ne regardait que le numéro de processus de la fiche
 * (`Get-Process -Id`). Windows RÉUTILISE ces numéros : un autre programme, ou un processus né après
 * le lancement inscrit, rendait l'identifiant « occupé » à tort. Même règle que hdesk-fermer.ps1 :
 * même exécutable ET né avant `lanceLe` + 5 s. Le lancement qui part ici est `cmd /c exit 7` : il
 * s'arrête aussitôt (exit 2), ce qui prouve qu'il a été LANCÉ au lieu d'être refusé (exit 5).
 */
describe.skipIf(process.platform !== 'win32')(
  'hdesk-lancer : numéro de processus réutilisé',
  () => {
    const cmd = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
    const lancerAvecFiche = (champs: Record<string, unknown>): number | null => {
      const id = `kzpid${process.pid}`
      const registre = mkdtempSync(join(tmpdir(), 'hdesk-registre-pid-'))
      writeFileSync(
        join(registre, `${id}.json`),
        JSON.stringify({
          id,
          pid: process.pid,
          travail: 'autre',
          conversationId: 'conv-000',
          ...champs
        }),
        'utf8'
      )
      try {
        return spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-File',
            join(process.cwd(), 'scripts', 'hdesk-lancer.ps1'),
            '-Id',
            id,
            '-Executable',
            cmd,
            '-Arguments',
            '/c exit 7',
            '-Travail',
            'test',
            '-Conversation',
            'conv-344',
            '-Registre',
            registre
          ],
          { encoding: 'utf8', timeout: 60_000 }
        ).status
      } finally {
        rmSync(registre, { recursive: true, force: true })
      }
    }

    it('le numéro désigne un AUTRE programme : pas « occupé », le lancement part', () => {
      const notepad = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe')
      expect(lancerAvecFiche({ executable: notepad, lanceLe: new Date().toISOString() })).toBe(2)
    }, 70_000)

    it('le processus est né APRÈS le lancement inscrit : pas « occupé », le lancement part', () => {
      expect(
        lancerAvecFiche({
          executable: process.execPath,
          lanceLe: '2020-01-01T00:00:00.0000000+00:00'
        })
      ).toBe(2)
    }, 70_000)

    it('jumeau : même programme, né avant le lancement inscrit → refus « occupé » (exit 5)', () => {
      expect(
        lancerAvecFiche({ executable: process.execPath, lanceLe: new Date().toISOString() })
      ).toBe(5)
    }, 70_000)
  }
)
