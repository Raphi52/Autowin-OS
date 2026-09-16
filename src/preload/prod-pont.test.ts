import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * LE PONT DE PRODUCTION DOIT EXISTER POUR DE VRAI.
 *
 * Défaut mesuré le 2026-09-16 dans cette session : `prodPorteEtat` était déclaré dans
 * `index.d.ts` mais ABSENT de `index.ts`. Le typage passait au vert — c'est le fichier de types qui
 * décrit le pont, pas le pont — et l'écran de réglages aurait appelé une fonction inexistante au
 * premier affichage. Une déclaration n'est pas une implémentation.
 *
 * Ce test compare les deux fichiers sur les seules fonctions de production (`prod…`). Il ne remplace
 * pas un test de bout en bout ; il attrape la faute exacte qui est arrivée, et elle est silencieuse.
 */
function noms(fichier: string, motif: RegExp): string[] {
  const texte = readFileSync(join(__dirname, fichier), 'utf8')
  return [...texte.matchAll(motif)].map((m) => m[1] as string).sort()
}

describe('pont preload de la protection de production', () => {
  it('implémente TOUT ce que le fichier de types déclare', () => {
    const declares = noms('index.d.ts', /^\s{2}(prod[A-Za-z]+|onProd[A-Za-z]+):/gm)
    const implementes = noms('index.ts', /^\s{2}(prod[A-Za-z]+|onProd[A-Za-z]+):/gm)
    expect(declares.length).toBeGreaterThan(0)
    expect(implementes).toEqual(declares)
  })
})
