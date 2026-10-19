/**
 * Kaizen conv-540, tour a3691bd9-88b8-4b86-bd0d-b21c34bae8f2 (2026-09-15) : ContosoV3 a ouvert sa
 * fenetre dans le bureau cache puis s'est ferme ~4 s plus tard ; hdesk-lancer.ps1 avait deja rendu
 * exit 0. Le lanceur doit signaler la mort de l'app DANS l'appel (exit 4), sans l'inscrire pour la TV.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe.skipIf(process.platform !== 'win32')(
  'hdesk-lancer : une app morte apres sa fenetre',
  () => {
    it('rend exit 4, pret=false, le code de sortie, et ne l’inscrit pas', () => {
      const id = `kzmort${process.pid}`
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
          '-Arguments',
          '-NoProfile -Command "Add-Type -A System.Windows.Forms; $f=New-Object Windows.Forms.Form; $f.Show(); Start-Sleep 1; exit 5"',
          '-Travail',
          'test',
          '-Conversation',
          'conv-540',
          '-SurvieSecondes',
          '6'
        ],
        { encoding: 'utf8', timeout: 60_000 }
      )
      expect(r.status).toBe(4)
      const sortie = JSON.parse(r.stdout.trim().split(/\r?\n/)[0])
      expect(sortie.pret).toBe(false)
      expect(sortie.codeSortie).toBe(5)
      expect(sortie.erreur).toMatch(/fermee/)
      expect(existsSync(join(process.env.LOCALAPPDATA ?? '', 'autowin-hdesk', `${id}.json`))).toBe(
        false
      )
    }, 70_000)
  }
)

/**
 * conv-344 (scout n°3) : une app qui meurt AVANT d'ouvrir sa fenetre (plantage au demarrage, ou app
 * a instance unique qui passe la main a sa copie deja ouverte — sur l'ecran de l'utilisateur) faisait
 * attendre toute l'attente de fenetre (30 s par defaut) pour rendre « aucune fenetre » (exit 3), un
 * message faux. Mesure avant correctif : exit 3 en 9,2 s pour -AttenteSecondes 8.
 */
describe.skipIf(process.platform !== 'win32')(
  'hdesk-lancer : une app morte AVANT sa fenetre',
  () => {
    it('rend exit 2 tout de suite, avec son code de sortie, sans l’inscrire', () => {
      const id = `kzavant${process.pid}`
      const registre = mkdtempSync(join(tmpdir(), 'hdesk-registre-avant-'))
      try {
        const cmd = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
        const debut = Date.now()
        const r = spawnSync(
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
        )
        const duree = Date.now() - debut
        expect(r.status, r.stderr).toBe(2)
        const sortie = JSON.parse(
          r.stdout
            .trim()
            .split(/\r?\n/)
            .reverse()
            .find((l) => l.startsWith('{')) ?? '{}'
        )
        expect(sortie.pret).toBe(false)
        expect(sortie.codeSortie).toBe(7)
        expect(sortie.fenetresVisibles).toBe(0)
        expect(sortie.erreur).toMatch(/passe la main|plante au demarrage/)
        // Attente de fenetre par defaut : 30 s. Le verdict arrive bien avant.
        expect(duree).toBeLessThan(10_000)
        expect(existsSync(join(registre, `${id}.json`))).toBe(false)
      } finally {
        rmSync(registre, { recursive: true, force: true })
      }
    }, 70_000)
  }
)
