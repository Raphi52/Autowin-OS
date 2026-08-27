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
 * LE COMPORTEMENT, LUI, EST VÉRIFIÉ HORS MODÈLE, par pilotage CDP avec la préférence ÉMULÉE :
 * sans bouger le curseur l'image reste stable (aucune dérive autonome, la préférence est respectée),
 * en bougeant le curseur l'image change (la parallaxe vit). Ce test-ci ne prouve pas cela — il
 * empêche seulement qu'on revienne au tout-ou-rien sans s'en apercevoir.
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
    expect(source).toMatch(/scene\.render\([^)]*,\s*look\s*\)/)
    expect(source).not.toMatch(/scene\.render\([^)]*reduceMotion\s*\?\s*\{\s*x:\s*0,\s*y:\s*0\s*\}/)
  })

  it('FIGE tout de même le temps sous la préférence — sinon on ne la respecterait plus', () => {
    // Le bord qui compte autant : la préférence doit continuer d'empêcher la dérive AUTONOME.
    // Sans cette assertion, « ne pas effacer le décor » pourrait devenir « ignorer la préférence ».
    //
    // ANCRÉE SUR LA BOUCLE, pas sur le fichier — faux vert mesuré le 2026-08-27 en récupérant ce
    // travail : la même expression existe AUSSI dans `fit()`, si bien que retirer la garde de `draw`
    // laissait le test au VERT (sabotage vérifié : exit 0). Un test qui lit tout le fichier ne dit
    // pas OÙ la garantie vit, donc ne la garde pas.
    // Le corps de `draw` seul : de sa declaration jusqu'a l'amorce de la boucle qui l'appelle.
    const apres = source.split('const draw = (time: number): void => {')[1]
    // [1] et non [0] : `draw` REAPPELLE la boucle a sa premiere ligne, donc la tranche utile est
    // celle qui separe cet appel interne de l'amorce qui suit la fonction.
    const draw = apres?.split('frame = requestAnimationFrame(draw)')[1]
    expect(draw).toBeDefined()
    expect(draw).toMatch(/scene\.render\(\s*reduceMotion\s*\?\s*\d+\s*:/)
  })

  /*
   * LE DÉCOR EST MONTÉ UNE SEULE FOIS — l'invariant né du déménagement, et le risque réel de cette
   * récupération : le travail avait été mis de côté le 25/08 alors que l'Accueil montait encore SA
   * propre scène. Garder les deux ferait tourner deux contextes WebGL et deux boucles d'animation sur
   * le même écran, pour afficher un seul fond.
   */
  it('n’est plus monté par l’Accueil : une seule scène pour toute l’application', () => {
    const accueil = readFileSync(join(__dirname, 'HomeView.tsx'), 'utf8')
    expect(accueil).not.toMatch(/createDecorScene/)
    const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8')
    expect(app).toMatch(/<DecorDeFond\s*\/>/)
  })

  /*
   * LA CLÉ DE LA DIRECTION VISUELLE SE DÉRIVE D'UNE SOURCE UNIQUE.
   *
   * Le travail récupéré RECOPIAIT la clé, et sur `home.decor.v1` alors que l'Accueil était passé à
   * `v2` : la direction choisie par l'utilisateur aurait été ignorée en silence, et le décor reparti
   * sur le défaut. C'est le défaut que le fichier récupéré décrivait pour lui-même — et qu'il a
   * reproduit d'une version.
   */
  it('lit la direction choisie depuis la constante partagée, jamais une chaîne recopiée', () => {
    expect(source).toMatch(/DECOR_STORAGE_KEY/)
    expect(source).not.toMatch(/autowinStorageKey\(/)
    expect(source).not.toMatch(/home\.decor\.v\d/)
  })
})
