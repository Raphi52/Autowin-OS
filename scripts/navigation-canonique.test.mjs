import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { racineDepot } from './racine-depot.mjs'

/**
 * La sonde `autowin-cdp-proof.mjs --verify-navigation` attend, pour chaque destination, un TEXTE
 * et un `data-testid`. Ces reperes VIEILLISSENT avec l'interface : le 2026-09-06, la destination
 * `worktree` attendait encore « Aucune copie en cours » et `wt-view`, deux reperes qu'aucun
 * fichier de `src/` ne rend plus. La sonde etait donc ROUGE EN PERMANENCE — un instrument qui
 * crie tout le temps ne signale plus rien.
 *
 * Ce test relit les reperes de la sonde et exige qu'ils existent ENCORE dans `src/`.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retirer un libelle de l'interface sans mettre la sonde
 * a jour — ou ecrire dans la sonde un repere qui n'a jamais existe.
 */
function destinationsCanoniques() {
  const source = readFileSync(join(racineDepot(), 'scripts', 'autowin-cdp-proof.mjs'), 'utf8')
  const debut = source.indexOf('const canonicalDestinations = [')
  const fin = source.indexOf('\n]', debut)
  expect(debut).toBeGreaterThan(-1)
  const bloc = source.slice(source.indexOf('[', debut), fin + 2)
  return new Function(`return ${bloc}`)()
}

function texteDeSrc() {
  const racine = resolve(racineDepot(), 'src')
  let texte = ''
  const parcourir = (dossier) => {
    for (const nom of readdirSync(dossier)) {
      const chemin = join(dossier, nom)
      if (statSync(chemin).isDirectory()) parcourir(chemin)
      else if (/\.(tsx?|css)$/.test(nom)) texte += readFileSync(chemin, 'utf8')
    }
  }
  parcourir(racine)
  return texte
}

describe('navigation canonique — les reperes de la sonde existent encore', () => {
  const destinations = destinationsCanoniques()
  const src = texteDeSrc()

  it('lit bien les neuf destinations de la sonde', () => {
    expect(destinations.length).toBe(9)
    expect(destinations.map((d) => d.id)).toContain('worktree')
  })

  it('chaque texte attendu est encore rendu quelque part dans src/', () => {
    const fantomes = destinations
      .filter((d) => !src.includes(d.expectedText))
      .map((d) => `${d.id} attend « ${d.expectedText} »`)
    expect(fantomes).toEqual([])
  })

  it('chaque data-testid attendu existe encore dans src/', () => {
    const testids = []
    for (const d of destinations) {
      for (const selecteur of [d.navSelector, d.viewSelector, d.nestedSelector]) {
        const m = /data-testid="([^"]+)"/.exec(selecteur ?? '')
        if (m) testids.push([d.id, m[1]])
      }
    }
    // Les `nav-*` ne sont JAMAIS ecrits en clair : `App.tsx` les construit par `nav-${it.id}` a
    // partir d'APP_DESTINATIONS. Pour ceux-la, la preuve d'existence est l'entree du catalogue.
    const catalogue = readFileSync(join(racineDepot(), 'src', 'shared', 'navigation.ts'), 'utf8')
    const fantomes = testids
      .filter(([, id]) =>
        id.startsWith('nav-')
          ? !catalogue.includes(`'${id.slice('nav-'.length)}'`)
          : !src.includes(`"${id}"`)
      )
      .map(([destination, id]) => `${destination} → ${id}`)
    expect(fantomes).toEqual([])
  })
})
