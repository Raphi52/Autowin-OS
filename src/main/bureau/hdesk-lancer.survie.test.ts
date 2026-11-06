/**
 * Kaizen conv-540, tour a3691bd9-88b8-4b86-bd0d-b21c34bae8f2 (2026-09-15) : ContosoV3 a ouvert sa
 * fenetre dans le bureau cache puis s'est ferme ~4 s plus tard ; hdesk-lancer.ps1 avait deja rendu
 * exit 0. Le lanceur doit signaler la mort de l'app DANS l'appel (exit 4), sans l'inscrire pour la TV.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
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
        // Un échec n'entre pas dans l'historique des lancements (conv-344, « Récents »).
        expect(existsSync(join(registre, 'historique.jsonl'))).toBe(false)
      } finally {
        rmSync(registre, { recursive: true, force: true })
      }
    }, 70_000)
  }
)

/**
 * conv-344 (scout n°12) : un navigateur lancé sans `--user-data-dir` partage le profil de la copie
 * déjà ouverte sur l'écran de l'utilisateur (deux Chrome ne peuvent pas tenir le même dossier de
 * profil). Le lanceur ajoute un profil PROPRE AU BUREAU pour chrome et brave. Edge est exclu : une
 * note du 26/09 mesure qu'un Edge à profil neuf se connecte seul au compte Microsoft de la session.
 * Aucun vrai navigateur n'est lancé : une COPIE de cmd.exe nommée chrome.exe s'arrête aussitôt
 * (exit 2) et le JSON rend les arguments réellement passés.
 */
describe.skipIf(process.platform !== 'win32')(
  'hdesk-lancer : profil séparé pour les navigateurs',
  () => {
    const lancerSous = (nom: string, args: string): Record<string, unknown> => {
      const id = `kznav${process.pid}`
      const registre = mkdtempSync(join(tmpdir(), 'hdesk-registre-nav-'))
      const dossier = mkdtempSync(join(tmpdir(), 'hdesk-faux-nav-'))
      const exe = join(dossier, nom)
      copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), exe)
      try {
        const r = spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-File',
            join(process.cwd(), 'scripts', 'hdesk-lancer.ps1'),
            '-Id',
            id,
            '-Executable',
            exe,
            '-Arguments',
            args,
            '-Travail',
            'test',
            '-Conversation',
            'conv-344',
            '-Registre',
            registre,
            '-AttenteSecondes',
            '8'
          ],
          { encoding: 'utf8', timeout: 60_000 }
        )
        const sortie = JSON.parse(
          r.stdout
            .trim()
            .split(/\r?\n/)
            .reverse()
            .find((l) => l.startsWith('{')) ?? '{}'
        ) as Record<string, unknown>
        return { ...sortie, code: r.status, registre }
      } finally {
        rmSync(registre, { recursive: true, force: true })
        rmSync(dossier, { recursive: true, force: true })
      }
    }

    it.each(['chrome.exe', 'Brave.EXE'])(
      '%s sans profil : --user-data-dir du bureau ajouté APRÈS les arguments',
      (nom) => {
        const r = lancerSous(nom, '/c exit 7')
        expect(r.code).toBe(2)
        expect(r.arguments).toBe(
          `/c exit 7 --user-data-dir="${join(String(r.registre), 'profils', `kznav${process.pid}`)}"`
        )
      },
      70_000
    )

    it('profil déjà fourni : arguments intacts', () => {
      expect(lancerSous('chrome.exe', '/c exit 7 --user-data-dir=C:\\p').arguments).toBe(
        '/c exit 7 --user-data-dir=C:\\p'
      )
    }, 70_000)

    it.each(['msedge.exe', 'cmd.exe'])(
      '%s : arguments intacts',
      (nom) => {
        expect(lancerSous(nom, '/c exit 7').arguments).toBe('/c exit 7')
      },
      70_000
    )
  }
)
