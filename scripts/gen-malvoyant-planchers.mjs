// Genere src/renderer/src/assets/theme-malvoyant-planchers.css.
//
// Pourquoi : les ecrans ecrivent leurs tailles de texte en PIXELS FIXES (~450 declarations de 7 a
// 11 px, mesure du 2026-09-22, conv-785). Le « font-size: 1.25em » des themes malvoyants ne les
// atteint pas : ces libelles restaient minuscules. Plutot qu'une liste a la main qui vieillit a
// chaque nouvel ecran, on releve TOUTES ces declarations et on leur pose un plancher, seulement sous
// :root[data-theme^='malvoyant-']. Le test theme-malvoyant-planchers.test.ts refuse un fichier perime.
//
// Usage : node scripts/gen-malvoyant-planchers.mjs [--check]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import postcss from 'postcss'

export const PLANCHER_PX = 13
const SEUIL_PX = 12
const RACINE = 'src/renderer/src'
const SORTIE = join(RACINE, 'assets/theme-malvoyant-planchers.css')
const PREFIXE = ":root[data-theme^='malvoyant-']"

const fichiersCss = () => {
  const out = []
  for (const dir of ['components', 'assets']) {
    for (const f of readdirSync(join(RACINE, dir)).sort()) {
      if (f.endsWith('.css') && f !== 'theme-malvoyant-planchers.css') out.push(join(RACINE, dir, f))
    }
  }
  return out
}

const prefixer = (sel) => {
  const s = sel.trim()
  if (/^:root\b/.test(s)) return s.replace(/^:root/, PREFIXE)
  if (/^(html|body)\b/.test(s)) return null
  return `${PREFIXE} ${s}`
}

/** Une couleur NEUTRE (gris) ecrite en dur : saturation faible. Le blanc pur est exclu — il porte
 *  souvent un texte pose sur un bouton colore. Rend false pour var(), couleurs nommees, etc. */
export function estGris(valeur) {
  const v = valeur.trim().toLowerCase()
  let r, g, b
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    ;[r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  } else if ((m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(v))) {
    ;[r, g, b] = m.slice(1, 4).map(Number)
  } else return false
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (min >= 250) return false
  const sat = max === 0 ? 0 : (max - min) / max
  return sat < 0.3
}

export function genererPlanchers() {
  const blocs = []
  for (const fichier of fichiersCss()) {
    const racine = postcss.parse(readFileSync(fichier, 'utf8'))
    const selecteurs = new Set()
    const gris = new Set()
    racine.walkDecls('color', (decl) => {
      if (!estGris(decl.value)) return
      const regle = decl.parent
      if (regle?.type !== 'rule') return
      for (const sel of regle.selectors) {
        if (/data-theme|data-base/.test(sel)) continue
        const p = prefixer(sel)
        if (p) gris.add(p)
      }
    })
    racine.walkDecls('font-size', (decl) => {
      const m = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim())
      if (!m || Number(m[1]) >= SEUIL_PX) return
      const regle = decl.parent
      if (regle?.type !== 'rule' || regle.parent?.type === 'atrule' && /keyframes/.test(regle.parent.name)) return
      for (const sel of regle.selectors) {
        // Deja cible par un theme precis : on n'ecrase pas ses choix.
        if (/data-theme|data-base/.test(sel)) continue
        const p = prefixer(sel)
        if (p) selecteurs.add(p)
      }
    })
    const chemin = relative(RACINE, fichier).split('\\').join('/')
    if (selecteurs.size) {
      blocs.push(`/* ${chemin} — tailles */\n${[...selecteurs].join(',\n')} {\n  font-size: ${PLANCHER_PX}px;\n}`)
    }
    if (gris.size) {
      blocs.push(`/* ${chemin} — gris en dur */\n${[...gris].join(',\n')} {\n  color: var(--text);\n}`)
    }
  }
  return (
    `/* GENERE par scripts/gen-malvoyant-planchers.mjs — ne pas editer a la main.\n` +
    `   Plancher de ${PLANCHER_PX}px pour tout texte ecrit sous ${SEUIL_PX}px, et texte plein pour tout gris ecrit en dur, themes malvoyants seulement. */\n\n` +
    blocs.join('\n\n') +
    '\n'
  )
}

if (process.argv[1]?.endsWith('gen-malvoyant-planchers.mjs')) {
  const attendu = genererPlanchers()
  if (process.argv.includes('--check')) {
    const actuel = readFileSync(SORTIE, 'utf8')
    if (actuel !== attendu) {
      console.error('theme-malvoyant-planchers.css est perime : node scripts/gen-malvoyant-planchers.mjs')
      process.exit(1)
    }
  } else {
    writeFileSync(SORTIE, attendu)
    console.log(`ecrit ${SORTIE}`)
  }
}
