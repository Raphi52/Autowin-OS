import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * GARDE-FOU : sous `:has()`, la cible finale d'un sélecteur se vise par une classe, un id ou un
 * attribut — jamais par une balise nue (`span`, `button`) ni par `*`.
 *
 * Mesure du 2026-10-28 (conv-1229) : l'interface s'est rechargée seule à 18:31. Le battement de
 * la fenêtre avait vu 15 s de silence pendant que l'utilisateur tapait un message : chaque lettre
 * coûtait ≈ 220 ms de recalcul de styles forcé (trace « long-animation-frame » de la fenêtre
 * réelle). Trace Chromium dans une copie cachée : 331 éléments restylés par frappe sur 501, 4 sans
 * aucune règle `:has()`, ≈ 12 avec n'importe laquelle SAUF deux, chacune à ≈ 220 :
 *   - `.home-notices li:has(> .home-notices__acquitter) > button:first-child` (conv-1225) ;
 *   - `… .msg--rail:has(~ .msg.assistant.msg--rail) .artifact-pile__tranches > span` (conv-1199).
 * Pourquoi : Chromium range la cible finale de TOUTES les règles `:has()` dans UN SEUL ensemble
 * d'invalidation. Le cadre `.shell` est lui-même ancre d'un `:has()` (rail replié) : React réécrit
 * le texte de la saisie à chaque frappe, Chromium réévalue ce `:has()`, et applique l'ensemble
 * partagé à toute l'app — donc tous les `span` et tous les `button`. Une classe n'y fait entrer que
 * les éléments qui la portent.
 */

const RACINE_RENDERER = fileURLToPath(new URL('..', import.meta.url))

/** Coupe au niveau 0 (hors parenthèses, crochets et guillemets) selon `estSeparateur`. */
function couperAuNiveauZero(texte: string, estSeparateur: (c: string) => boolean): string[] {
  const morceaux: string[] = []
  let profondeur = 0
  let guillemet: string | null = null
  let courant = ''
  for (const c of texte) {
    if (guillemet) {
      courant += c
      if (c === guillemet) guillemet = null
      continue
    }
    if (c === '"' || c === "'") guillemet = c
    else if (c === '(' || c === '[') profondeur++
    else if (c === ')' || c === ']') profondeur--
    if (profondeur === 0 && estSeparateur(c)) {
      morceaux.push(courant)
      courant = ''
      continue
    }
    courant += c
  }
  morceaux.push(courant)
  return morceaux
}

/** Le dernier composé d'un sélecteur complexe : ce qui suit le dernier combinateur de niveau 0. */
function dernierCompose(selecteur: string): string {
  const parties = couperAuNiveauZero(selecteur.trim(), (c) => /[\s>+~]/.test(c)).filter(
    (p) => p.trim() !== ''
  )
  return (parties[parties.length - 1] ?? '').trim()
}

/** Le composé porte-t-il, au niveau 0, une classe, un id ou un attribut ? */
function composeCible(compose: string): boolean {
  const niveauZero = couperAuNiveauZero(compose, () => false)[0]
  let profondeur = 0
  for (const c of niveauZero) {
    if (c === '(') profondeur++
    else if (c === ')') profondeur--
    else if (profondeur === 0 && (c === '.' || c === '#' || c === '[')) return true
  }
  // `:is(...)` / `:where(...)` en tête : ciblé si CHACUN de ses arguments l'est. `[\s\S]` et pas
  // `.` : une liste écrite sur plusieurs lignes garde ses retours à la ligne dans le sélecteur.
  const liste = /^:(?:is|where)\(([\s\S]*)\)/.exec(compose)
  if (liste) {
    return couperAuNiveauZero(liste[1], (c) => c === ',').every((arg) =>
      composeCible(dernierCompose(arg))
    )
  }
  return false
}

/**
 * Un sélecteur (sans virgule de niveau 0) fait-il entrer une balise nue dans l'ensemble
 * d'invalidation partagé de `:has()` ? Seul compte un `:has()` placé AVANT le dernier composé : un
 * `:has()` dans le dernier composé ne vise que l'élément qui le porte.
 */
function cibleNueSousHas(selecteur: string): boolean {
  if (!selecteur.includes(':has(')) return false
  const dernier = dernierCompose(selecteur)
  if (dernier.includes(':has(')) return false
  return !composeCible(dernier)
}

function feuillesCss(dossier: string): string[] {
  const sortie: string[] = []
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) sortie.push(...feuillesCss(chemin))
    else if (nom.endsWith('.css')) sortie.push(chemin)
  }
  return sortie
}

describe('cibleNueSousHas — la règle elle-même', () => {
  it('refuse les deux sélecteurs qui gelaient la saisie le 28/10', () => {
    expect(
      cibleNueSousHas('.home-notices li:has(> .home-notices__acquitter) > button:first-child')
    ).toBe(true)
    expect(
      cibleNueSousHas(
        ":root[data-theme='nebuleuse-verre'] .msg.assistant.msg--rail:has(~ .msg.assistant.msg--rail) .artifact-pile__tranches > span"
      )
    ).toBe(true)
    expect(cibleNueSousHas('.a:has(.b) *')).toBe(true)
    expect(cibleNueSousHas('.a:has(.b) :is(.c, span)')).toBe(true)
  })

  it('laisse passer une cible classée, et un :has() posé sur la cible elle-même', () => {
    expect(cibleNueSousHas('.shell:has(.rail.is-collapsed) .main')).toBe(false)
    expect(cibleNueSousHas('.shell:has(.rail.is-collapsed)::before')).toBe(false)
    expect(cibleNueSousHas('.a:has(.b) > .c:first-child')).toBe(false)
    expect(cibleNueSousHas('.a:has(.b) :is(.c > summary .d, .e .d)::before')).toBe(false)
    expect(
      cibleNueSousHas('.a:has(.b)\n  :is(\n    .c > summary .d,\n    .e .d\n  )::before')
    ).toBe(false)
    expect(cibleNueSousHas('.x .rail-noeud:not(:has(~ .rail-noeud:not(:empty)))::before')).toBe(
      false
    )
    expect(cibleNueSousHas('.a:has(.b) [data-x="1"]')).toBe(false)
    expect(cibleNueSousHas('.home-notices li > button:first-child:not(:last-child)')).toBe(false)
  })
})

describe('feuilles du renderer — aucune cible nue sous :has()', () => {
  it('aucune règle :has() ne vise une balise nue ni *', () => {
    const fautifs: string[] = []
    for (const fichier of feuillesCss(RACINE_RENDERER)) {
      postcss.parse(readFileSync(fichier, 'utf8')).walkRules((regle) => {
        for (const selecteur of regle.selectors) {
          if (cibleNueSousHas(selecteur)) {
            const ligne = regle.source?.start?.line ?? 0
            fautifs.push(
              `${fichier.slice(RACINE_RENDERER.length)}:${ligne} ${selecteur.replace(/\s+/g, ' ')}`
            )
          }
        }
      })
    }
    expect(fautifs).toEqual([])
  })
})
