#!/usr/bin/env node
/**
 * GENERATEUR du theme « Nebuleuse de verre » -- couches de couleurs ecrites EN DUR.
 *
 * Pourquoi : un theme Autowin ne redefinit que des jetons (theme-modes.css), or 2 637 couleurs
 * sont ecrites en dur dans 56 feuilles (mesure du 2026-10-09, conv-124) -- dont plus de 250 ors
 * de la marque, des cyans HUD et des noirs bleutes. Sans ce fichier, le theme ne repeignait que
 * le cadre : chaque vue gardait ses bords dores et ses fonds bleu-noir.
 *
 * Ce que fait le script : il relit chaque feuille de src/renderer/src (sauf les themes clair,
 * malvoyant et ce theme), garde les declarations qui contiennent une couleur des familles
 * DECORATIVES ci-dessous, et ecrit la meme regle prefixee par :root[data-theme='nebuleuse-verre']
 * avec la couleur transposee. Le reste du fichier source n'est jamais touche.
 *
 * Familles transposees (alpha toujours conserve) :
 *   - OR de la marque (liste EXACTE, pas une plage de teinte : les jaunes d'ETAT -- question,
 *     alerte, quota -- portent un sens et restent) -> rose ;
 *   - CYAN / bleu HUD (teinte 185-212 deg, saturation >= 45 %) -> violet-bleu ;
 *   - ROSE d'Autowin (teinte 318-342 deg) -> rose du theme ;
 *   - NOIRS bleutes et noirs purs EN FOND (luminosite < 9 %) -> encre violette, meme opacite.
 * Rien d'autre : blancs, gris, verts, rouges et jaunes d'etat restent intacts.
 *
 * Regenerer apres une modification de style : node scripts/theme-nebuleuse-verre.mjs
 * Le fichier produit est importe AVANT theme-nebuleuse-verre.css, dont les regles ecrites a la
 * main gagnent donc a specificite egale.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import postcss from 'postcss'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
const SOURCES = ['src/renderer/src/components', 'src/renderer/src/assets']
// fix-ok: le nom du theme etait ecrit en dur (prefixe + fichier de sortie) ; mesure : sans argument la sortie nebuleuse-verre est identique octet par octet (cmp exit 0), avec nebuleuse-doree 0 #ff3d9a/#7b5cff (test 6/6).
// Deux themes partagent ce generateur : « nebuleuse-verre » (rose/violet, par defaut) et
// « nebuleuse-doree » (or et noir, conv-139). Choix : node scripts/theme-nebuleuse-verre.mjs [id]
const THEME = process.argv[2] === 'nebuleuse-doree' ? 'nebuleuse-doree' : 'nebuleuse-verre'
const DORE = THEME === 'nebuleuse-doree'
const SORTIE = `src/renderer/src/assets/theme-${THEME}.genere.css`
const PREFIXE = `:root[data-theme='${THEME}']`
// AskDecision.css garde son OR (conv-136, 2026-10-10 : « les blocs comme ASK qui demandent des
// actions utilisateur, mets-les en doré ») : le bloc qui attend l'utilisateur ressort du rose.
const EXCLUS = /theme-clair|theme-malvoyant|theme-nebuleuse-verre|theme-nebuleuse-doree|AskDecision.css/

/** L'or d'Autowin, tel qu'il est ecrit dans les feuilles (rgb sans alpha). */
const ORS = new Set([
  '212,169,79',
  '233,189,78',
  '227,186,85',
  '255,212,90',
  '212,175,55',
  '225,193,103',
  '154,111,16',
  '240,194,116',
  '221,173,74',
  '229,184,91',
  '218,184,94',
  '90,70,40',
  '255,220,115',
  '242,201,76',
  '244,204,104',
  '224,193,111',
  '217,183,104',
  '173,143,73',
  '195,157,85',
  '214,173,96',
  '230,195,131',
  '255,215,154',
  '228,199,123',
  '212,169,105',
  '201,162,74',
  '184,147,63',
  '155,123,51',
  '138,109,42',
  '233,196,106',
  '255,228,150',
  // Ors DECORATIFS releves un par un le 2026-10-09 (titres du Brain, onglets actifs de
  // l'Observatory, bouton « aller en bas », note d'autorite, cadre de fin de tour...).
  // Les jaunes d'ETAT voisins (avertissement, fichier modifie, nouvel essai, quota tendu,
  // doublon, seuil Jarvis, couleur choisie par l'utilisateur) n'y sont PAS, a dessein.
  '234,209,139',
  '240,230,210',
  '201,167,93',
  '226,189,85',
  '240,217,140',
  '198,165,76',
  '235,200,106',
  '255,240,200',
  '217,189,120',
  '231,207,150',
  '215,180,92',
  '232,206,145',
  '255,226,163',
  '203,145,43',
  '137,91,23',
  '230,207,157',
  '255,211,111',
  '240,217,168',
  '217,183,104',
  '239,189,87',
  '216,183,101',
  '224,180,55',
  '216,178,106',
  '246,200,117',
  '242,201,76',
  '230,195,105'
])

const PROPRIETES_COULEUR =
  /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)(-color)?|border-color|border-image|outline|outline-color|box-shadow|text-shadow|fill|stroke|caret-color|text-decoration(-color)?|column-rule|filter|--[a-z0-9-]+)$/

function hexVersRgb(hex) {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  const n = (i) => parseInt(h.slice(i, i + 2), 16)
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
}

function rgbVersHsl({ r, g, b }) {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0)
  else if (max === G) h = (B - R) / d + 2
  else h = (R - G) / d + 4
  return { h: h * 60, s, l }
}

function hslVersRgb({ h, s, l }) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const t = (x) => {
    let v = x
    if (v < 0) v += 1
    if (v > 1) v -= 1
    if (v < 1 / 6) return p + (q - p) * 6 * v
    if (v < 1 / 2) return q
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6
    return p
  }
  const hh = h / 360
  return {
    r: Math.round(t(hh + 1 / 3) * 255),
    g: Math.round(t(hh) * 255),
    b: Math.round(t(hh - 1 / 3) * 255)
  }
}

const borne = (v, a, b) => Math.min(b, Math.max(a, v))

/** Rend la couleur transposee, ou null si elle n'appartient a aucune famille decorative. */
function transposer(rgb, enFond) {
  const cle = `${rgb.r},${rgb.g},${rgb.b}`
  const { h, s, l } = rgbVersHsl(rgb)
  if (DORE) return transposerDore(cle, h, s, l, enFond)
  if (ORS.has(cle)) {
    // L'or parait plus clair qu'un rose de meme luminosite HSL : on remonte d'un cran.
    return hslVersRgb({ h: 330, s: borne(s + 0.35, 0.75, 1), l: borne(l + 0.1, 0.18, 0.86) })
  }
  if (h >= 185 && h <= 212 && s >= 0.45 && l >= 0.18) {
    return hslVersRgb({ h: 250, s: borne(s, 0.6, 1), l: borne(l + 0.04, 0.2, 0.86) })
  }
  if (h >= 318 && h <= 342 && s >= 0.5 && l >= 0.2) {
    return hslVersRgb({ h: 330, s: 1, l })
  }
  if (enFond && l < 0.09) {
    // Encre violette du theme (#0b0a18 = 11,10,24), a l'opacite d'origine.
    return { r: 14, g: 11, b: 32 }
  }
  return null
}

/** Variante or et noir : l'or reste, cyans et roses passent a l'or, fonds au noir chaud. */
function transposerDore(cle, h, s, l, enFond) {
  if (ORS.has(cle)) return null
  if (h >= 185 && h <= 212 && s >= 0.45 && l >= 0.18) {
    return hslVersRgb({ h: 43, s: borne(s, 0.6, 0.85), l: borne(l, 0.3, 0.82) })
  }
  if (h >= 318 && h <= 342 && s >= 0.5 && l >= 0.2) {
    return hslVersRgb({ h: 43, s: 0.72, l: borne(l, 0.3, 0.8) })
  }
  if (enFond && l < 0.09) return { r: 12, g: 10, b: 6 }
  return null
}

const COULEUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/g

function transposerValeur(valeur, enFond) {
  let change = false
  const sortie = valeur.replace(COULEUR, (brut) => {
    let rgb
    if (brut.startsWith('#')) {
      if (![4, 5, 7, 9].includes(brut.length)) return brut
      rgb = hexVersRgb(brut)
    } else {
      const n = brut.match(/[\d.]+/g).map(Number)
      rgb = { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }
    }
    const t = transposer(rgb, enFond)
    if (!t) return brut
    change = true
    return rgb.a === 1 ? `rgb(${t.r}, ${t.g}, ${t.b})` : `rgba(${t.r}, ${t.g}, ${t.b}, ${rgb.a})`
  })
  return change ? sortie : null
}

function prefixer(selecteur) {
  const s = selecteur.trim()
  // Les regles d'un AUTRE theme ou du mode clair ne nous regardent pas.
  if (/:root\[|data-base|data-theme/.test(s)) return null
  if (/^(html|:root)\b/.test(s)) return s.replace(/^(html|:root)/, PREFIXE)
  return `${PREFIXE} ${s}`
}

function fichiers() {
  return SOURCES.flatMap((dossier) =>
    readdirSync(join(RACINE, dossier))
      .filter((f) => f.endsWith('.css') && !EXCLUS.test(f))
      .sort()
      .map((f) => join(RACINE, dossier, f))
  )
}

export function generer() {
  const blocs = []
  let regles = 0
  let declarations = 0
  for (const fichier of fichiers()) {
    const racine = postcss.parse(readFileSync(fichier, 'utf8'), { from: fichier })
    const sortie = postcss.root()
    racine.walkRules((regle) => {
      // Les images-cles n'ont pas de selecteur a prefixer : on les laisse.
      if (regle.parent?.type === 'atrule' && /keyframes/i.test(regle.parent.name)) return
      const selecteurs = regle.selectors.map(prefixer).filter(Boolean)
      if (selecteurs.length === 0) return
      const nouvelles = []
      regle.walkDecls((decl) => {
        if (decl.parent !== regle) return
        const prop = decl.prop.toLowerCase()
        if (!PROPRIETES_COULEUR.test(prop)) return
        const enFond = /^background/.test(prop)
        const valeur = transposerValeur(decl.value, enFond)
        if (valeur)
          nouvelles.push(
            postcss.decl({ prop: decl.prop, value: valeur, important: decl.important })
          )
      })
      if (nouvelles.length === 0) return
      const copie = postcss.rule({ selectors: selecteurs })
      copie.append(nouvelles)
      // Une regle sous @media / @supports garde son enveloppe.
      let cible = copie
      for (let p = regle.parent; p && p.type === 'atrule'; p = p.parent) {
        const enveloppe = postcss.atRule({ name: p.name, params: p.params })
        enveloppe.append(cible)
        cible = enveloppe
      }
      sortie.append(cible)
      regles += 1
      declarations += nouvelles.length
    })
    if (sortie.nodes.length > 0) {
      blocs.push(
        `/* ---- ${relative(RACINE, fichier).replace(/\\/g, '/')} ---- */\n${sortie.toString()}`
      )
    }
  }
  if (DORE) {
    const entete = `/* FICHIER GENERE par scripts/theme-nebuleuse-verre.mjs nebuleuse-doree -- ne pas modifier.
   Theme « Nebuleuse doree » : cyan et rose -> or, noirs de fond -> noir chaud.
   ${regles} regles, ${declarations} declarations. */\n\n`
    return { css: entete + blocs.join('\n\n') + '\n', regles, declarations }
  }
  const entete = `/* FICHIER GENERE par scripts/theme-nebuleuse-verre.mjs -- ne pas modifier a la main.
   Theme « Nebuleuse de verre » : couleurs ecrites en dur, transposees (or -> rose,
   cyan -> violet, rose -> rose du theme, noirs de fond -> encre violette).
   ${regles} regles, ${declarations} declarations. Regenerer : node scripts/theme-nebuleuse-verre.mjs */\n\n`
  return { css: entete + blocs.join('\n\n') + '\n', regles, declarations }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { css, regles, declarations } = generer()
  writeFileSync(join(RACINE, SORTIE), css)
  console.log(`${SORTIE} : ${regles} regles, ${declarations} declarations`)
  if (DORE) {
    writeFileSync(join(RACINE, 'src/renderer/src/assets/theme-nebuleuse-doree.css'), genererMainDoree())
    console.log(`theme-nebuleuse-doree.css : derive de theme-nebuleuse-verre.css`)
  }
}



/**
 * Nebuleuse doree = la feuille ecrite a la main de Nebuleuse de verre (une seule source, les
 * deux themes ne divergent pas), recolorée : roses -> or, violets/bleus -> bronze, textes lilas
 * -> ivoire, encres violettes -> noir chaud. Verts, rouges et ambres d'etat restent.
 * La zone de saisie reprend le degrade or clair -> noir (« B1 plus clair », conv-139).
 */
export function genererMainDoree() {
  const source = readFileSync(join(RACINE, 'src/renderer/src/assets/theme-nebuleuse-verre.css'), 'utf8')
  const recolorer = (rgb) => {
    const { h, s, l } = rgbVersHsl(rgb)
    if (h >= 300 && h <= 345 && s >= 0.5) return hslVersRgb({ h: 43, s: 0.75, l: borne(l, 0.3, 0.88) })
    if (h >= 215 && h < 300 && s >= 0.35 && l >= 0.15) return hslVersRgb({ h: 36, s: 0.6, l: borne(l * 0.85, 0.25, 0.8) })
    if (h >= 215 && h < 300 && l >= 0.6) return hslVersRgb({ h: 40, s, l })
    if (h >= 215 && h < 300 && l < 0.2) return hslVersRgb({ h: 38, s: borne(s, 0, 0.35), l })
    return null
  }
  const css = source
    .replace(
      /linear-gradient\(315deg, rgba\(255, 61, 154, 0\.32\), rgba\(10, 8, 18, 0\.92\) 58%\)/,
      'linear-gradient(135deg, rgba(240, 207, 122, 0.42), rgba(10, 8, 6, 0.92) 58%)'
    )
    .replace(COULEUR, (brut) => {
      if (brut.startsWith('#') && ![4, 5, 7, 9].includes(brut.length)) return brut
      const rgb = brut.startsWith('#')
        ? hexVersRgb(brut)
        : (() => {
            const n = brut.match(/[\d.]+/g).map(Number)
            return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }
          })()
      const t = recolorer(rgb)
      if (!t) return brut
      return rgb.a === 1 ? `rgb(${t.r}, ${t.g}, ${t.b})` : `rgba(${t.r}, ${t.g}, ${t.b}, ${rgb.a})`
    })
    .replaceAll("data-theme='nebuleuse-verre'", "data-theme='nebuleuse-doree'")
  return `/* FICHIER GENERE par scripts/theme-nebuleuse-verre.mjs nebuleuse-doree, depuis
   theme-nebuleuse-verre.css -- ne pas modifier a la main (modifier la source, puis regenerer). */\n\n${css}`
}
