import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  compter,
  depassements,
  estSurveille,
  fichiersSurveilles,
  jetonsSansValeurClaire,
  lirePlancher,
  mesurer,
  messageDeRefus,
  plancherBaisse,
  plusHaut
} from './couleurs-en-dur.mjs'

/**
 * « Par défaut, une nouvelle feature avec de l'ui est déclinable avec nos thèmes » (2026-10-31,
 * conv-1386). Une couleur écrite en dur ne suit aucun thème : ce cliquet refuse qu'il en arrive de
 * nouvelles, sans exiger de vider d'un coup les 2 563 qui existent.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : ajouter `color: #fff` à n'importe quelle feuille de
 * `src/renderer/src`, ou créer une feuille qui en contient une.
 */

const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

describe('ce qui compte comme une couleur en dur', () => {
  it.each([
    ['.a { color: #fff; }'],
    ['.a { color: #F5F7FB; }'],
    ['.a { background: rgba(0, 0, 0, 0.3); }'],
    ['.a { color: rgb(0 0 0 / 30%); }'],
    ['.a { color: hsl(40 80% 50%); }'],
    ['.a { color: oklch(0.7 0.1 80); }'],
    ['.a { color: white; }'],
    ['.a { border: 1px solid black; }']
  ])('voit %s', (css) => {
    expect(compter(css, 'x.css')).toBe(1)
  })

  it('voit la valeur de secours : var(--x, #hex) est une couleur en dur déguisée', () => {
    expect(compter('.a { color: var(--gold, #d4a94f); }', 'x.css')).toBe(1)
  })

  it('voit une couleur posée en ligne dans un composant', () => {
    expect(compter(`<i style={{ color: '#fff', backgroundColor: 'white' }} />`, 'x.tsx')).toBe(2)
    expect(compter(`<circle fill="#abcdef" />`, 'x.tsx')).toBe(1)
  })

  it.each([
    ['.a { color: var(--text); }'],
    ['.a { background: rgba(var(--voile-rgb), 0.3); }'],
    ['.a { background: color-mix(in srgb, var(--gold) 30%, transparent); }'],
    ['.a { color: hsl(var(--chip-hue) 60% 50%); }'],
    ['.a { color: currentColor; background: transparent; }'],
    ['.a { border-radius: 8px; }'],
    ['/* ancien défaut : #fff sur fond blanc */ .a { color: var(--text); }'],
    ['.a { mask: linear-gradient(#000 0 0); }']
  ])('laisse passer %s', (css) => {
    expect(compter(css, 'x.css')).toBe(0)
  })

  it('ne prend ni un commentaire ni une adresse pour une couleur, dans un composant', () => {
    expect(compter(`// ancien : #fff\nconst u = 'https://exemple.fr/#fff'`, 'x.tsx')).toBe(1)
    expect(compter(`const s = '&#123;'`, 'x.tsx')).toBe(0)
  })

  it('accepte une couleur fixe seulement si la ligne dit pourquoi', () => {
    expect(compter('.a { color: #fff; } /* couleur-fixe: papier blanc */', 'x.css')).toBe(0)
    expect(compter(`const c = '#fff' // couleur-fixe: décor 3D`, 'x.ts')).toBe(0)
    expect(compter('.a { color: #fff; } /* couleur-fixe: */', 'x.css')).toBe(1)
  })
})

describe('ce qui est surveillé', () => {
  it('prend les feuilles et les composants, pas les feuilles de thème ni les tests', () => {
    expect(estSurveille('src/renderer/src/components/Nouveau.css')).toBe(true)
    expect(estSurveille('src/renderer/src/components/Nouveau.tsx')).toBe(true)
    expect(estSurveille('src/renderer/src/assets/theme-nouveau.css')).toBe(false)
    expect(estSurveille('src/renderer/src/assets/theme.css')).toBe(false)
    expect(estSurveille('src/renderer/src/components/Nouveau.test.tsx')).toBe(false)
    expect(estSurveille('src/main/index.ts')).toBe(false)
  })
})

describe('le cliquet par fichier', () => {
  it('ne donne aucune couleur à un fichier nouveau', () => {
    expect(depassements({ 'Nouveau.css': 1 }, {})).toEqual([
      { chemin: 'Nouveau.css', compte: 1, plafond: 0 }
    ])
  })

  it('refuse qu un fichier ancien en gagne, accepte qu il en perde', () => {
    const plancher = { 'Ancien.css': 10 }
    expect(depassements({ 'Ancien.css': 11 }, plancher)).toHaveLength(1)
    expect(depassements({ 'Ancien.css': 10 }, plancher)).toEqual([])
    expect(depassements({ 'Ancien.css': 3 }, plancher)).toEqual([])
  })

  it('ne monte jamais un plafond en baissant, et oublie les fichiers disparus', () => {
    const plancher = { 'Baisse.css': 10, 'Monte.css': 2, 'Vide.css': 4, 'Parti.css': 5 }
    const mesure = { 'Baisse.css': 7, 'Monte.css': 9, 'Nouveau.css': 3 }
    const existe = (chemin) => chemin !== 'Parti.css'
    expect(plancherBaisse(mesure, plancher, existe)).toEqual({ 'Baisse.css': 7, 'Monte.css': 2 })
  })

  it('ne descend pas sous la version commitée : le nettoyage d un autre fil n est pas encore acquis', () => {
    // Rejeu de SuperConvMosaique.css (conv-1386) : 2 dans l'arbre partagé, 9 dans la version
    // commitée. Baisser à 2 ferait partir rouge toute copie propre tirée de cette version.
    const arbre = { 'SuperConvMosaique.css': 2 }
    const commite = { 'SuperConvMosaique.css': 9, 'Absent.css': 4 }
    expect(plusHaut(arbre, commite)).toEqual({ 'SuperConvMosaique.css': 9, 'Absent.css': 4 })
    const plancher = { 'SuperConvMosaique.css': 9, 'Absent.css': 4 }
    expect(plancherBaisse(plusHaut(arbre, commite), plancher, () => true)).toEqual(plancher)
  })
})

describe('les jetons de couleur', () => {
  const clair = (corps) => `:root[data-base='clair'] {\n${corps}\n}`

  it('refuse un jeton littéral qui n a pas de valeur claire', () => {
    expect(jetonsSansValeurClaire(':root {\n  --neuf: #123456;\n}', clair(''))).toEqual(['--neuf'])
  })

  it('accepte un jeton qui a sa valeur claire, ou qui renvoie à un autre jeton', () => {
    const theme = ':root {\n  --neuf: #123456;\n  --renvoi: var(--text);\n}'
    expect(jetonsSansValeurClaire(theme, clair('  --neuf: #fedcba;'))).toEqual([])
  })
})

describe('le refus', () => {
  it('dit quoi écrire à la place', () => {
    const texte = messageDeRefus({
      fichiers: [{ chemin: 'Nouveau.css', compte: 2, plafond: 0 }],
      jetons: ['--neuf']
    })
    expect(texte).toContain('Nouveau.css : 2 couleur(s) en dur, 0 au plus')
    expect(texte).toContain('--neuf : aucune valeur pour les thèmes clairs')
    expect(texte).toContain('var(--text)')
    expect(texte).toContain('couleur-fixe: <raison>')
  })
})

describe('l interface du dépôt', () => {
  it('scanne bien les feuilles du produit', () => {
    // Sans ce cas, un parcours de dossiers cassé rendrait les deux suivants verts à vide.
    const css = fichiersSurveilles().filter((f) => f.endsWith('.css'))
    expect(css.length).toBeGreaterThanOrEqual(70)
    expect(Object.keys(lirePlancher()).length).toBeGreaterThanOrEqual(70)
  })

  it('n ajoute aucune couleur en dur au-delà du plancher', () => {
    const fautes = depassements(mesurer(), lirePlancher())
    expect(fautes, messageDeRefus({ fichiers: fautes, jetons: [] })).toEqual([])
  })

  it('donne une valeur claire à chaque jeton littéral de theme.css', () => {
    const jetons = jetonsSansValeurClaire(
      lire('src/renderer/src/assets/theme.css'),
      lire('src/renderer/src/assets/theme-modes.css')
    )
    expect(jetons, messageDeRefus({ fichiers: [], jetons })).toEqual([])
  })
})
