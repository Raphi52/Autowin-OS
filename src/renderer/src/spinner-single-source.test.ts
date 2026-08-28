import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname)

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(SRC)

describe('spinner — source unique', () => {
  it('aucun fichier CSS hors theme.css ne redéfinit un spinner', () => {
    const offenders: string[] = []
    for (const f of files.filter((f) => f.endsWith('.css') && !f.endsWith('theme.css'))) {
      const css = readFileSync(f, 'utf8')
      for (const m of css.matchAll(/^\s*\.([a-zA-Z0-9_-]*spinner[a-zA-Z0-9_-]*)/gm)) {
        offenders.push(`${f}: .${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('tous les spinners du JSX utilisent la classe partagée .spinner', () => {
    const bad: string[] = []
    for (const f of files.filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/className="([^"]*spinner[^"]*)"/g)) {
        const cls = m[1].trim()
        if (cls !== 'spinner' && cls !== 'spinner spinner--lg') bad.push(`${f}: "${cls}"`)
      }
    }
    expect(bad).toEqual([])
  })

  it('theme.css expose la variante large', () => {
    const theme = readFileSync(join(SRC, 'assets', 'theme.css'), 'utf8')
    expect(theme).toMatch(/\.spinner--lg\s*\{/)
  })

  /**
   * GREFFE — exigence recuperee de trois bureaux non fusionnes du 2026-08-28
   * (run-4b878d41753f-1, run-59624aa4eeee-1, run-9d66e3788edf-1).
   *
   * Ces bureaux decrivaient une AUTRE implementation de l'atome (orbites inclinees pilotees par
   * une @property angulaire), superseded par celle qui est en base : leur fichier de test entier
   * echoue ici (5 cas sur 6), le fusionner aurait regresse theme.css. Mais ils documentaient un
   * defaut VU en usage reel — le « rendu carre deglingue » — qu'aucun test de la base ne verrouille.
   * Seule cette exigence est transposee, portee sur la nomenclature actuelle.
   */
  it('la forme reste ronde et ne repose sur aucune technique fragile', () => {
    const theme = readFileSync(join(SRC, 'assets', 'theme.css'), 'utf8')
    const debut = theme.indexOf('ATOME 5A')
    expect(debut, 'atome introuvable dans theme.css').toBeGreaterThan(-1)
    const zone = theme.slice(debut, theme.indexOf('.spinner--lg', debut))
    // mask et conic-gradient rendent la forme dependante du moteur de rendu.
    expect(zone).not.toMatch(/mask|conic-gradient/)
    // L'atome ET ses orbites sont des cercles : au moins deux border-radius: 50%.
    expect(zone.match(/border-radius:\s*50%/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

/**
 * Défaut vécu (conv-1507) : `.conversation-state.is-running` RECOPIAIT à la main la géométrie
 * de l'atome dans ChatView.css. Les deux copies ont divergé (reduced-motion : `none` d'un côté,
 * ralentissement de l'autre) — d'où « le spinner n'agit pas pareil selon où il est ».
 * La garde ci-dessous vise la CAUSE : aucune orbite ne se déclare hors theme.css.
 */
describe('spinner — aucune orbite recopiée hors de theme.css', () => {
  it('les keyframes aw-orbit ne sont utilisées que par theme.css', () => {
    const offenders = files
      .filter((f) => f.endsWith('.css') && !f.endsWith('theme.css'))
      .filter((f) => /animation:\s*aw-orbit/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
