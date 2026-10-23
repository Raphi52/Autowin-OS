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
  // Le bord gauche se REGARDE sans se consommer : l'accolade qui ferme une règle ouvre la suivante,
  // et la consommer sautait une règle sur deux (orchestrator, think… lus absents, conv-1105).
  const regle = new RegExp(
    `(?<=^|[},]|\\*/)\\s*${echappe ? `${echappe}\\s+` : ''}\\.observatory-gantt__lane(?:\\[data-phase='([a-z]+)'\\])?\\s*{([^}]*)}`,
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

/** `--gantt-defaut` du conteneur `.observatory-gantt` : la couleur d'une ligne sans couleur à elle. */
function jetonDefaut(css: string, prefixe = ''): string | undefined {
  const echappe = prefixe.replace(/[[\]().*'=^$]/g, '\\$&')
  const regle = new RegExp(
    `(?<=^|[},]|\\*/)\\s*${echappe ? `${echappe}\\s+` : ''}\\.observatory-gantt\\s*{([^}]*)}`,
    'g'
  )
  for (const [, corps] of css.matchAll(regle)) {
    const valeur = /--gantt-defaut:\s*([^;}\n]+)/.exec(corps)?.[1]?.trim()
    if (valeur) return valeur
  }
  return undefined
}

/** Les feuilles d'un thème, la main d'abord : importée après la couche générée, elle gagne à égalité. */
function feuillesDu(theme?: (typeof THEMES)[number]): { css: string; prefixe: string }[] {
  return theme
    ? [`../assets/theme-${theme}.css`, `../assets/theme-${theme}.genere.css`].map((chemin) => ({
        css: lire(chemin),
        prefixe: `:root[data-theme='${theme}']`
      }))
    : []
}

function couchesDu(theme?: (typeof THEMES)[number]): Map<string | null, string>[] {
  return feuillesDu(theme).map(({ css, prefixe }) => couleurs(css, prefixe))
}

/**
 * Couleur effective de chaque phase (et de `outil`) dans un thème, ou dans la base sans thème. On
 * suit la PRIORITÉ des sélecteurs, pas seulement l'ordre des feuilles : la ligne SANS phase d'un
 * thème (`:root[data-theme] .observatory-gantt__lane`, 0,3,0) bat la ligne AVEC phase de la base
 * (`.observatory-gantt__lane[data-phase]`, 0,2,0). Capture du 2026-10-22 (conv-1105) : sous Ninja,
 * dont la couche générée repeint la ligne par défaut en gris, les outils sortaient gris alors que
 * la première version de ce calcul, qui ignorait cette priorité, les disait vert-jaune.
 * `var(--gantt-defaut)` se résout comme le navigateur : jeton du thème, sinon celui de la base.
 */
function palette(theme?: (typeof THEMES)[number]): Record<string, string> {
  const base = couleurs(lire('./ObservatoryView.css'))
  const couches = couchesDu(theme)
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
  const defaut = (): string | undefined =>
    feuillesDu(theme)
      .map(({ css, prefixe }) => jetonDefaut(css, prefixe))
      .find(Boolean) ?? jetonDefaut(lire('./ObservatoryView.css'))
  const resoudre = (valeur: string | undefined): string | undefined => {
    const jeton = /^var\(--gantt-defaut(?:,\s*([^)]+))?\)$/.exec(valeur ?? '')
    return jeton ? (defaut() ?? jeton[1]?.trim()) : valeur
  }
  return Object.fromEntries(
    [...PHASES, 'outil', 'défaut'].map((phase) => [
      phase,
      resoudre(effective(phase === 'défaut' ? null : phase)) ?? ''
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

  /**
   * Ninja (conv-1105, 2026-10-23) : sa couche générée recopiait la ligne SANS phase, en gris chaud,
   * avec la priorité d'un thème (0,3,0). Scout, build et judge, que la transposition ne change pas,
   * n'y ont pas de règle à eux : ils prenaient ce gris au lieu de leur couleur (capture Ninja du 22/10).
   * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE CAS : une règle `:root[data-theme] .observatory-gantt__lane` sans phase.
   */
  for (const theme of THEMES) {
    it(`garde à chaque agent sa couleur quand le thème ne la repeint pas — thème ${theme}`, () => {
      const base = couleurs(lire('./ObservatoryView.css'))
      const couches = couchesDu(theme)
      const couleursDuTheme = palette(theme)
      const perdues = PHASES.filter(
        (phase) =>
          !couches.some((couche) => couche.has(phase)) && couleursDuTheme[phase] !== base.get(phase)
      ).map((phase) => `${phase} : ${couleursDuTheme[phase]} au lieu de ${base.get(phase)}`)
      expect(perdues).toEqual([])
    })
  }

  it('résout la couleur d’une ligne sans couleur à elle dans chaque thème', () => {
    for (const theme of [undefined, ...THEMES]) {
      const defaut = palette(theme)['défaut']
      expect(() => teinte(defaut), `thème ${theme ?? 'de base'} : « ${defaut} »`).not.toThrow()
    }
  })

  /**
   * Ninja (conv-1105, 2026-10-23) : une ligne SANS couleur à elle (salvage, toute étape hors de la
   * liste) prend la couleur par défaut. Une fois retirée la copie du défaut qui écrasait scout, build
   * et judge, ce défaut redevenait le gris BLEUTÉ de la base (#8c96a8), que Ninja transpose partout
   * ailleurs en gris chaud (capture obs-1105-ninja-phases-b.png, ligne salvage).
   * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE CAS : un défaut de teinte froide dans Ninja.
   */
  it('peint en gris chaud, dans Ninja, une ligne sans couleur à elle', () => {
    const defaut = palette('ninja-claude')['défaut']
    const { h, s } = teinte(defaut)
    expect(s, `défaut trop coloré (${defaut})`).toBeLessThan(0.15)
    expect(h, `défaut de teinte froide (${defaut})`).toBeGreaterThanOrEqual(20)
    expect(h, `défaut de teinte froide (${defaut})`).toBeLessThanOrEqual(70)
  })
})
