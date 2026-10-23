/**
 * VARIANTES ECRASEES PAR UNE COUCHE DE THEME GENEREE (conv-1105, 2026-10-23).
 *
 * Les couches de Claude (Ninja, Vanilla) ne recopient une regle que si sa couleur est transposee, et
 * la recopient avec le prefixe du theme : `:root[data-theme='ninja-claude'] .x` (+0,2,0) ou
 * `:root[data-theme='vanilla-claude'][data-base='clair'] .x` (+0,1,0 sur sa source claire). Une
 * VARIANTE plus precise de la meme cible (`.x[data-phase='scout']`, `.x:hover`, `.x.is-on`), dont la
 * couleur n'a pas ete transposee, n'a alors aucune copie : la copie de la regle generale la bat, et
 * la variante perd sa couleur. Mesure : scout, build et judge du deroule de l'Observatory, gris sous
 * Ninja (captures obs-1105-ninja-*.png).
 *
 * `variantesEcrasees(theme)` rend chaque cas : la variante (fichier, selecteur, propriete, valeur
 * perdue) et la regle de la couche qui la bat. Aucune lecture du DOM : la cascade est rejouee sur
 * les feuilles, avec l'ordre d'import d'App.tsx (composants d'abord, couches des themes ensuite,
 * feuille ecrite a la main en dernier) — a priorite egale, la couche gagne sur un composant.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const RACINE = fileURLToPath(new URL('..', import.meta.url))
const SOURCES = ['src/renderer/src/components', 'src/renderer/src/assets']
const PROPRIETES_COULEUR =
  /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)(-color)?|border-color|border-image|outline|outline-color|box-shadow|text-shadow|fill|stroke|caret-color|text-decoration(-color)?|column-rule|filter|--[a-z0-9-]+)$/

/** Les themes verifies : leur base (data-base) et leurs deux feuilles. */
export const THEMES_CLAUDE = {
  'ninja-claude': { base: 'sombre' },
  'vanilla-claude': { base: 'clair' }
}

/** Decoupe `liste` aux `sep` de premier niveau (hors parentheses et crochets). */
function couper(liste, estSeparateur) {
  const morceaux = []
  let profondeur = 0
  let courant = ''
  for (let i = 0; i < liste.length; i += 1) {
    const c = liste[i]
    if (c === '(' || c === '[') profondeur += 1
    if (c === ')' || c === ']') profondeur -= 1
    const sep = profondeur === 0 ? estSeparateur(liste, i) : 0
    if (sep) {
      morceaux.push(courant)
      courant = ''
      i += sep - 1
    } else courant += c
  }
  morceaux.push(courant)
  return morceaux
}

/** Les selecteurs simples d'un compose : `.a[data-x='y']:hover` -> ['.a', "[data-x='y']", ':hover']. */
function simples(compose) {
  const sortie = []
  let i = 0
  while (i < compose.length) {
    const debut = i
    const c = compose[i]
    if (c === '[') {
      let profondeur = 0
      for (; i < compose.length; i += 1) {
        if (compose[i] === '[') profondeur += 1
        if (compose[i] === ']' && --profondeur === 0) break
      }
      i += 1
    } else {
      i += c === ':' && compose[i + 1] === ':' ? 2 : 1
      while (i < compose.length && /[\w\-\\]/.test(compose[i])) i += 1
      if (compose[i] === '(') {
        let profondeur = 0
        for (; i < compose.length; i += 1) {
          if (compose[i] === '(') profondeur += 1
          if (compose[i] === ')' && --profondeur === 0) break
        }
        i += 1
      }
    }
    sortie.push(compose.slice(debut, i).replace(/"/g, "'"))
  }
  return sortie
}

const PSEUDO_ELEMENTS_ANCIENS = /^:(before|after|first-line|first-letter)$/

/** Specificite [a, b, c] d'un selecteur complexe (`:where` = 0, `:is/:not/:has` = sa branche la plus lourde). */
export function specificite(selecteur) {
  const total = [0, 0, 0]
  for (const compose of composes(selecteur).composes) {
    for (const simple of simples(compose)) {
      const ajout = specificiteSimple(simple)
      for (let k = 0; k < 3; k += 1) total[k] += ajout[k]
    }
  }
  return total
}

function specificiteSimple(simple) {
  if (simple === '*' || simple === '') return [0, 0, 0]
  if (simple.startsWith('#')) return [1, 0, 0]
  if (simple.startsWith('.') || simple.startsWith('[')) return [0, 1, 0]
  if (simple.startsWith('::') || PSEUDO_ELEMENTS_ANCIENS.test(simple)) return [0, 0, 1]
  if (simple.startsWith(':')) {
    const m = /^:([\w-]+)\((.*)\)$/s.exec(simple)
    if (!m) return [0, 1, 0]
    if (m[1] === 'where') return [0, 0, 0]
    if (['is', 'not', 'has', 'matches'].includes(m[1])) {
      return couper(m[2], (s, i) => (s[i] === ',' ? 1 : 0))
        .map((branche) => specificite(branche.trim()))
        .reduce((a, b) => (comparer(a, b) >= 0 ? a : b), [0, 0, 0])
    }
    return [0, 1, 0]
  }
  return [0, 0, 1]
}

const comparer = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** Composes et combinateurs d'un selecteur complexe. */
function composes(selecteur) {
  const s = selecteur
    .trim()
    .replace(/\s*([>+~])\s*/g, '$1')
    .replace(/\s+/g, ' ')
  const liste = []
  const combinateurs = []
  let profondeur = 0
  let courant = ''
  for (const c of s) {
    if (c === '(' || c === '[') profondeur += 1
    if (c === ')' || c === ']') profondeur -= 1
    if (profondeur === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) {
      liste.push(courant)
      combinateurs.push(c)
      courant = ''
    } else courant += c
  }
  liste.push(courant)
  return { composes: liste, combinateurs }
}

/**
 * Le CONTEXTE d'un selecteur (son compose `:root`/`html` de tete) : s'applique-t-il dans `theme` ?
 * Rend `null` s'il ne s'applique pas, sinon le selecteur sans ce contexte (sa CIBLE).
 */
function cibleDans(selecteur, theme) {
  const { base } = THEMES_CLAUDE[theme]
  const { composes: liste, combinateurs } = composes(selecteur)
  const tete = liste[0]
  if (!/^(:root|html)(?![\w-])/.test(tete)) {
    // Une condition de theme plus loin dans le selecteur : hors du perimetre de cette mesure.
    if (/data-theme|data-base/.test(selecteur)) return null
    return { cible: liste, combinateurs }
  }
  const reste = simples(tete).slice(1)
  for (const simple of reste) {
    const theme_ = /^\[data-theme='([^']+)'\]$/.exec(simple)
    if (theme_ && theme_[1] !== theme) return null
    const pasTheme = /^:not\(\[data-theme='([^']+)'\]\)$/.exec(simple)
    if (pasTheme && pasTheme[1] === theme) return null
    if (/^\[data-base='clair'\]$/.test(simple) && base !== 'clair') return null
    if (/^:not\(\[data-base='clair'\]\)$/.test(simple) && base === 'clair') return null
    if (
      /data-theme|data-base/.test(simple) &&
      !theme_ &&
      !pasTheme &&
      !/data-base='clair'/.test(simple)
    )
      return null
  }
  // Un contexte qui porte d'AUTRES conditions (mouvement reduit, plein ecran…) reste une cible a part.
  const autres = reste.filter((s) => !/data-theme|data-base/.test(s))
  if (autres.length > 0)
    return { cible: [`:root${autres.join('')}`, ...liste.slice(1)], combinateurs }
  if (liste.length === 1) return { cible: [':root'], combinateurs: [] }
  return { cible: liste.slice(1), combinateurs: combinateurs.slice(1) }
}

/**
 * `fine` vise un SOUS-ENSEMBLE des elements de `large` : les composes de `large` se retrouvent, dans
 * l'ordre et avec les memes combinateurs, a la FIN de `fine`, chacun au moins aussi precis ; ce qui
 * precede dans `fine` (`.panneau .x.is-on` pour `.x`) ne fait que restreindre. Prudent : une forme
 * non reconnue (composes intercales, `:is()`) n'est jamais vue comme variante.
 */
export function estVarianteOuEgale(fine, large) {
  const decalage = fine.cible.length - large.cible.length
  if (decalage < 0) return false
  if (fine.combinateurs.slice(decalage).join('') !== large.combinateurs.join('')) return false
  return large.cible.every((compose, i) => {
    const f = new Set(simples(fine.cible[i + decalage]))
    const l = simples(compose)
    const pe = (liste) =>
      [...liste].filter((s) => s.startsWith('::') || PSEUDO_ELEMENTS_ANCIENS.test(s))
    if (pe(f).join() !== pe(l).join()) return false
    return l.every((s) => f.has(s))
  })
}

const cle = (c) => c.cible.map((x, i) => (i ? c.combinateurs[i - 1] : '') + x).join('')

/**
 * RANG D'IMPORT d'une feuille, qui tranche a priorite egale : main.tsx importe main.css avant App ;
 * App.tsx importe ses composants (et donc leurs feuilles) AVANT ses feuilles d'assets
 * (app-shell, theme-modes, couches des themes, feuilles ecrites a la main), dans l'ordre ecrit.
 */
function rangsDImport() {
  const imports = (fichier) =>
    [
      ...readFileSync(join(RACINE, fichier), 'utf8').matchAll(/import '\.\/assets\/([^']+\.css)'/g)
    ].map((m) => m[1])
  const rangs = new Map()
  imports('src/renderer/src/main.tsx').forEach((nom, i) => rangs.set(nom, -100 + i))
  imports('src/renderer/src/App.tsx').forEach((nom, i) => rangs.set(nom, 100 + i))
  return rangs
}

/** Les feuilles lues sur le disque pour `theme` : composants et assets, avec leur origine et leur rang. */
export function feuillesDuDisque(theme) {
  const genere = `theme-${theme}.genere.css`
  const main = `theme-${theme}.css`
  const rangs = rangsDImport()
  const sortie = []
  for (const dossier of SOURCES) {
    for (const nom of readdirSync(join(RACINE, dossier)).sort()) {
      if (!nom.endsWith('.css')) continue
      const origine = nom === genere ? 'couche' : nom === main ? 'main' : 'source'
      const rang = dossier.endsWith('assets') ? (rangs.get(nom) ?? 0) : 0
      const fichier = `${dossier}/${nom}`
      sortie.push({ fichier, css: readFileSync(join(RACINE, fichier), 'utf8'), origine, rang })
    }
  }
  return sortie
}

/** Chaque declaration de couleur applicable dans `theme`, avec sa cible, son poids et son rang. */
function declarations(theme, feuilles) {
  const sortie = []
  for (const { fichier, css, origine, rang } of feuilles) {
    const racine = postcss.parse(css, { from: fichier })
    racine.walkRules((regle) => {
      if (regle.parent?.type === 'atrule' && /keyframes/i.test(regle.parent.name)) return
      const contextes = []
      for (let p = regle.parent; p && p.type === 'atrule'; p = p.parent)
        contextes.push(`@${p.name} ${p.params}`)
      for (const selecteur of regle.selectors) {
        const cible = cibleDans(selecteur, theme)
        if (!cible) continue
        regle.each((decl) => {
          if (decl.type !== 'decl' || !PROPRIETES_COULEUR.test(decl.prop.toLowerCase())) return
          sortie.push({
            fichier,
            ligne: decl.source?.start?.line ?? 0,
            origine,
            selecteur: selecteur.trim(),
            cible,
            cle: cle(cible),
            prop: decl.prop.toLowerCase(),
            valeur: decl.value.trim(),
            important: Boolean(decl.important),
            contexte: contextes.join(' '),
            poids: specificite(selecteur),
            rang,
            ordre: sortie.length
          })
        })
      }
    })
  }
  return sortie
}

/** Identite d'une declaration de source : ce que le generateur recopie, et ce que le test nomme. */
export const identite = (d) => `${d.fichier}|${d.ligne}|${d.prop}|${d.selecteur}`

/** a bat-il b dans la cascade ? (!important, poids, puis feuille importee plus tard, puis position). */
const bat = (a, b) =>
  a.important !== b.important
    ? a.important
      ? 1
      : -1
    : comparer(a.poids, b.poids) ||
      a.rang - b.rang ||
      (a.fichier === b.fichier ? a.ordre - b.ordre : 0)

function gagnante(candidates) {
  return candidates.reduce(
    (meilleure, d) => (!meilleure || bat(d, meilleure) > 0 ? d : meilleure),
    null
  )
}

/** Cle d'index d'une cible LARGE : un selecteur simple de son dernier compose, que toute variante porte. */
function cleIndex(cible) {
  const dernier = simples(cible.cible[cible.cible.length - 1])
  return dernier.find((s) => !s.startsWith(':')) ?? dernier[0] ?? '*'
}

/**
 * LES CAS DU PIEGE dans `theme`, sur ces `feuilles` : pour un ensemble d'elements (une cible, une
 * propriete, un contexte @media), la regle qui gagne SANS la couche generee est une regle de source,
 * et AVEC la couche c'est la copie d'une AUTRE regle. La copie d'une regle par elle-meme (meme cible,
 * meme contexte) est la transposition voulue, jamais un cas.
 */
export function analyser(theme, feuilles) {
  const toutes = declarations(theme, feuilles)
  const index = new Map()
  for (const d of toutes) {
    const parCle = index.get(d.prop) ?? new Map()
    index.set(d.prop, parCle)
    const k = cleIndex(d.cible)
    if (!parCle.has(k)) parCle.set(k, [])
    parCle.get(k).push(d)
  }
  const vus = new Set()
  const cas = new Map()
  for (const e of toutes) {
    const ensemble = `${e.prop}|${e.contexte}|${e.cle}`
    if (vus.has(ensemble)) continue
    vus.add(ensemble)
    const parCle = index.get(e.prop)
    const cles = new Set(simples(e.cible.cible[e.cible.cible.length - 1]))
    cles.add('*')
    // Les regles qui touchent TOUS ces elements dans ce contexte (@media…) : leurs generalisations.
    const enJeu = [...cles]
      .flatMap((k) => parCle.get(k) ?? [])
      .filter(
        (d) =>
          (d.contexte === e.contexte || d.contexte === '') && estVarianteOuEgale(e.cible, d.cible)
      )
    const avec = gagnante(enJeu)
    const sans = gagnante(enJeu.filter((d) => d.origine !== 'couche'))
    if (!avec || !sans || avec.origine !== 'couche' || sans.origine !== 'source') continue
    if (avec.cle === sans.cle && avec.contexte === sans.contexte) continue
    // Une gagnante d'origine qui ne l'emporte qu'a EGALITE parfaite avec une regle d'une autre feuille
    // de composant (ordre d'import inconnu) n'est pas un cas prouve : il est ecarte, jamais devine.
    const rivales = enJeu.filter((d) => d.origine !== 'couche' && d !== sans && d.cle !== sans.cle)
    if (rivales.some((d) => bat(sans, d) === 0)) continue
    cas.set(identite(sans), {
      identite: identite(sans),
      plusGenerale: estVarianteOuEgale(sans.cible, avec.cible),
      variante: `${sans.fichier}:${sans.ligne}`,
      selecteur: sans.selecteur,
      prop: sans.prop,
      valeurPerdue: sans.valeur,
      contexte: sans.contexte || undefined,
      battueePar: `${avec.fichier}:${avec.ligne}`,
      selecteurCouche: avec.selecteur,
      valeurImposee: avec.valeur
    })
  }
  return [...cas.values()]
}

/** Les cas du piege dans `theme`, sur les feuilles telles qu'elles sont sur le disque. */
export function variantesEcrasees(theme) {
  return analyser(theme, feuillesDuDisque(theme))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const theme of Object.keys(THEMES_CLAUDE)) {
    const cas = variantesEcrasees(theme)
    console.log(`== ${theme} : ${cas.length} variante(s) ecrasee(s)`)
    for (const c of cas)
      console.log(
        `  ${c.variante}  ${c.selecteur} { ${c.prop}: ${c.valeurPerdue} }${c.contexte ? `  [${c.contexte}]` : ''}\n    battue par ${c.battueePar}  ${c.selecteurCouche} { ${c.valeurImposee} }`
      )
  }
}
