import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * Theme « Vanilla Claude » (conv-269, 2026-10-16) : la version CLAIRE de Ninja Claude, l'apparence
 * de Claude en mode clair. Base CLAIRE : il herite des corrections de lisibilite de la base claire
 * (theme-modes.css, theme-clair-gris.css), puis deux fichiers les recolorent :
 *   - theme-vanilla-claude.genere.css : chaque regle de la base claire qui ecrit une couleur EN DUR
 *     (gris bleutes, rose, cyan), re-prefixee pour ce theme, couleur transposee en gris chaud /
 *     terracotta (`node scripts/theme-nebuleuse-verre.mjs vanilla-claude`) ;
 *   - theme-vanilla-claude.css : jetons, polices, colonne, chat (ecrite a la main).
 *
 * Le risque qui compte : une regle NON confinee au theme repeindrait le mode clair de TOUS les
 * utilisateurs (« Clair », « Holographique blanc », « Special malvoyant — clair »).
 */
const lire = (fichier: string): string => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const PREFIXE = ":root[data-theme='vanilla-claude']"
const GENERATEUR = fileURLToPath(
  new URL('../../../../scripts/theme-nebuleuse-verre.mjs', import.meta.url)
)

function selecteursHorsTheme(css: string): string[] {
  const fautifs: string[] = []
  postcss.parse(css).walkRules((regle) => {
    if (regle.parent?.type === 'atrule' && /keyframes/i.test((regle.parent as postcss.AtRule).name))
      return
    for (const selecteur of regle.selectors) {
      if (!selecteur.trim().startsWith(PREFIXE)) fautifs.push(selecteur)
    }
  })
  return fautifs
}

type Rgb = { r: number; g: number; b: number }
const hex = (h: string): Rgb => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16)
})
const canal = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = ({ r, g, b }: Rgb): number =>
  0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
const contraste = (a: string, b: string): number => {
  const [l1, l2] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** Valeur d'un jeton dans le PREMIER bloc `:root[data-theme='vanilla-claude'][data-base='clair']`. */
function jeton(css: string, nom: string): string {
  let valeur = ''
  postcss.parse(css).walkRules((regle) => {
    if (valeur || regle.selector.trim() !== `${PREFIXE}[data-base='clair']`) return
    regle.walkDecls(nom, (d) => {
      valeur = d.value.trim()
    })
  })
  return valeur
}

/** Teinte (degres) et saturation d'une couleur `r,g,b`. */
function teinte({ r, g, b }: Rgb): { h: number; s: number } {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
  h *= 60
  return { h: h < 0 ? h + 360 : h, s }
}

/** Coupe une liste de selecteurs aux virgules de PREMIER niveau (pas celles d'un `:is(...)`). */
function couperListe(liste: string): string[] {
  const morceaux: string[] = []
  let profondeur = 0
  let courant = ''
  for (const c of liste) {
    if (c === '(') profondeur += 1
    if (c === ')') profondeur -= 1
    if (c === ',' && profondeur === 0) {
      morceaux.push(courant.trim())
      courant = ''
    } else courant += c
  }
  if (courant.trim()) morceaux.push(courant.trim())
  return morceaux
}

/**
 * Specificite [ids, classes/attributs/pseudo-classes, elements] d'un selecteur, regles CSS :
 * `:is()` / `:not()` / `:has()` prennent leur argument le plus lourd, `:where()` compte zero.
 * Suffisant pour les selecteurs des feuilles de theme (pas d'echappement, pas de `:nth-child(of)`).
 */
function specificite(selecteur: string): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0]
  let reste = selecteur
  const fonctionnelle = /:(is|not|has|where)\(/
  for (let m = reste.match(fonctionnelle); m; m = reste.match(fonctionnelle)) {
    const debut = m.index! + m[0].length
    let profondeur = 1
    let fin = debut
    for (; fin < reste.length && profondeur > 0; fin += 1) {
      if (reste[fin] === '(') profondeur += 1
      if (reste[fin] === ')') profondeur -= 1
    }
    if (m[1] !== 'where') {
      const lourd = couperListe(reste.slice(debut, fin - 1))
        .map(specificite)
        .sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0]
      for (let i = 0; i < 3; i += 1) total[i] += lourd[i]
    }
    reste = reste.slice(0, m.index) + ' ' + reste.slice(fin)
  }
  reste = reste.replace(/\[[^\]]*\]/g, () => {
    total[1] += 1
    return ' '
  })
  total[0] += (reste.match(/#[\w-]+/g) ?? []).length
  total[1] += (reste.match(/\.[\w-]+/g) ?? []).length
  total[1] += (reste.match(/(^|[^:]):(?!:)[\w-]+(\([^)]*\))?/g) ?? []).length
  total[2] += (reste.match(/::[\w-]+/g) ?? []).length
  total[2] += (
    reste.replace(/[.#:][\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []
  ).length
  return total
}
const plusLourd = (a: number[], b: number[]): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]

/** `P :is(A, B)` -> [`P A`, `P B`] ; un selecteur sans `:is()` final reste seul. */
function branches(selecteur: string): string[] {
  const m = selecteur.match(/^(.*?)\s:is\(([\s\S]*)\)$/)
  return m
    ? couperListe(m[2]).map((b) => `${m[1]} ${b}`.replace(/\s+/g, ' '))
    : [selecteur.replace(/\s+/g, ' ')]
}

describe('theme Vanilla Claude', () => {
  /** ENTREE QUI DOIT FAIRE ECHOUER CE CAS : une regle generee ou ecrite sans le prefixe du theme. */
  it('ne peint rien hors du theme : chaque selecteur porte le prefixe', () => {
    const genere = lire('./theme-vanilla-claude.genere.css')
    // 47 regles le 2026-10-16 (74 regles de la base claire ecrivent une couleur en dur, 47 en bleu/rose).
    let regles = 0
    postcss.parse(genere).walkRules(() => {
      regles += 1
    })
    expect(regles).toBeGreaterThan(40)
    expect(selecteursHorsTheme(genere)).toEqual([])
    expect(selecteursHorsTheme(lire('./theme-vanilla-claude.css'))).toEqual([])
  })

  /**
   * ENTREE QUI DOIT FAIRE ECHOUER CE CAS : oublier un import, charger la feuille ecrite a la main
   * AVANT la couche, ou charger le theme avant la base claire qu'il recolore.
   */
  it('est charge APRES la base claire, la couche generee avant la feuille ecrite a la main', () => {
    const app = lire('../App.tsx')
    const base = app.indexOf("import './assets/theme-clair-gris.css'")
    const genere = app.indexOf("import './assets/theme-vanilla-claude.genere.css'")
    const main = app.indexOf("import './assets/theme-vanilla-claude.css'")
    expect(base).toBeGreaterThan(-1)
    expect(genere).toBeGreaterThan(base)
    expect(main).toBeGreaterThan(genere)
  })

  /** Un fichier retouche a la main ou une base claire modifiee sans regenerer fait echouer ce cas. */
  it('la couche sur disque est a jour avec son generateur', async () => {
    const { genererVanillaClaude } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererVanillaClaude().css).toBe(lire('./theme-vanilla-claude.genere.css'))
  })

  /**
   * Claude clair est NEUTRE CHAUD : aucune couleur de la couche ne garde une teinte bleue, cyan ou
   * violette (180-300 deg) au-dela d'une trace de saturation. ENTREE QUI DOIT FAIRE ECHOUER CE CAS :
   * oublier une famille (les gris bleutes #cfd6e0 de la base claire, le rose de la bulle).
   */
  it('transpose les gris bleutes, le rose et le cyan de la base claire', () => {
    const genere = lire('./theme-vanilla-claude.genere.css')
    expect(genere).not.toMatch(/rgba?\(207, 214, 224/) // #cfd6e0, panneaux de la base claire
    expect(genere).not.toMatch(/rgba?\(200, 26, 108/) // rose de la bulle de la base claire
    const froides: string[] = []
    for (const m of genere.matchAll(/rgba?\((\d+), (\d+), (\d+)/g)) {
      const { h, s } = teinte({ r: +m[1], g: +m[2], b: +m[3] })
      if (h >= 180 && h <= 300 && s > 0.02) froides.push(m[0])
    }
    expect(froides).toEqual([])
  })

  /**
   * Couleurs de la charte d'Anthropic (github.com/anthropics/skills, brand-guidelines) : encre
   * #141413 sur creme #faf9f5. Seuils : texte courant >= 7:1, texte discret et accent >= 4,5:1,
   * sur la page ET sur le panneau. ENTREE QUI DOIT FAIRE ECHOUER CE CAS : reprendre le terracotta
   * #d97757 de Ninja Claude comme couleur de TEXTE (3,1:1 sur la creme).
   */
  it('reste lisible : encre de la charte, texte discret et accent >= 4,5:1', () => {
    const css = lire('./theme-vanilla-claude.css')
    expect(jeton(css, '--text')).toBe('#141413')
    expect(jeton(css, '--bg-0')).toBe('#faf9f5')
    for (const fond of [jeton(css, '--bg-0'), jeton(css, '--bg-inset'), jeton(css, '--bg-2')]) {
      expect(fond).toMatch(/^#[0-9a-f]{6}$/)
      expect(contraste(jeton(css, '--text'), fond)).toBeGreaterThanOrEqual(7)
      expect(contraste(jeton(css, '--text-dim'), fond)).toBeGreaterThanOrEqual(7)
      expect(contraste(jeton(css, '--text-faint'), fond)).toBeGreaterThanOrEqual(4.5)
      expect(contraste(jeton(css, '--gold'), fond)).toBeGreaterThanOrEqual(4.5)
    }
  })

  /**
   * LA FEUILLE ECRITE A LA MAIN GAGNE SUR LA COUCHE GENEREE DU MEME THEME (2026-10-16, capture
   * vanilla-chat2.png : saisie grise au lieu de blanche, pastille beige sous le logo). Une regle
   * generee `P :is(..., .cosmic-outline .chat-suggest .btn)` pesait 0,6,0 (le `:is` prend sa
   * branche la plus lourde) contre 0,5,0 pour `P .cosmic-outline .composer-field` : la feuille
   * perdait, importee apres ou non. ENTREE QUI DOIT FAIRE ECHOUER CE CAS : une regle generee qui
   * vise le meme element que la feuille, pour la meme propriete, avec un poids superieur.
   */
  it('aucune regle generee ne bat la feuille ecrite a la main sur le meme element', () => {
    const genere: { branche: string; poids: number[]; props: Set<string> }[] = []
    postcss.parse(lire('./theme-vanilla-claude.genere.css')).walkRules((regle) => {
      if (regle.parent?.type === 'atrule') return
      const props = new Set<string>()
      regle.walkDecls((d) => {
        props.add(d.prop)
      })
      for (const s of regle.selectors)
        for (const branche of branches(s)) genere.push({ branche, poids: specificite(s), props })
    })
    const battues: string[] = []
    postcss.parse(lire('./theme-vanilla-claude.css')).walkRules((regle) => {
      if (regle.parent?.type === 'atrule') return
      for (const s of regle.selectors) {
        const cible = s.replace(/\s+/g, ' ').trim()
        regle.walkDecls((d) => {
          for (const g of genere)
            if (g.branche === cible && g.props.has(d.prop) && plusLourd(g.poids, specificite(s)))
              battues.push(`${cible} { ${d.prop} } perd contre ${g.poids.join(',')}`)
        })
      }
    })
    expect(battues).toEqual([])
    // Les deux regles de la capture, nommees : la saisie blanche et le logo sans pastille.
    const app = (sel: string): number[] => specificite(`${PREFIXE}[data-base='clair'] ${sel}`)
    expect(app('.cosmic-outline .composer-field')).toEqual([0, 5, 0])
    expect(specificite(':root :is(.a .b .c, .d)')).toEqual([0, 4, 0]) // jumeau : le :is pese bien
  })

  /**
   * Le generateur refuse un identifiant approchant (code 2, rien d'ecrit) et accepte le bon.
   * ENTREE QUI DOIT FAIRE ECHOUER CE CAS : oublier `vanilla-claude` dans ARGUMENTS_CONNUS, ou laisser
   * un argument inconnu retomber sur la couche d'Holographique.
   */
  it('le generateur refuse « vanilla » et « Vanilla-Claude », connait « vanilla-claude »', async () => {
    for (const abime of ['vanilla', 'Vanilla-Claude']) {
      const r = spawnSync(process.execPath, [GENERATEUR, abime], { encoding: 'utf8' })
      expect(r.status).toBe(2)
      expect(r.stderr).toMatch(/vanilla-claude/)
    }
  })
})
