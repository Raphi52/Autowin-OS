import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEMES, baseDuTheme } from '../theme-mode'

/**
 * THEME « HOLOGRAPHIQUE CLAIR » (conv-212, 2026-10-10 : « Fais un mode holographique clair »).
 * Pendant clair d'« Holographique » (id `nebuleuse-verre`) : meme degrade bleu -> rose, meme bleu
 * plein, sur une nacre argentee au lieu du noir. Base CLAIRE : il herite des corrections de
 * lisibilite ecrites pour tous les themes clairs (`data-base='clair'`).
 */
const css = readFileSync('src/renderer/src/assets/theme-holographique-clair.css', 'utf8')
const app = readFileSync('src/renderer/src/App.tsx', 'utf8')
const PREFIXE = ":root[data-theme='holographique-clair']"

function blocRacine(): string {
  const debut = css.indexOf(`${PREFIXE} {`)
  if (debut < 0) throw new Error('bloc des jetons introuvable')
  return css.slice(debut, css.indexOf('}', debut))
}
function jeton(bloc: string, nom: string): string {
  const m = new RegExp(`${nom}:\\s*(#[0-9a-f]{6})`, 'i').exec(bloc)
  if (!m) throw new Error(`${nom} absent ou pas en #rrggbb`)
  return m[1]
}
function lum(c: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contraste(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe('theme Holographique clair', () => {
  it('est propose dans la liste, en base claire', () => {
    expect(THEMES.find((t) => t.id === 'holographique-clair')?.libelle).toBe('Holographique clair')
    expect(baseDuTheme('holographique-clair')).toBe('clair')
  })

  it('est importe APRES les couches claires communes, dont il reprend les selecteurs', () => {
    const position = (f: string): number => app.indexOf(`import './assets/${f}'`)
    expect(position('theme-holographique-clair.css')).toBeGreaterThan(0)
    expect(position('theme-holographique-clair.css')).toBeGreaterThan(position('theme-modes.css'))
    expect(position('theme-holographique-clair.css')).toBeGreaterThan(position('theme-clair-gris.css'))
  })

  /* Contraste WCAG calcule sur les QUATRE fonds du theme. Entree qui doit faire echouer : un
     texte estompe gris moyen, ou le bleu #3c6eeb employe comme couleur de texte (3,3:1). */
  const b = blocRacine()
  const fonds = ['--holo-fond-page', '--holo-panneau', '--holo-carte', '--holo-champ'].map((v) => jeton(b, v))
  it('texte courant et secondaire >= 7:1 sur tous les fonds', () => {
    for (const f of fonds) {
      expect(contraste(jeton(b, '--text'), f)).toBeGreaterThanOrEqual(7)
      expect(contraste(jeton(b, '--text-dim'), f)).toBeGreaterThanOrEqual(7)
    }
  })
  it.each(['--text-faint', '--gold', '--rose', '--cyan', '--ok', '--warn', '--err'])(
    '%s >= 4,5:1 sur tous les fonds',
    (v) => {
      for (const f of fonds) expect(contraste(jeton(b, v), f)).toBeGreaterThanOrEqual(4.5)
    }
  )

  it('le blanc ne peint pas les panneaux (« le blanc pique les yeux », choix du 2026-09-23)', () => {
    for (const v of ['--holo-panneau', '--holo-carte']) expect(jeton(b, v).toLowerCase()).not.toBe('#ffffff')
  })

  /* La signature holographique : le MEME degrade que le theme sombre, bleu PLEIN -> rose. */
  it.each([
    ['la bulle envoyee', '.msg.user .msg-body.msg-bulle'],
    ["l'element du menu ouvert", '.nav-item.active'],
    ['le fil ouvert', '.conv-item.active']
  ])('%s porte le degrade bleu plein -> rose', (_nom, selecteur) => {
    const i = css.indexOf(`${selecteur} {`)
    expect(i, `${selecteur} absent`).toBeGreaterThan(0)
    const regle = css.slice(i, css.indexOf('}', i))
    expect(regle).toMatch(/#3c6eeb,\s*#e63ca0/)
  })
})
