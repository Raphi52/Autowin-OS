import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * COULEUR DES LIGNES D'OUTILS du déroulé (conv-1105, 2026-10-22) : « donne une couleur propre aux
 * lignes d'outils du graphe de l'Observatory, dans tous les thèmes ». Une ligne d'outil (Bash, Read…)
 * prenait le gris par défaut de `.observatory-gantt__lane`. Elle doit se distinguer d'un coup d'œil de
 * CHAQUE agent (orchestrateur, scout, judge…) dans CHAQUE thème : la couleur effective d'une phase y
 * est celle de la feuille du thème, sinon de sa couche générée, sinon de la feuille de base.
 */

const PHASES = [
  'orchestrator',
  'scout',
  'think',
  'frame',
  'terrain',
  'build',
  'clean',
  'judge',
  'learn'
] as const
const THEMES = [
  'nebuleuse-verre',
  'holographique-clair',
  'ninja-claude',
  'vanilla-claude',
  'nier-automata'
] as const

const lire = (chemin: string): string => readFileSync(new URL(chemin, import.meta.url), 'utf8')

/** `--gantt-color` de la ligne d'une phase (`null` = la règle sans phase, le gris par défaut). */
function couleurs(css: string, prefixe = ''): Map<string | null, string> {
  const echappe = prefixe.replace(/[[\]().*'=^$]/g, '\\$&')
  const regle = new RegExp(
    `(?:^|[},]|\\*/)\\s*${echappe ? `${echappe}\\s+` : ''}\\.observatory-gantt__lane(?:\\[data-phase='([a-z]+)'\\])?\\s*{([^}]*)}`,
    'g'
  )
  const trouvees = new Map<string | null, string>()
  for (const [, phase, corps] of css.matchAll(regle)) {
    const valeur = /--gantt-color:\s*([^;}\n]+)/.exec(corps)?.[1]?.trim()
    if (valeur) trouvees.set(phase ?? null, valeur)
  }
  return trouvees
}

function rgb(couleur: string): { r: number; g: number; b: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(couleur)?.[1]
  if (hex)
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    }
  const [r, g, b] = (/rgba?\(([^)]+)\)/.exec(couleur)?.[1] ?? '').split(',').map(Number)
  if ([r, g, b].some((n) => !Number.isFinite(n))) throw new Error(`couleur illisible : ${couleur}`)
  return { r, g, b }
}

function teinte(couleur: string): { h: number; s: number } {
  const { r, g, b } = rgb(couleur)
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
  return { h: (h * 60 + 360) % 360, s }
}

/**
 * Couleur effective de chaque phase (et de `outil`) dans un thème, ou dans la base sans thème. On
 * suit la PRIORITÉ des sélecteurs, pas seulement l'ordre des feuilles : la ligne SANS phase d'un
 * thème (`:root[data-theme] .observatory-gantt__lane`, 0,3,0) bat la ligne AVEC phase de la base
 * (`.observatory-gantt__lane[data-phase]`, 0,2,0). Capture du 2026-10-22 (conv-1105) : sous Ninja,
 * dont la couche générée repeint la ligne par défaut en gris, les outils sortaient gris alors que
 * la première version de ce calcul, qui ignorait cette priorité, les disait vert-jaune.
 */
function palette(theme?: (typeof THEMES)[number]): Record<string, string> {
  const base = couleurs(lire('./ObservatoryView.css'))
  // Feuille écrite à la main d'abord : importée après la couche générée, elle gagne à égalité.
  const couches = theme
    ? [
        couleurs(lire(`../assets/theme-${theme}.css`), `:root[data-theme='${theme}']`),
        couleurs(lire(`../assets/theme-${theme}.genere.css`), `:root[data-theme='${theme}']`)
      ]
    : []
  const effective = (phase: string | null): string | undefined => {
    const dans = (cle: string | null): string | undefined =>
      couches.find((couche) => couche.has(cle))?.get(cle)
    return (
      (phase === null ? undefined : dans(phase)) ??
      dans(null) ??
      (phase === null ? undefined : base.get(phase)) ??
      base.get(null)
    )
  }
  return Object.fromEntries(
    [...PHASES, 'outil', 'défaut'].map((phase) => [
      phase,
      effective(phase === 'défaut' ? null : phase) ?? ''
    ])
  )
}

/** Écart de teinte sur le cercle, en degrés. */
const ecart = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe('Déroulé de l’Observatory — couleur des lignes d’outils (conv-1105)', () => {
  it('connaît toutes les feuilles qui repeignent les lignes (les autres thèmes prennent la base)', () => {
    // sombre, clair, machine-a-ecrire et malvoyant-* ne touchent pas `--gantt-color` : le cas « de
    // base » les couvre. Un thème qui se mettrait à le repeindre doit entrer dans THEMES.
    const connues = new Set([
      'components/ObservatoryView.css',
      ...THEMES.flatMap((theme) => [
        `assets/theme-${theme}.genere.css`,
        `assets/theme-${theme}.css`
      ])
    ])
    const racine = new URL('../', import.meta.url)
    const feuilles = ['components', 'assets'].flatMap((dossier) =>
      readdirSync(new URL(`${dossier}/`, racine))
        .filter((nom) => nom.endsWith('.css'))
        .map((nom) => `${dossier}/${nom}`)
    )
    const inconnues = feuilles.filter(
      (feuille) =>
        !connues.has(feuille) &&
        /observatory-gantt__lane[^{]*{[^}]*--gantt-color/.test(
          readFileSync(new URL(feuille, racine), 'utf8')
        )
    )
    expect(inconnues).toEqual([])
  })

  it('donne aux lignes d’outils une couleur à elles, pas le gris par défaut', () => {
    const base = couleurs(lire('./ObservatoryView.css'))
    expect(base.get('outil'), 'aucune couleur pour data-phase=outil').toBeTruthy()
    expect(base.get('outil')).not.toBe(base.get(null))
  })

  for (const theme of [undefined, ...THEMES]) {
    it(`la distingue d’un coup d’œil de chaque agent — thème ${theme ?? 'de base'}`, () => {
      const couleursDuTheme = palette(theme)
      const outil = teinte(couleursDuTheme.outil)
      // Une couleur franche : un gris se confondrait avec les phases neutres de Ninja.
      expect(outil.s, `outil trop gris (${couleursDuTheme.outil})`).toBeGreaterThan(0.35)
      for (const phase of PHASES) {
        const autre = teinte(couleursDuTheme[phase])
        // Une phase neutre (gris) se distingue déjà d'une couleur franche.
        if (autre.s < 0.25) continue
        expect(
          ecart(outil.h, autre.h),
          `outil ${couleursDuTheme.outil} trop proche de ${phase} ${couleursDuTheme[phase]}`
        ).toBeGreaterThanOrEqual(30)
      }
    })
  }
})
