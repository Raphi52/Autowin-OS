/*
 * LES SCHÉMAS MERMAID PRENNENT LES COULEURS DU THÈME DE L'APP (conv-1235, 2026-10-28).
 *
 * Avant : `theme: 'dark'` figé, des boîtes noires même sur un thème clair. Ces tests tiennent les
 * deux défauts vus au premier rendu réel : le nom d'un état peint de la couleur de son fond
 * (invisible), et des parts de camembert toutes de la même teinte sombre.
 */
import { describe, expect, it } from 'vitest'
import { configMermaidDuTheme, melanger, teindreSankey } from './theme-mermaid'

const SOMBRE: Record<string, string> = {
  '--bg-0': '#000000',
  '--text': '#f5f7fb',
  '--text-dim': '#b5bcc8',
  '--gold-doux': '#d4a94f',
  '--gold-clair': '#e3ba55',
  '--font': "'Segoe UI', system-ui, sans-serif",
  '--violet': 'rgb(143, 124, 255)',
  '--ok': '#92a979',
  '--err': '#cf625e'
}
const lireDans =
  (jetons: Record<string, string>) =>
  (jeton: string): string =>
    jetons[jeton] ?? ''

describe('configMermaidDuTheme', () => {
  it('bâtit le thème `base` sur l’or et le texte du thème appliqué', () => {
    const config = configMermaidDuTheme(lireDans(SOMBRE), false)
    expect(config?.theme).toBe('base')
    expect(config?.darkMode).toBe(true)
    expect(config?.themeVariables.primaryBorderColor).toBe('#d4a94f')
    expect(config?.themeVariables.primaryTextColor).toBe('#f5f7fb')
    expect(config?.themeVariables.fontFamily).toBe("'Segoe UI', system-ui, sans-serif")
    // Boîte = fond de page teinté d'or, jamais l'or plein (le texte resterait illisible dessus).
    expect(config?.themeVariables.primaryColor).toBe(melanger('#d4a94f', '#000000', 0.14))
  })

  it('peint le NOM d’un état dans la couleur du texte, pas dans celle de sa boîte', () => {
    const variables = configMermaidDuTheme(lireDans(SOMBRE), false)?.themeVariables
    expect(variables?.stateLabelColor).toBe('#f5f7fb')
    expect(variables?.stateLabelColor).not.toBe(variables?.stateBkg)
  })

  it('donne des teintes DISTINCTES aux parts de camembert', () => {
    const variables = configMermaidDuTheme(lireDans(SOMBRE), false)?.themeVariables ?? {}
    const parts = [1, 2, 3, 4, 5, 6].map((i) => variables[`pie${i}`])
    expect(parts.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c))).toBe(true)
    expect(new Set(parts).size).toBe(6)
  })

  it('suit un thème CLAIR : mode clair et boîtes claires', () => {
    const clair = {
      ...SOMBRE,
      '--bg-0': '#f6f4ef',
      '--text': '#14192a',
      '--text-dim': '#4d5567',
      '--gold-doux': '#8c6412'
    }
    const config = configMermaidDuTheme(lireDans(clair), true)
    expect(config?.darkMode).toBe(false)
    expect(config?.themeVariables.primaryTextColor).toBe('#14192a')
    // La boîte reste proche du fond clair : pas de boîte noire sur page blanche.
    const boite = String(config?.themeVariables.primaryColor)
    expect(parseInt(boite.slice(1, 3), 16)).toBeGreaterThan(200)
  })

  it('rend `null` si un jeton manque : l’appelant garde le thème sombre de mermaid', () => {
    const { ['--gold-doux']: _retire, ...incomplet } = SOMBRE
    expect(configMermaidDuTheme(lireDans(incomplet), false)).toBeNull()
  })

  it('se passe des couleurs de statut absentes (parts en tons d’or)', () => {
    const { ['--violet']: _v, ['--ok']: _o, ['--err']: _e, ...sansStatut } = SOMBRE
    const variables = configMermaidDuTheme(lireDans(sansStatut), false)?.themeVariables ?? {}
    expect(new Set([1, 2, 3, 4, 5, 6].map((i) => variables[`pie${i}`])).size).toBeGreaterThan(3)
  })
})

/*
 * LES AUTRES TYPES DE SCHÉMAS (conv-1235, rendu de 20 types sur mermaid 11.16) : carte mentale,
 * frise, treemap et radar tirent leurs couleurs de l'échelle `cScale0..11`, que mermaid assombrit
 * de 75 % en mode sombre — boîtes NOIRES. L'histogramme peignait son fond en noir et ses barres en
 * crème ; l'arborescence écrivait en noir (invisible sur fond sombre) ; les paquets en blanc.
 */
describe('configMermaidDuTheme — les autres types de schémas', () => {
  const variables = configMermaidDuTheme(lireDans(SOMBRE), false)?.themeVariables ?? {}

  it('fournit une échelle de 12 teintes distinctes, écrites dans la couleur du texte', () => {
    const echelle = Array.from({ length: 12 }, (_, i) => variables[`cScale${i}`])
    expect(echelle.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c))).toBe(true)
    expect(new Set(echelle).size).toBe(12)
    // Jamais le noir que mermaid fabrique en assombrissant : la teinte reste visible sur le fond.
    expect(echelle).not.toContain('#000000')
    for (let i = 0; i < 12; i += 1) expect(variables[`cScaleLabel${i}`]).toBe('#f5f7fb')
  })

  it('garde 12 teintes distinctes quand deux jetons du thème ont la même couleur', () => {
    const doublon = { ...SOMBRE, '--cyan': '#0f6f9c', '--info': '#0f6f9c' }
    const v = configMermaidDuTheme(lireDans(doublon), false)?.themeVariables ?? {}
    expect(new Set(Array.from({ length: 12 }, (_, i) => v[`cScale${i}`])).size).toBe(12)
  })

  it('pose l’histogramme sur un fond transparent, avec des barres aux teintes du thème', () => {
    const xy = variables.xyChart as Record<string, string>
    expect(xy.backgroundColor).toBe('transparent')
    expect(xy.plotColorPalette.split(',')[0]).toBe(variables.cScaleInv0)
    expect(xy.xAxisLabelColor).toBe('#f5f7fb')
  })

  it('écrit l’arborescence et les paquets dans la couleur du texte du thème', () => {
    expect((variables.treeView as Record<string, string>).labelColor).toBe('#f5f7fb')
    const paquet = variables.packet as Record<string, string>
    expect(paquet.blockFillColor).toBe(variables.primaryColor)
    expect(paquet.labelColor).toBe('#f5f7fb')
  })
})

/*
 * LE SANKEY (conv-1235) : mermaid 11.16 le peint avec la palette d3 `schemeTableau10`, écrite en
 * dur dans son dessin — aucune variable de thème ne l'atteint. Ses 10 couleurs sont donc remplacées
 * dans le SVG produit, nœuds ET dégradés des liens, par les teintes pleines du thème.
 */
describe('teindreSankey', () => {
  const config = configMermaidDuTheme(lireDans(SOMBRE), false)
  const sankey = (corps: string): string => `<svg aria-roledescription="sankey">${corps}</svg>`

  it('remplace chaque couleur Tableau par la teinte de même rang, nœuds et dégradés', () => {
    const v = config?.themeVariables ?? {}
    const sortie = teindreSankey(
      sankey('<rect fill="#4e79a7"/><rect fill="#f28e2c"/><stop stop-color="#4E79A7"/>'),
      config
    )
    expect(sortie).toContain(`fill="${String(v.cScaleInv0)}"`)
    expect(sortie).toContain(`fill="${String(v.cScaleInv1)}"`)
    expect(sortie).toContain(`stop-color="${String(v.cScaleInv0)}"`)
    expect(sortie).not.toMatch(/#4e79a7|#f28e2c/i)
  })

  it('ne touche ni un autre schéma, ni une couleur hors de la palette, ni rien hors thème', () => {
    const autre = '<svg aria-roledescription="flowchart-v2"><rect fill="#4e79a7"/></svg>'
    expect(teindreSankey(autre, config)).toBe(autre)
    const libre = sankey('<rect fill="#123456"/>')
    expect(teindreSankey(libre, config)).toBe(libre)
    const brut = sankey('<rect fill="#4e79a7"/>')
    expect(teindreSankey(brut, null)).toBe(brut)
  })
})

describe('melanger', () => {
  it('mélange linéairement deux couleurs', () => {
    expect(melanger('#ffffff', '#000000', 0.5)).toBe('#808080')
    expect(melanger('#d4a94f', '#000000', 1)).toBe('#d4a94f')
    expect(melanger('#d4a94f', '#123456', 0)).toBe('#123456')
  })
})
