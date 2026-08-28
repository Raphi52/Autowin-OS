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

const source = readFileSync(join(__dirname, 'HomeView.tsx'), 'utf8')

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

  it('RALENTIT le temps sous la préférence, sans le figer (conv-1476)', () => {
    // Le bord qui compte autant : la préférence doit continuer de CALMER la dérive autonome. Mais
    // la FIGER rendait le nuage immobile — c'était la plainte « le nuage est statique », le décor
    // n'ayant pas d'autre horloge. Le ralentissement vit dans `tempsDecor` (facteur testé par
    // `home-decor-mouvement-vivant.test.ts`) ; ici, on vérifie qu'aucune CONSTANTE ne reprend la
    // place de l'horloge.
    expect(source).toMatch(/tempsDecor\(\s*time\s*\/\s*1000\s*,\s*reduceMotion\s*\)/)
    expect(source).not.toMatch(/scene\.render\(\s*reduceMotion\s*\?\s*\d+\s*:/)
  })
})
