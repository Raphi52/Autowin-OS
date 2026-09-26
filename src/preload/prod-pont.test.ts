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

describe('pont preload des règles de surveillance (task-manager)', () => {
  // fix-ok: mesure 2026-09-26 (run-0940cc5e0fcd-1) — sans les 8 lignes `taskManagerSetSender` /
  // `taskManagerTeamsConnect` de index.ts, `npm run typecheck` rendait 0 et TaskManagerView.test.tsx
  // 31/31 (il simule window.api) : l'interrupteur par personne et « Connecter Teams » auraient appelé
  // une fonction inexistante dans l'app, sans aucun rouge. Même faute silencieuse que `prodPorteEtat`.
  it('implémente TOUT ce que le fichier de types déclare', () => {
    const motif = /^\s{2}(taskManager[A-Za-z]+|onTaskManager[A-Za-z]+):/gm
    const declares = noms('index.d.ts', motif)
    expect(declares.length).toBeGreaterThan(0)
    expect(noms('index.ts', motif)).toEqual(declares)
  })
})
