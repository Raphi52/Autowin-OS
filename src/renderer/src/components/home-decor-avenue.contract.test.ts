import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AVENUE, BUDGET_MAILLAGE_MS, CAMERA_AVENUE } from './home-decor-avenue'
import {
  creerPreparation,
  maillerCorps,
  maillerTete,
  ORDRE_FORMES,
  preparationHumains,
  type NomForme
} from './home-decor-avenue-maillage'
import { DECOR_DEFAUT } from './home-decor-scene'

/**
 * CE QUE L'UTILISATEUR A DEMANDÉ, conv-301 : « /draft un tout nouveau fond 3d pour l'accueil qui
 * s'inspire un peu de cette image notre theme ville cyberpunk obscure street tag et de notre theme
 * noir holo », puis, après les brouillons regardés dans le fil, « Passe au vrai fond de l'Accueil
 * avec ce look ».
 *
 * Ce fichier tient, pour la NOUVELLE direction par défaut, les garanties que
 * `home-decor-reinterpretation.contract.test.ts` tenait pour les planètes, et ce qu'un fond exige en
 * plus d'une démo : ne pas voler la souris, ne pas figer l'Accueil pendant que la foule se prépare.
 *
 * ENTRÉES QUI DOIVENT LE FAIRE ÉCHOUER si la mise en œuvre est fausse :
 *   1. `new THREE.TextureLoader().load(photo)` posé sur un plan → la photo d'inspiration plaquée ;
 *   2. `new OrbitControls(camera, canvas)` ou un écouteur clavier → le fond vole la souris aux widgets ;
 *   3. les `yield` retirés du maillage → 4,5 s de calcul d'un seul tenant, l'Accueil figé ;
 *   4. la clé de stockage laissée en `v2` → les machines qui avaient gardé les planètes ne voient
 *      jamais l'avenue.
 */
const sans = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '')
const scene = sans(readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8'))
const maillage = sans(
  readFileSync(new URL('./home-decor-avenue-maillage.ts', import.meta.url), 'utf8')
)
const code = scene + '\n' + maillage

describe('fond de l Accueil — l avenue cyberpunk (conv-301)', () => {
  it('est la direction par défaut', () => {
    expect(DECOR_DEFAUT).toBe('avenue')
  })

  it('AUCUNE IMAGE CHARGÉE : la photo d inspiration n est pas plaquée, tout est dessiné par code', () => {
    // Aucun fichier image, quel que soit le format.
    expect(code).not.toMatch(/\.(png|jpe?g|webp|avif|gif|bmp|ktx2?|hdr|exr)\b/i)
    // Aucun chemin d'entrée d'une image dans la page : chargeurs three.js, élément image, bitmap
    // décodé, requête réseau, attribut `src`. Une toile 2D ne peut recevoir des pixels venus
    // d'ailleurs que par l'un d'eux : sans eux, chaque texture est CALCULÉE.
    expect(code).not.toMatch(
      /\b\w*Loader\b|useTexture|new Image\b|HTMLImageElement|createImageBitmap/
    )
    expect(code).not.toMatch(/\bfetch\s*\(|\.src\s*=|VideoTexture|<video|url\(/)
    // Les textures dessinées existent bien, et elles viennent d'une toile créée ici.
    expect(code).toMatch(/document\.createElement\('canvas'\)/)
  })

  it('LE MONDE EST CALCULÉ : nuanceurs écrits ici, pas un fichier décodé', () => {
    expect(code).toMatch(/new THREE\.ShaderMaterial\(/)
    expect(code).toMatch(/fragmentShader/)
  })

  it('COUCHES : la rue, la ville en contrebas et le ciel, et une parallaxe pour les séparer', () => {
    // La ville est posée 95 m sous le trottoir : c'est la vue plongeante de la corniche.
    expect(scene).toMatch(/const SOL = -95\b/)
    expect(scene).toMatch(/solVille\.position\.y = SOL/)
    // Le ciel est une sphère lointaine, pas une image de fond.
    expect(scene).toMatch(/new THREE\.SphereGeometry\(4000/)
    // Des couches sans parallaxe, c'est un empilement d'images.
    expect(CAMERA_AVENUE.parallaxe.x).toBeGreaterThan(0)
    expect(CAMERA_AVENUE.parallaxe.y).toBeGreaterThan(0)
  })

  it('PARTICULES ET LUMIÈRE : de la matière en points, de la pluie, des sources locales', () => {
    expect(scene).toMatch(/new THREE\.Points\(/)
    expect(scene).toMatch(/new THREE\.LineSegments\(/)
    // Les néons, les réverbères et les phares éclairent LOCALEMENT : une ambiante seule aplatirait
    // la rue comme une image.
    expect(scene).toMatch(/new THREE\.PointLight\(/)
    expect(scene).toMatch(/new THREE\.SpotLight\(/)
  })

  it('UN FOND, PAS UNE DÉMO : il ne prend ni la souris, ni le clavier, ni sa propre horloge', () => {
    // Les contrôles orbitaux du brouillon volaient la souris aux widgets de l'Accueil.
    expect(scene).not.toMatch(/OrbitControls/)
    // Ni écouteur, ni barre de boutons, ni légende posée dans la page.
    expect(scene).not.toMatch(/addEventListener|document\.body|keydown/)
    // Le temps vient de `DecorDeFond` : c'est ce qui applique la limite d'images, la pause quand la
    // fenêtre est cachée et le ralenti « mouvement réduit ». Une boucle propre les contournerait.
    expect(scene).not.toMatch(/setAnimationLoop|requestAnimationFrame|setInterval/)
    expect(scene).toMatch(/render\(elapsed, look\)/)
  })

  it('LA MARCHE EST LENTE : « un truc lent, pas fonce mais marche »', () => {
    // Demande de l'utilisateur pendant les brouillons : on avance au pas sur le trottoir.
    expect(AVENUE.vitesse).toBeGreaterThan(0)
    expect(AVENUE.vitesse).toBeLessThanOrEqual(1.4)
  })

  it('la clé de stockage est versionnée pour que le nouveau défaut atteigne toutes les machines', () => {
    const decor = readFileSync(new URL('./DecorDeFond.tsx', import.meta.url), 'utf8')
    expect(decor).toMatch(/autowinStorageKey\('home\.decor\.v3'\)/)
    expect(sans(decor)).not.toMatch(/home\.decor\.v[12]\b/)
  })
})

/**
 * LA FOULE NE FIGE PAS L'ACCUEIL.
 *
 * Mesuré le 2026-10-17 : mailler les cinq corps et les deux têtes d'un seul tenant prend 4,5 s.
 * Le maillage est donc découpé en tranches. Le nombre de tranches est la mesure DÉTERMINISTE de ce
 * découpage (une durée dépend de la machine) : à plus de 60 tranches, chacune porte moins de 2 % du
 * travail d'un corps, soit quelques millisecondes.
 *
 * Les décomptes de sommets sont ceux des corps du brouillon validé (comparaison sommet par sommet
 * faite au portage) : ils verrouillent le « look » que l'utilisateur a regardé.
 */
describe('fond de l Accueil — les corps de la foule, maillés par tranches', () => {
  const SOMMETS: Record<NomForme, [number, number]> = {
    M: [9234, 18468],
    C: [7186, 14368],
    E: [9119, 18240],
    N: [7609, 15216],
    O: [7754, 15504]
  }
  const finir = <R>(g: Generator<void, R, void>): { valeur: R; tranches: number } => {
    let tranches = 0
    for (;;) {
      const pas = g.next()
      tranches++
      if (pas.done) return { valeur: pas.value, tranches }
    }
  }

  it(
    'chaque corps rend la main plus de 60 fois et garde la géométrie du brouillon',
    { timeout: 60_000 },
    () => {
      for (const nom of ORDRE_FORMES) {
        const { valeur, tranches } = finir(maillerCorps(nom))
        expect(tranches, nom).toBeGreaterThan(60)
        expect([valeur.zones.length, valeur.index.length / 3], nom).toEqual(SOMMETS[nom])
        // Un poids d'os par sommet et par influence, normalisé : sinon le corps se déchire en marchant.
        for (let q = 0; q < valeur.zones.length; q += 997) {
          const somme = [0, 1, 2, 3].reduce((s, i) => s + valeur.skinWeight[q * 4 + i], 0)
          expect(somme).toBeCloseTo(1, 4)
        }
      }
    }
  )

  it(
    'chaque tête fine rend la main plus de 60 fois et garde la géométrie du brouillon',
    { timeout: 60_000 },
    () => {
      const homme = finir(maillerTete(false))
      const femme = finir(maillerTete(true))
      expect(homme.tranches).toBeGreaterThan(60)
      expect(femme.tranches).toBeGreaterThan(60)
      expect([homme.valeur.ao.length, homme.valeur.index.length / 3]).toEqual([8196, 16308])
      expect([femme.valeur.ao.length, femme.valeur.index.length / 3]).toEqual([8038, 15992])
    }
  )

  it(
    'le travail avance par budget, rend null tant qu il n est pas fini, puis rend le même résultat',
    { timeout: 60_000 },
    () => {
      // Une horloge qui avance d'une unité à chaque lecture : un budget nul n'autorise qu'UNE tranche.
      let instant = 0
      const preparation = creerPreparation(() => instant++)
      let appels = 0
      let resultat = preparation.avancer(0)
      while (!resultat) {
        appels++
        // Budget négatif : traité comme nul, jamais comme « tout de suite tout ».
        resultat = preparation.avancer(appels % 2 ? -5 : 0)
      }
      // Des centaines d'appels : le travail a été rendu par petits morceaux, pas d'un bloc.
      expect(appels).toBeGreaterThan(500)
      expect(Object.keys(resultat.corps).sort()).toEqual([...ORDRE_FORMES].sort())
      expect(resultat.tetes).toHaveLength(2)
      // Fini, il ne recalcule rien : même objet, sans lire l'horloge.
      const avant = instant
      expect(preparation.avancer(BUDGET_MAILLAGE_MS)).toBe(resultat)
      expect(instant).toBe(avant)
    }
  )

  it('le budget par tâche reste loin du seuil d une tâche longue du navigateur (50 ms)', () => {
    expect(BUDGET_MAILLAGE_MS).toBeGreaterThan(0)
    expect(BUDGET_MAILLAGE_MS).toBeLessThanOrEqual(16)
  })

  it('le travail est partagé par la session : une scène reconstruite reprend où la précédente s est arrêtée', () => {
    expect(preparationHumains()).toBe(preparationHumains())
  })
})
