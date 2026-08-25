import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COMPOSITIONS, DECOR_DEFAUT, DECOR_VARIANTS } from './home-decor-scene'

/**
 * CE QUE L'UTILISATEUR A CHOISI, conv-1399, mot pour mot :
 *
 *   « Une scène 3D temps réel qui réinterprète le fond (couches, particules, lumière),
 *     pas une copie pixel du fond »
 *
 * C'est une option prise dans un QCM à quatre branches, dont l'une était justement l'effet de
 * profondeur appliqué à l'IMAGE existante. La branche écartée est donc nommée, et rien dans le dépôt
 * ne l'empêchait de revenir : les tests voisins gardent l'OPACITÉ du canevas (`home-decor-scene.test`),
 * le fond de la vue (`HomeView.css.test`) et le catalogue des directions — aucun ne dit que le décor
 * doit être SYNTHÉTIQUE. Un futur agent lisant « reproduction du fond d'écran » (le tout premier mot
 * de la demande, conv-1397) pouvait plaquer `autowin-galaxy-bg-hq.png` en texture sur un plan, obtenir
 * une ressemblance pixel bien meilleure, et voir la suite rester verte. Ce fichier est l'oracle
 * manquant.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST si la mise en œuvre est fausse — chacune vérifiée en
 * l'introduisant réellement dans `home-decor-scene.ts`, puis retirée :
 *
 *   1. `new THREE.TextureLoader().load(fond)` + `new THREE.MeshBasicMaterial({ map: texture })`
 *      posé sur un plan de fond → la copie pixel revient, `décor synthétique` tombe. C'est l'entrée
 *      qui a été jouée : elle rend ce fichier ROUGE (2 assertions) alors que les 14 tests voisins
 *      restent VERTS — ce qui est exactement la démonstration que l'oracle manquait.
 *   2. retirer `DirectionalLight` (garder la seule ambiante) → « lumière » n'est plus qu'un mot dans
 *      la réponse au QCM ; un décor éclairé à plat est une image, c'est le terminateur qui fait la 3D.
 *   3. aplatir la composition par défaut sur un seul `z` → « couches » tombe.
 *   4. mettre la composition par défaut à zéro nébuleuse → « particules » tombe.
 */
describe('décor 3D — réinterprétation synthétique, pas copie pixel (choix utilisateur conv-1399)', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')
  /** Les commentaires CITENT le nom du fichier image ; seul le code exécutable est jugé. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('PAS DE COPIE PIXEL : le décor ne charge aucune image, donc aucune texture du fond d écran', () => {
    // La branche du QCM que l'utilisateur a ÉCARTÉE : l'image existante, retravaillée.
    expect(code).not.toMatch(/autowin-galaxy-bg/)
    expect(code).not.toMatch(/\.(png|jpe?g|webp|avif|ktx2?|hdr|exr)\b/)
    // Tout chemin de chargement de texture, quelle que soit sa source : c'est la MÉCANIQUE de la
    // copie pixel, pas seulement ce fichier-là.
    expect(code).not.toMatch(/TextureLoader|useTexture|new THREE\.(Video|CanvasTexture)/)
    // `map:` sur un matériau = une image plaquée. Le décor n'a le droit qu'à des shaders et des
    // couleurs, qu'il CALCULE.
    expect(code).not.toMatch(/\bmap\s*:/)
  })

  it('le monde est CALCULÉ : shaders et couleurs, pas un fichier décodé', () => {
    // Ce qui remplace la texture : du code de rendu. Une seule de ces deux preuves suffirait à
    // maquiller un décor vide, les deux ensemble non.
    expect(code).toMatch(/ShaderMaterial/)
    expect(code).toMatch(/fragmentShader/)
  })

  it('COUCHES : la direction par défaut étage ses éléments en profondeur', () => {
    const defaut = COMPOSITIONS[DECOR_DEFAUT]
    const profondeurs = new Set(
      [...defaut.nebuleuses.map((n) => n.z), ...defaut.planetes.map((p) => p.z)].map(Number)
    )
    // Trois plans distincts au minimum : à deux, la parallaxe se lit comme un glissement, pas comme
    // de la profondeur.
    expect(profondeurs.size).toBeGreaterThanOrEqual(3)
    // Et la parallaxe qui exploite ces couches doit exister : des couches sans parallaxe, c'est un
    // empilement d'images.
    expect(defaut.parallaxe).toBeGreaterThan(0)
  })

  it('PARTICULES : la direction par défaut porte de la matière en points', () => {
    expect(COMPOSITIONS[DECOR_DEFAUT].nebuleuses.length).toBeGreaterThan(0)
    // Les nébuleuses sont rendues en `Points` — c'est ce mot-là qui fait la particule, et non un
    // plan texturé qui en aurait l'apparence.
    expect(code).toMatch(/new THREE\.Points\(/)
  })

  it('LUMIÈRE : une source directionnelle, pas seulement de l ambiante', () => {
    // Le terminateur (la frontière jour/nuit sur une planète) est LE signal qui distingue un volume
    // d'un autocollant. Il n'existe que sous une lumière directionnelle.
    expect(code).toMatch(/new THREE\.DirectionalLight\(/)
    expect(code).toMatch(/new THREE\.AmbientLight\(/)
  })

  it('TEMPS RÉEL : chaque direction avance à un tempo non nul', () => {
    // « temps réel » dans la demande : la scène vit. Une direction à tempo 0 serait une image fixe
    // rendue en 3D — le pire des deux mondes.
    for (const variante of DECOR_VARIANTS) {
      expect(COMPOSITIONS[variante.id].tempo).toBeGreaterThan(0)
    }
  })
})
