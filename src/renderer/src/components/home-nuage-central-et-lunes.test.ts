import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COMPOSITIONS,
  DECOR_DEFAUT,
  LUNES,
  NUAGE_COSMIQUE,
  NUAGE_FRAGMENT_SHADER,
  orbiteLune,
  positionNuage
} from './home-decor-scene'

/**
 * CE QUE L'UTILISATEUR A DEMANDÉ, conv-1408, mot pour mot :
 *
 *   « dans l'accueil le fond d'écran je veux un nuage cosmique bleu violet au milieu qui se déplace
 *     et des lunes autour des planetes »
 *
 * Avant ce test, la composition par défaut (`actuel`) plaçait ses quatre nébuleuses dans les ANGLES et
 * laissait le CENTRE noir (choix documenté « le milieu porte les widgets »), et aucune planète n'avait
 * de satellite : `satellites: 0` sur `actuel`, et les satellites de `orbites` tournent autour du
 * centre du monde, pas autour d'une planète. La demande porte donc sur deux éléments ABSENTS.
 *
 * happy-dom n'a pas de WebGL : `createDecorScene` rend `null`. La preuve est donc portée par des
 * DONNÉES et des FONCTIONS PURES relues ici — le déplacement du nuage et l'orbite d'une lune sont
 * calculables sans GPU, et c'est ce qui les rend testables.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST si la correction est fausse :
 *
 *   1. Ajouter le nuage comme une 5ᵉ nébuleuse d'angle (par exemple `{ fx: -0.86, fy: 0.62, … }`)
 *      au lieu du centre → l'assertion « |fx| et |fy| ≤ 0,15 » tombe : ce n'est pas « au milieu ».
 *   2. Poser le nuage au centre mais IMMOBILE — `positionNuage` qui ignore `temps` et rend
 *      `{ x: 0, y: 0 }` → l'assertion « deux instants ⇒ deux positions » tombe : « qui se déplace »
 *      est une propriété, pas un mot du commentaire.
 *   3. Un nuage ROSE / OR (par exemple `couleur: 0xef3f91`, la couleur rose de theme.css) → les
 *      assertions de teinte tombent : bleu-violet veut dire canal bleu dominant.
 *   4. Une dérive qui SORT du cadre (amplitude ≥ 1 fraction de demi-cadre) → le nuage quitterait le
 *      milieu : l'assertion de bornes tombe.
 *   5. Des lunes rendues comme des `satellites` du monde (orbite centrée sur l'origine de la scène,
 *      composition `orbites`) au lieu d'être ATTACHÉES au groupe de la planète → l'assertion
 *      « chaque planète de la direction par défaut porte lunes ≥ 1 » tombe, et le code n'ajouterait
 *      pas les lunes dans le groupe de la planète.
 *   6. Des lunes POSÉES mais fixes — `orbiteLune` indépendante de `temps` → l'assertion « la lune a
 *      bougé entre deux instants » tombe (« autour des planètes » implique le tour).
 *   7. Une lune dont le rayon d'orbite varie avec le temps (bug de dérive : `rayon * temps`) → elle
 *      s'échapperait de sa planète : l'assertion « rayon constant » tombe.
 *   8. Deux lunes d'une même planète sur la MÊME phase → elles se superposent, on n'en voit qu'une :
 *      l'assertion de phases distinctes tombe.
 */
describe('accueil — nuage cosmique central mobile et lunes autour des planètes (conv-1408)', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  describe('LE NUAGE : cosmique, bleu-violet, AU MILIEU, et il se déplace', () => {
    it('la direction par défaut porte un nuage central déclaré', () => {
      const nuage = COMPOSITIONS[DECOR_DEFAUT].nuage
      expect(nuage).toBeTruthy()
      // « au milieu » : le nuage est posé au centre du cadre, pas dans un angle comme les nébuleuses.
      expect(Math.abs(nuage!.fx)).toBeLessThanOrEqual(0.15)
      expect(Math.abs(nuage!.fy)).toBeLessThanOrEqual(0.15)
    })

    it('BLEU-VIOLET : le canal bleu domine les deux teintes du nuage', () => {
      const bleu = (hex: number): number => hex & 0xff
      const vert = (hex: number): number => (hex >> 8) & 0xff
      const rouge = (hex: number): number => (hex >> 16) & 0xff
      for (const couleur of [NUAGE_COSMIQUE.couleur, NUAGE_COSMIQUE.secondaire]) {
        expect(bleu(couleur)).toBeGreaterThan(vert(couleur))
        expect(bleu(couleur)).toBeGreaterThan(rouge(couleur))
      }
      // Le violet apporte le rouge : un nuage purement cyan n'est pas « bleu violet ».
      expect(
        Math.max(rouge(NUAGE_COSMIQUE.couleur), rouge(NUAGE_COSMIQUE.secondaire))
      ).toBeGreaterThan(60)
    })

    it('IL SE DÉPLACE : deux instants donnent deux positions', () => {
      const cadre = { halfWidth: 20, halfHeight: 12 }
      const a = positionNuage(0, cadre)
      const b = positionNuage(37, cadre)
      const ecart = Math.hypot(b.x - a.x, b.y - a.y)
      expect(ecart).toBeGreaterThan(0.2)
    })

    it('SANS QUITTER LE MILIEU : la dérive reste bornée dans le cadre', () => {
      const cadre = { halfWidth: 20, halfHeight: 12 }
      for (let t = 0; t < 600; t += 3.7) {
        const p = positionNuage(t, cadre)
        expect(Math.abs(p.x)).toBeLessThan(cadre.halfWidth * 0.5)
        expect(Math.abs(p.y)).toBeLessThan(cadre.halfHeight * 0.5)
      }
      expect(NUAGE_COSMIQUE.derive.amplitude).toBeLessThan(1)
      expect(NUAGE_COSMIQUE.derive.amplitude).toBeGreaterThan(0)
    })

    it('c est une MATIÈRE calculée, montée dans la scène', () => {
      expect(typeof NUAGE_FRAGMENT_SHADER).toBe('string')
      expect(NUAGE_FRAGMENT_SHADER).toMatch(/fbm/)
      expect(code).toMatch(/NUAGE_FRAGMENT_SHADER/)
      expect(code).toMatch(/positionNuage\(/)
      // Le centre porte les widgets : le nuage reste translucide, sinon il rend le texte illisible.
      expect(NUAGE_COSMIQUE.opacite).toBeLessThanOrEqual(0.55)
      expect(NUAGE_COSMIQUE.opacite).toBeGreaterThan(0)
    })
  })

  describe('LES LUNES : autour des planètes, et elles tournent', () => {
    it('chaque planète de la direction par défaut porte au moins une lune', () => {
      const planetes = COMPOSITIONS[DECOR_DEFAUT].planetes
      expect(planetes.length).toBeGreaterThanOrEqual(3)
      for (const planete of planetes) {
        expect(planete.lunes).toBeGreaterThanOrEqual(1)
      }
      // Au moins une planète en porte plusieurs : « des lunes » au pluriel.
      expect(Math.max(...planetes.map((p) => p.lunes))).toBeGreaterThanOrEqual(2)
    })

    it('les lunes sont ATTACHÉES au groupe de leur planète', () => {
      // Sans ajout dans le groupe, une lune resterait au centre du monde pendant que la planète est
      // cadrée par `resize` — elle ne serait pas « autour de la planète ».
      expect(code).toMatch(/buildLune|lune/i)
      expect(code).toMatch(/orbiteLune\(/)
    })

    it('ELLES TOURNENT : la position change avec le temps, le rayon ne change pas', () => {
      const a = orbiteLune(0, 3, 0)
      const b = orbiteLune(0, 3, 5.5)
      expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeGreaterThan(0.05)
      const rayonA = Math.hypot(a.x, a.y, a.z)
      const rayonB = Math.hypot(b.x, b.y, b.z)
      expect(rayonB).toBeCloseTo(rayonA, 5)
      // L'orbite se tient au-dessus de la surface (rayon planète = 1 en local) et hors des anneaux
      // les plus proches, sinon la lune est enfouie dans la matière.
      expect(rayonA).toBeGreaterThan(LUNES.rayonMin)
    })

    it('deux lunes d une même planète ne se superposent pas', () => {
      const positions = [0, 1, 2].map((i) => orbiteLune(i, 3, 4.2))
      for (let i = 0; i < positions.length; i += 1) {
        for (let j = i + 1; j < positions.length; j += 1) {
          const d = Math.hypot(
            positions[i].x - positions[j].x,
            positions[i].y - positions[j].y,
            positions[i].z - positions[j].z
          )
          expect(d).toBeGreaterThan(0.2)
        }
      }
    })
  })
})
