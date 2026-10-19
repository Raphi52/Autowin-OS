import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * LE DÉFAUT, mesuré le 2026-08-24 : `prefers-reduced-motion: reduce` coupait TOUT le décor d'accueil
 * — aucune boucle de rendu, parallaxe curseur annulée, une seule image figée. Sur la machine de
 * l'utilisateur, où `SPI_GETCLIENTAREAANIMATION` valait `False`, il demandait un décor, l'agent le
 * livrait, les tests passaient… et l'écran restait muet. Il en concluait que ses demandes échouaient.
 *
 * POURQUOI UN TEST DE CONTRAT SUR LE SOURCE, et pas un test de comportement. La garantie vit dans un
 * effet React qui exige WebGL : sous happy-dom, `createDecorScene` rend `null` et l'effet sort avant
 * d'installer quoi que ce soit. Un test de comportement ne pourrait donc rien observer. Ce dépôt
 * emploie déjà cet idiome là où la garantie est structurelle (`security-critical-fixes.test.ts`,
 * `chat-ipc-contract.test.ts`) — on le reprend plutôt que d'inventer une troisième façon.
 *
 * LA VITESSE, ELLE, EST PROUVÉE PAR UN TEST DE COMPORTEMENT (`DecorDeFond.vitesse.test.tsx`, préférence
 * active, scène factice) : depuis le 2026-10-19 (conv-1018), la préférence ne ralentit plus le décor.
 * Ce test-ci empêche seulement qu'on revienne au tout-ou-rien sans s'en apercevoir.
 */

/*
 * LA CIBLE A DEMENAGE le 2026-08-24 : le decor est passe de `HomeView.tsx` a `DecorDeFond.tsx`, en
 * devenant le fond de TOUTE l'application (l'utilisateur demandait « tout remplacer par du 3d », et
 * un decor possede par l'Accueil laissait les autres vues sur un PNG plat). Ce test suit le code
 * plutot que de rester braque sur un fichier ou la garantie ne vit plus -- un test qui surveille le
 * mauvais fichier passe au vert en ne verifiant rien.
 */
const source = readFileSync(join(__dirname, 'DecorDeFond.tsx'), 'utf8')

describe('« mouvement réduit » réduit le mouvement, il n’efface pas le décor', () => {
  it('ne conditionne PAS la boucle de rendu à la préférence', () => {
    // La forme exacte qui a causé le défaut. La réintroduire rendrait le décor invisible pour tout
    // utilisateur ayant désactivé les animations — sans qu'aucun test de rendu ne le voie.
    expect(source).not.toMatch(/if\s*\(\s*!reduceMotion\s*\)\s*frame\s*=\s*requestAnimationFrame/)
  })

  it('lance bien une boucle de rendu, inconditionnellement', () => {
    // Bord inverse : supprimer la boucle « pour économiser » retirerait la parallaxe à tout le monde.
    expect(source).toMatch(/frame\s*=\s*requestAnimationFrame\(draw\)/)
  })

  it('transmet toujours le regard du curseur à la scène, sans le neutraliser', () => {
    // C'est `{ x: 0, y: 0 }` en second argument qui annulait la parallaxe. Le regard doit passer.
    expect(source).toMatch(/scene\.render\(.*,\s*look\s*\)/)
    expect(source).not.toMatch(/scene\.render\([^)]*reduceMotion\s*\?\s*\{\s*x:\s*0,\s*y:\s*0\s*\}/)
  })

  it('ni FIGE (conv-1476) ni RALENTI (conv-1018) : le temps est l horloge réelle', () => {
    // Figé, le nuage restait immobile (« le nuage est statique »). Ralenti d'un facteur 0,25, l'avenue
    // défilait 4 fois moins vite (« le fond d'écran 3d de l'accueil défile super lentement »). Décision
    // de l'utilisateur le 2026-10-19 : vitesse normale, quel que soit le réglage Windows. La preuve
    // de comportement vit dans `DecorDeFond.vitesse.test.tsx` ; ici, la forme du source.
    expect(source).toMatch(/scene\.render\(\s*time\s*\/\s*1000\s*,\s*look\s*\)/)
    // La préférence n'est plus LUE par le décor : rien ne peut donc plus en dériver un ralenti.
    expect(source).not.toMatch(/matchMedia\(/)
  })
})
