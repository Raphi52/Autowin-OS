/**
 * conv-1077 (2026-10-22) : 39 gels pour 103,8 s depuis le 15/10 sous l'étiquette
 * `demarrage:corps du module terminé, whenReady enregistré`, mais les jalons de `jalonDemarrage`
 * (index.ts) ne vivaient que dans `console.log` : aucun fichier ne disait, lancement par lancement,
 * QUAND chaque jalon était passé — donc où le temps s'en allait entre deux.
 * Fichier dédié : un module neuf, donc un état de démarrage neuf (vitest isole les fichiers).
 */
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cloreDemarrage, demarrerDetecteurDeGel, marquerOperation } from './gel-main'

describe('jalons du démarrage écrits sur disque (conv-1077)', () => {
  it('à la clôture : UNE ligne par lancement, jalons dans l’ordre, y compris ceux d’avant le détecteur', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jalons-demarrage-'))
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST si seuls les jalons posés après le démarrage du
    // détecteur étaient gardés : le premier jalon de index.ts part AVANT `demarrerDetecteurDeGel`.
    marquerOperation('demarrage:module principal évalué')
    const arreter = demarrerDetecteurDeGel(dir, 60_000, () => undefined, undefined, {
      retardMaxDepuisLaDerniereLecture: () => 0,
      arreter: () => undefined
    })
    try {
      marquerOperation('ipc:os:conversations')
      marquerOperation('demarrage:app.whenReady')
      cloreDemarrage()
      // Après la clôture : ni jalon de plus, ni seconde ligne.
      marquerOperation('demarrage:ready-to-show')
      cloreDemarrage()
      const fichier = join(dir, 'demarrages.jsonl')
      await vi.waitFor(() => expect(existsSync(fichier)).toBe(true))
      await new Promise((r) => setTimeout(r, 50))
      const lignes = readFileSync(fichier, 'utf8').trim().split(/\r?\n/)
      expect(lignes).toHaveLength(1)
      const lancement = JSON.parse(lignes[0] as string) as {
        ts: string
        pid: number
        jalons: Array<{ etape: string; ms: number }>
      }
      expect(lancement.pid).toBe(process.pid)
      expect(Number.isNaN(Date.parse(lancement.ts))).toBe(false)
      expect(lancement.jalons.map((j) => j.etape)).toEqual([
        'module principal évalué',
        'app.whenReady'
      ])
      // `ms` = depuis le lancement du PROCESSUS : il inclut ce qui précède l'évaluation de index.ts.
      const [a, b] = lancement.jalons
      expect(a!.ms).toBeGreaterThan(0)
      expect(b!.ms).toBeGreaterThanOrEqual(a!.ms)
    } finally {
      arreter()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
