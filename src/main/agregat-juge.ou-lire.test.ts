import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AGGREGATE_MAX_CHARS } from './evidence-digest'
import { agregerPhasesPourLeJuge, MARQUE_TRONQUE } from './agregat-juge'
import {
  cheminDuLivrableEntier,
  DOSSIER_LIVRABLES,
  ecrireLivrableEntier,
  RETENTION_LIVRABLE_MS
} from './runs/livrable-entier'

/**
 * LA MARQUE DE COUPE DU JUGE NOMME UNE COPIE ENTIERE QUI EXISTE (conv-989, 2026-10-16).
 *
 * Avant : « voir le fil des sous-agents », soit `trace.json`, plafonne a 4 000 caracteres par etape —
 * plus court que les 6 000 que le juge lisait deja. La seule copie entiere (`run-state`) etait
 * effacee a la cloture du run. Le juge ne pouvait pas lire la fin d'une etape longue.
 */
let racines: string[] = []
afterEach(() => {
  for (const racine of racines) rmSync(racine, { recursive: true, force: true })
  racines = []
})
const racine = (): string => {
  const r = mkdtempSync(join(tmpdir(), 'livrable-'))
  racines.push(r)
  return r
}
const CAP = 6000
const long = (lettre: string, n: number): string => `${lettre.repeat(n)}\nFIN-${lettre}`

describe('la marque de coupe du juge nomme la copie entière', () => {
  it('une étape coupée dit OÙ lire sa sortie entière', () => {
    const chemin = 'C:/donnees/run-livrables/run-abc-1.md'
    const agregat = agregerPhasesPourLeJuge(
      [
        { phase: 'scout', text: long('s', 20_000) },
        { phase: 'build', text: 'court' }
      ],
      CAP,
      AGGREGATE_MAX_CHARS,
      chemin
    )
    expect(agregat).toContain(chemin)
    expect(agregat).not.toContain('voir le fil des sous-agents')
    // Le plafond total tient toujours, marque comprise.
    expect(agregat.length).toBeLessThanOrEqual(AGGREGATE_MAX_CHARS)
    // La fin de l'étape reste lue (début ET fin gardés, comme avant).
    expect(agregat).toContain('FIN-s')
  })

  it('beaucoup d’étapes longues : jamais au-delà du plafond total, même avec un long chemin', () => {
    const chemin = `C:/${'d'.repeat(200)}/run-livrables/run-long-1.md`
    const sorties = Array.from({ length: 14 }, (_, i) => ({
      phase: `build`,
      text: long(String(i % 10), 9_000)
    }))
    const agregat = agregerPhasesPourLeJuge(sorties, CAP, AGGREGATE_MAX_CHARS, chemin)
    expect(agregat.length).toBeLessThanOrEqual(AGGREGATE_MAX_CHARS)
    expect(agregat.split(chemin).length - 1).toBe(14)
  })

  it('sans chemin connu, la marque d’avant est gardée telle quelle', () => {
    const agregat = agregerPhasesPourLeJuge([{ phase: 'scout', text: long('s', 20_000) }], CAP)
    expect(agregat).toContain(MARQUE_TRONQUE)
  })
})

describe('la copie entière des sorties d’étapes', () => {
  it('garde chaque étape EN ENTIER, dans l’ordre, sous le chemin que nomme la marque', async () => {
    const base = racine()
    const sorties = [
      { phase: 'scout', text: long('s', 20_000) },
      { phase: 'build', text: long('b', 15_000) }
    ]
    await ecrireLivrableEntier('run-abc-1', sorties, base)
    const texte = readFileSync(cheminDuLivrableEntier('run-abc-1', base), 'utf8')
    expect(texte).toContain('FIN-s')
    expect(texte).toContain('FIN-b')
    expect(texte.indexOf('étape scout')).toBeLessThan(texte.indexOf('étape build'))
    expect(texte.length).toBeGreaterThan(35_000)
  })

  it('n’écrit rien pour un run sans sortie, et purge les copies de plus de 30 jours', async () => {
    const base = racine()
    await ecrireLivrableEntier('run-vide-1', [{ phase: 'scout', text: '  ' }], base)
    expect(existsSync(cheminDuLivrableEntier('run-vide-1', base))).toBe(false)

    await ecrireLivrableEntier('run-ancien-1', [{ phase: 'scout', text: 'vieux' }], base)
    const ancien = cheminDuLivrableEntier('run-ancien-1', base)
    const ilYA = (Date.now() - RETENTION_LIVRABLE_MS - 60_000) / 1000
    utimesSync(ancien, ilYA, ilYA)
    writeFileSync(join(base, DOSSIER_LIVRABLES, 'note.txt'), 'pas un livrable')
    await ecrireLivrableEntier('run-neuf-1', [{ phase: 'scout', text: 'neuf' }], base)
    expect(existsSync(ancien)).toBe(false)
    expect(existsSync(cheminDuLivrableEntier('run-neuf-1', base))).toBe(true)
    expect(existsSync(join(base, DOSSIER_LIVRABLES, 'note.txt'))).toBe(true)
  })

  it('un identifiant de run ne sort jamais de son dossier', () => {
    const chemin = cheminDuLivrableEntier('../../etc/passwd', 'C:/base')
    expect(chemin.replace(/\\/g, '/')).toMatch(/^C:\/base\/run-livrables\/[^/]+\.md$/)
  })
})

describe('le bilan d’une étape coupée reste entier dans l’agrégat du juge', () => {
  const BILAN =
    '### Bilan de l’étape\n- Verdict : fait\n- Fichiers touchés : src/a.ts\n- Preuves : npx vitest run src/a.test.ts → 0\n- Reste à faire : aucun reste'
  it('beaucoup d’étapes longues : la part de chacune est petite, son bilan final passe quand même en entier', () => {
    // 20 étapes de 9 000 caractères (un run réparé plusieurs fois) : ~2 900 caractères par étape,
    // dont ~960 de fin gardée — moins que ce bilan. La coupe début+fin le perdait.
    const bilanLong = `${BILAN}\n- Détail : ${'d'.repeat(1_000)}`
    const sorties = Array.from({ length: 20 }, (_, i) => ({
      phase: 'build',
      text: `${String(i % 10).repeat(9_000)}\n${bilanLong}\nAUTOWIN_PARI_V1: {"confiance":0.7}`
    }))
    const agregat = agregerPhasesPourLeJuge(sorties, CAP)
    expect(agregat).toContain(MARQUE_TRONQUE)
    expect(agregat.split(bilanLong).length - 1).toBe(20)
    expect(agregat.length).toBeLessThanOrEqual(AGGREGATE_MAX_CHARS)
  })

  it('une étape qui tient dans sa part est rendue telle quelle, sans réordonner son bilan', () => {
    const texte = `court\n${BILAN}\nAUTOWIN_PARI_V1: {"confiance":0.7}`
    const agregat = agregerPhasesPourLeJuge(
      [
        { phase: 'frame', text: texte },
        { phase: 'build', text: 'ok' }
      ],
      CAP
    )
    expect(agregat).toContain(texte)
  })
})
