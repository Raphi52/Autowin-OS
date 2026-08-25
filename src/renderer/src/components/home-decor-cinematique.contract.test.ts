import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FILANTE_FRAGMENT_SHADER, FILANTES, POST_TRAITEMENT } from './home-decor-scene'

/**
 * Le saut « triple A » demandé en conv-1402 : « rend le fond d'écran de l'accueil ultra magnifique ».
 *
 * Ce qui manquait n'était PAS de la matière — la scène en avait déjà beaucoup — mais la CHAÎNE
 * CINÉMATIQUE qui transforme une accumulation de points additifs en image : bloom sur les hautes
 * lumières, tone mapping filmique, et un événement rare qui donne envie de regarder (les étoiles
 * filantes). Trois contrats, tous relisibles sans WebGL (happy-dom n'en a pas), donc tous testables.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST si la correction est fausse — c'est le point de ce
 * fichier, chaque assertion nomme sa panne :
 */
describe('post-traitement cinématique du décor', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')

  /**
   * Falsifieurs : `bloom.force = 0` (bloom neutre, donc absent) ; `seuil = 0` (tout l'écran
   * déborde, les widgets deviennent illisibles) ; `exposition = 1` sur un tone mapping filmique
   * (l'image ressort plus sombre qu'avant, l'utilisateur verrait une régression).
   */
  it('expose un réglage de bloom réellement actif et borné', () => {
    expect(POST_TRAITEMENT.bloom.force).toBeGreaterThan(0.2)
    // Borné : au-delà, le décor mange le texte posé dessus.
    expect(POST_TRAITEMENT.bloom.force).toBeLessThanOrEqual(1.2)
    // Un seuil franchement au-dessus de zéro : SEULES les hautes lumières débordent.
    expect(POST_TRAITEMENT.bloom.seuil).toBeGreaterThan(0.1)
    expect(POST_TRAITEMENT.bloom.rayon).toBeGreaterThan(0)
    expect(POST_TRAITEMENT.exposition).toBeGreaterThan(1)
  })

  /**
   * Falsifieurs : un `toneMapping` laissé par défaut (`NoToneMapping`) → les additions de points
   * saturent en blanc plat ; l'exposition écrite en dur à côté de la constante → le réglage exposé
   * ne pilote plus rien (le défaut classique : une constante décorative).
   */
  it('câble ACES filmique et l exposition depuis la constante, pas en dur', () => {
    expect(POST_TRAITEMENT.toneMapping).toBe('ACESFilmic')
    expect(source).toMatch(/renderer\.toneMapping\s*=\s*THREE\.ACESFilmicToneMapping/)
    expect(source).toMatch(/renderer\.toneMappingExposure\s*=\s*POST_TRAITEMENT\.exposition/)
  })

  /**
   * Falsifieurs : garder `renderer.render(scene, camera)` dans `render()` → le composer est
   * construit mais jamais utilisé, l'image reste identique (panne silencieuse la plus probable) ;
   * oublier `setSize` sur le composer → au redimensionnement, l'image est étirée ou floue.
   */
  it('rend PAR le composer, et le redimensionne', () => {
    expect(source).toMatch(/EffectComposer/)
    expect(source).toMatch(/UnrealBloomPass/)
    // OutputPass : c'est lui qui applique tone mapping + conversion sRGB en fin de chaîne. Sans
    // lui, une chaîne de post-traitement rend délavé.
    expect(source).toMatch(/OutputPass/)
    expect(source).toMatch(/composer\.setSize\(/)
    expect(source).toMatch(/composer\.render\(\)/)
    // Le rendu direct ne doit plus exister : deux chemins de rendu = un des deux est mort.
    expect(source).not.toMatch(/renderer\.render\(\s*scene\s*,\s*camera\s*\)/)
  })
})

/**
 * Les étoiles filantes : l'événement RARE du décor.
 *
 * C'est ce qui distingue un fond d'écran d'une image : quelque chose arrive. Rare et court, sinon
 * c'est une pluie de météores et le décor devient bruyant.
 */
describe('étoiles filantes', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')

  /**
   * Falsifieurs : `nombre = 0` → aucune filante, la promesse est vide ; un nombre élevé (> 12) →
   * pluie continue ; `periode` courte (< 6 s) → il en passe une toutes les deux secondes, ce qui
   * se lit comme un effet et non comme un événement.
   */
  it('sont rares, courtes, et désynchronisées', () => {
    expect(FILANTES.nombre).toBeGreaterThan(0)
    expect(FILANTES.nombre).toBeLessThanOrEqual(12)
    expect(FILANTES.periode).toBeGreaterThanOrEqual(6)
    // La traînée dure une fraction de la période : c'est ce rapport qui fait la rareté.
    expect(FILANTES.duree).toBeLessThan(FILANTES.periode / 4)
  })

  /**
   * Falsifieurs : un shader qui rend un point rond (pas de gradient le long de la traînée) → une
   * étoile filante sans queue est un point qui se déplace ; une opacité constante → elle apparaît
   * et disparaît par un saut, au lieu de s'allumer et s'éteindre.
   */
  it('portent une traînée dégradée, pas un point qui se déplace', () => {
    expect(FILANTE_FRAGMENT_SHADER).toMatch(/vTrainee|vQueue/)
    expect(FILANTE_FRAGMENT_SHADER).toMatch(/vIntensite/)
    // Le fondu d'entrée/sortie vit dans le vertex shader, qui connaît le temps.
    expect(source).toMatch(/uFilanteDuree|FILANTES\.duree/)
  })

  /** Falsifieur : la couche construite mais jamais ajoutée à la scène — invisible, test vert. */
  it('sont bien ajoutées à la scène et animées', () => {
    expect(source).toMatch(/scene\.add\(\s*filantes\s*\)/)
    expect(source).toMatch(/filantes[\s\S]{0,200}uniforms\.uTime\.value/)
  })
})
