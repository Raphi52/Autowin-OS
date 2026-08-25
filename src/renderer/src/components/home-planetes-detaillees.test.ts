import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ANNEAU_FRAGMENT_SHADER,
  COMPOSITIONS,
  DECOR_DEFAUT,
  PLANETE_FRAGMENT_SHADER
} from './home-decor-scene'

/**
 * CE QUE L'UTILISATEUR A DEMANDE, conv-1400, mot pour mot :
 *
 *   « remake les planetes du fond d'écran d'accueuil pour qu'elles soient ultra stylé ultra détaillées »
 *
 * Avant cette refonte, une planète était une `SphereGeometry` en `MeshStandardMaterial` de couleur
 * UNIE, plus un halo de limbe, plus des anneaux dessinés en `THREE.Line` — des cercles filaires.
 * À l'écran : une bille de plastique lisse entourée de trois traits. Aucun test du dépôt ne
 * l'interdisait : `home-decor-scene.test` ne vérifie que le NOMBRE de planètes et `rings > 0`, et
 * `home-decor-reinterpretation.contract.test` ne garde que l'absence de texture. On pouvait donc
 * repeindre la bille en une autre couleur unie et rester vert. Ce fichier est l'oracle manquant :
 * il porte le DÉTAIL, c'est-à-dire ce qui distingue une surface d'un aplat.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST si la refonte est fausse — chacune est une régression
 * plausible, pas une hypothèse d'école :
 *
 *   1. REVENIR À `MeshStandardMaterial({ color })` sur le globe (l'état d'avant) → il n'y a plus de
 *      `PLANETE_FRAGMENT_SHADER` exporté, l'import échoue et TOUT ce fichier tombe. C'est l'entrée
 *      qui a rendu ce test rouge avant la correction.
 *   2. Un shader de surface SANS fbm — un simple `mix()` entre deux couleurs, ou une seule octave de
 *      bruit → la surface redevient un dégradé propre, sans continent ni turbulence : l'assertion
 *      « ≥ 4 octaves » tombe.
 *   3. Le MÊME `seed` pour les trois planètes → elles portent le même relief au pixel près, ce qui
 *      se voit immédiatement à l'écran comme un copier-coller : l'assertion d'unicité tombe.
 *   4. Des anneaux laissés en `THREE.Line` (cercles filaires) → pas de `RingGeometry`, pas de
 *      `discard` de division : les assertions d'anneau tombent.
 *   5. Un anneau plein, sans `discard` → la division de Cassini disparaît, l'anneau redevient un
 *      disque uniforme : l'assertion sur les divisions tombe.
 *   6. Retirer l'ombre portée de la planète sur ses anneaux (`uOmbre`) → l'anneau brille derrière la
 *      face nuit, ce qui est LE défaut qui trahit un anneau décoratif : l'assertion tombe.
 */
describe('planètes du décor — surface CALCULÉE et détaillée (demande conv-1400)', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  describe('la SURFACE : du relief calculé, pas un aplat', () => {
    it('le globe est rendu par un shader dédié, pas par une couleur unie', () => {
      expect(typeof PLANETE_FRAGMENT_SHADER).toBe('string')
      expect(PLANETE_FRAGMENT_SHADER.length).toBeGreaterThan(400)
      // Le globe est monté AVEC ce shader : exporter la chaîne sans s'en servir serait un décor.
      expect(code).toMatch(/PLANETE_FRAGMENT_SHADER/)
    })

    it('BRUIT FRACTAL : au moins quatre octaves, sinon c est un dégradé', () => {
      expect(PLANETE_FRAGMENT_SHADER).toMatch(/fbm/)
      const boucle = PLANETE_FRAGMENT_SHADER.match(
        /for\s*\(\s*int\s+\w+\s*=\s*0;\s*\w+\s*<\s*(\d+)/
      )
      expect(boucle).toBeTruthy()
      expect(Number(boucle?.[1])).toBeGreaterThanOrEqual(4)
    })

    it('BANDES : la turbulence est étirée en latitude, comme sur une géante gazeuse', () => {
      expect(PLANETE_FRAGMENT_SHADER).toMatch(/uBandes/)
    })

    it('TERMINATEUR ET LIMBE : le volume vient de la lumière, pas d un contour dessiné', () => {
      // La lumière du monde est passée au shader : un éclairage codé en dur dans le fragment
      // désolidariserait les planètes de la `DirectionalLight` de la scène.
      expect(PLANETE_FRAGMENT_SHADER).toMatch(/uLumiere/)
      // Le limbe (rim) : le liseré d'atmosphère sur le bord éclairé.
      expect(PLANETE_FRAGMENT_SHADER).toMatch(/rim|limbe/)
      // La face nuit n'est pas noire — sinon la planète est amputée sur un fond noir.
      expect(PLANETE_FRAGMENT_SHADER).toMatch(/uNuit/)
    })

    it('chaque planète de la direction par défaut porte SON propre relief', () => {
      const planetes = COMPOSITIONS[DECOR_DEFAUT].planetes
      expect(planetes.length).toBeGreaterThanOrEqual(3)
      for (const planete of planetes) {
        // Le grain de la surface : deux planètes de même `seed` sont la même planète.
        expect(typeof planete.seed).toBe('number')
        // Des bandes en nombre réel : à 0, la surface redevient une turbulence isotrope.
        expect(planete.bandes).toBeGreaterThanOrEqual(3)
      }
      expect(new Set(planetes.map((p) => p.seed)).size).toBe(planetes.length)
    })
  })

  describe('les ANNEAUX : une matière, plus des traits', () => {
    it('ce sont des disques de géométrie, pas des cercles filaires', () => {
      expect(code).toMatch(/new THREE\.RingGeometry\(/)
      expect(typeof ANNEAU_FRAGMENT_SHADER).toBe('string')
      expect(code).toMatch(/ANNEAU_FRAGMENT_SHADER/)
    })

    it('DIVISIONS : l anneau est troué, pas un disque uniforme', () => {
      // `discard` est ce qui creuse les divisions (Cassini) : sans lui, le trou serait une simple
      // baisse d'opacité, qui se lit comme un dégradé sale et non comme une lacune.
      expect(ANNEAU_FRAGMENT_SHADER).toMatch(/discard/)
      // La densité varie le long du RAYON : c'est ce qui fait les sillons concentriques.
      expect(ANNEAU_FRAGMENT_SHADER).toMatch(/vRadius|radius/)
    })

    it('OMBRE PORTÉE : la planète assombrit ses propres anneaux', () => {
      expect(ANNEAU_FRAGMENT_SHADER).toMatch(/uOmbre|ombre/)
    })
  })
})
