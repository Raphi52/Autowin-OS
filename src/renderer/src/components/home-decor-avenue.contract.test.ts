import { readdirSync, readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { AVENUE, CAMERA_AVENUE, FONDU_ENTREE_MS, MARQUES_AVENUE } from './home-decor-avenue'
import {
  AVATARS,
  ECART_CAMERA,
  ecarterDeLaCamera,
  enrouler,
  FOULE,
  HEURE_DE_POINTE,
  MARCHES,
  positionZ,
  redresserMarche
} from './home-decor-foule'
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
 *   3. une lumière ajoutée par la foule → tous les programmes de la rue recompilés à son arrivée ;
 *   4. la clé de stockage laissée en `v2` → les machines qui avaient gardé les planètes ne voient
 *      jamais l'avenue.
 */
const sans = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '')
const scene = sans(readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8'))
// Lu BRUT : le motif `foule-rocketbox/*.{glb,webp}` contient `/*`, que `sans` prendrait pour un commentaire.
const foule = readFileSync(new URL('./home-decor-foule.ts', import.meta.url), 'utf8')
const DOSSIER_FOULE = new URL('../assets/foule-rocketbox/', import.meta.url)

describe('fond de l Accueil — l avenue cyberpunk (conv-301)', () => {
  it('est la direction par défaut', () => {
    expect(DECOR_DEFAUT).toBe('avenue')
  })

  it('AUCUNE IMAGE DANS LA RUE : la photo d inspiration n est pas plaquée, la rue est dessinée par code', () => {
    // Aucun fichier image, quel que soit le format.
    expect(scene).not.toMatch(/\.(png|jpe?g|webp|avif|gif|bmp|ktx2?|hdr|exr)\b/i)
    // Aucun chemin d'entrée d'une image dans la rue : chargeurs three.js, élément image, bitmap
    // décodé, requête réseau, attribut `src`. Une toile 2D ne peut recevoir des pixels venus
    // d'ailleurs que par l'un d'eux : sans eux, chaque texture de la rue est CALCULÉE.
    expect(scene).not.toMatch(
      /\b\w*Loader\b|useTexture|new Image\b|HTMLImageElement|createImageBitmap/
    )
    expect(scene).not.toMatch(/\bfetch\s*\(|\.src\s*=|VideoTexture|<video|url\(/)
    // Les textures dessinées existent bien, et elles viennent d'une toile créée ici — dans la page
    // ou, depuis que l'avenue tourne dans un Worker (conv-323), hors d'elle : decor-toile.ts.
    expect(scene).toMatch(/nouvelleToile\(w, h\)/)
    const toile = readFileSync(new URL('./decor-toile.ts', import.meta.url), 'utf8')
    expect(toile).toMatch(/document\.createElement\('canvas'\)/)
    expect(toile).toMatch(/new OffscreenCanvas\(largeur, hauteur\)/)
    expect(toile).not.toMatch(/\b\w*Loader\b|new Image\b|createImageBitmap|\bfetch\s*\(|\.src\s*=/)
  })

  it('SEULE LA FOULE CHARGE DES FICHIERS, et seulement les siens : des personnes, pas la photo', () => {
    // Un seul dossier, lu par Vite au build : aucun chemin construit à l'exécution ne peut en sortir.
    expect(foule).toMatch(/import\.meta\.glob\('\.\.\/assets\/foule-rocketbox\/\*\.\{glb,webp\}'/)
    expect(foule.match(/import\.meta\.glob\(/g)).toHaveLength(1)
    expect(foule).not.toMatch(/new Image\b|HTMLImageElement|\.src\s*=|url\(/)
    // Dans le dossier : des modèles, leurs textures, et la licence qui permet de les livrer.
    const fichiers = readdirSync(DOSSIER_FOULE)
    expect(fichiers.filter((f) => !/\.(glb|webp)$/.test(f))).toEqual(['LICENCE-ROCKETBOX.md'])
    expect(readFileSync(new URL('LICENCE-ROCKETBOX.md', DOSSIER_FOULE), 'utf8')).toMatch(
      /MIT License[\s\S]*Copyright \(c\) 2020 Microsoft/
    )
  })

  it('LE MONDE EST CALCULÉ : nuanceurs écrits ici, pas un fichier décodé', () => {
    expect(scene).toMatch(/new THREE\.ShaderMaterial\(/)
    expect(scene).toMatch(/fragmentShader/)
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
 * LA RUE ENTRE EN FONDU, ET SON DÉLAI SE MESURE (conv-301, « Mesurer le délai d'apparition de la rue
 * et ajouter un fondu d'entrée »).
 *
 * Mesuré le 2026-10-17 (instance cachée, code en cours) : la rue est compilée 0,6 à 0,8 s après la
 * création de la scène, puis dessinée ; sans fondu, elle surgissait d'un coup derrière les tuiles.
 * Filmée image par image, la luminance monte maintenant sur ~1 s au lieu de sauter.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE BLOC :
 *   1. le canevas créé opaque → la rue surgit sans fondu ;
 *   2. le fondu lancé AVANT `renderer.render` → il dévoile un tampon vide ;
 *   3. un fondu animé par la boucle d'images en JavaScript → du travail sur le fil principal, au
 *      moment précis où la page est la plus chargée ;
 *   4. une marque retirée → la sonde ne peut plus mesurer le délai.
 */
describe('fond de l Accueil — l apparition de la rue', () => {
  it('le canevas naît invisible et passe à 1 en fondu, animé par le navigateur', () => {
    expect(scene).toMatch(
      /marquer\(MARQUES_AVENUE\.cree\)[^\n]*\n(\s*\/\/[^\n]*\n)*\s*if \(dansLaPage\) canvas\.style\.opacity = '0'/
    )
    expect(scene).toMatch(/canvas\.style\.opacity = '1'/)
    expect(scene).toMatch(/canvas\.animate\(\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/)
    expect(scene).toMatch(/duration: FONDU_ENTREE_MS/)
  })

  it('DANS LE WORKER, la page fait le même fondu : canevas invisible avant transfert, fondu à « apparue »', () => {
    // conv-323 : un canevas transféré au Worker n'a plus de style côté Worker ; c'est la page qui
    // garde l'élément et doit faire, à la première image, exactement le fondu de la page.
    const hote = readFileSync(new URL('./decor-avenue-hote.ts', import.meta.url), 'utf8')
    expect(hote).toMatch(
      /canevas\.style\.opacity = '0'\s*\n\s*const horsPage = canevas\.transferControlToOffscreen\(\)/
    )
    expect(hote).toMatch(/case 'apparue':[\s\S]{0,200}canevas\.style\.opacity = '1'/)
    expect(hote).toMatch(/canevas\.animate\(\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/)
    expect(hote).toMatch(/duration: FONDU_ENTREE_MS/)
    // et le Worker la prévient APRÈS la première image, par le même `apparaitre`
    expect(scene).toMatch(/if \(!dansLaPage\) return options\.surApparition\?\.\(\)/)
  })

  it('le fondu ne part qu APRÈS la première image dessinée, une seule fois', () => {
    expect(scene).toMatch(/renderer\.render\(scene, camera\)\s*if \(!apparue\) apparaitre\(\)/)
    expect(scene).toMatch(/if \(!rueCompilee\) return/)
  })

  it('assez long pour se voir, assez court pour ne pas faire attendre', () => {
    expect(FONDU_ENTREE_MS).toBeGreaterThanOrEqual(400)
    expect(FONDU_ENTREE_MS).toBeLessThanOrEqual(2000)
  })

  it('les marques du délai d apparition sont posées, dans l ordre de la vie de la scène', () => {
    expect(Object.values(MARQUES_AVENUE)).toEqual([
      'decor-avenue:cree',
      'decor-avenue:rue-compilee',
      'decor-avenue:rue-visible',
      'decor-avenue:foule-chargee',
      'decor-avenue:foule-visible'
    ])
    for (const cle of Object.keys(MARQUES_AVENUE))
      expect(scene).toMatch(new RegExp(`marquer\\(MARQUES_AVENUE\\.${cle}\\)`))
    // Une scène libérée avant la fin de sa compilation ne marque pas la rue « compilée ».
    expect(scene).toMatch(/if \(vivante\) marquer\(MARQUES_AVENUE\.rueCompilee\)/)
  })
})

/** Lit le JSON d'un fichier glTF binaire : en-tête de 12 octets, puis le premier bloc, toujours le JSON. */
function jsonGlb(nom: string): {
  images?: unknown[]
  animations?: { name: string }[]
  materials?: { name: string; extras?: { couleur?: string | null; normale?: string | null } }[]
  skins?: { joints: number[] }[]
} {
  const octets = readFileSync(new URL(nom, DOSSIER_FOULE))
  expect(octets.readUInt32LE(0), nom).toBe(0x46546c67) // « glTF »
  const longueur = octets.readUInt32LE(12)
  expect(octets.readUInt32LE(16), nom).toBe(0x4e4f534a) // « JSON »
  return JSON.parse(octets.subarray(20, 20 + longueur).toString('utf8'))
}

/**
 * LA FOULE : DES HUMAINS RÉELS, DIRECTION « HEURE DE POINTE » (conv-312).
 *
 * Demande : « /draft les humains les plus realiste possible pour le fond decran d'accueil », puis
 * « Implémenter la 6 · Heure de pointe ». Le casting recopie le brouillon validé ; les fichiers sont
 * ceux de Microsoft Rocketbox, convertis (voir LICENCE-ROCKETBOX.md).
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE BLOC :
 *   1. une image intégrée dans un `.glb` → le chargeur glTF la lit par une adresse `blob:`, que la
 *      politique de sécurité de la page refuse (mesuré le 2026-10-17) : les passants arrivent sans peau ;
 *   2. un passant dont le modèle, la marche ou une texture manque → la foule ne se charge pas ;
 *   3. la marche capturée gardée telle quelle → les passants glissent en avançant deux fois ;
 *   4. une lumière ajoutée par la foule → la rue recompile tous ses programmes à l'arrivée des gens.
 */
describe('fond de l Accueil — la foule réaliste « Heure de pointe »', () => {
  it('18 passants, dans les deux sens, sur les deux trottoirs, comme le brouillon choisi', () => {
    expect(HEURE_DE_POINTE).toHaveLength(18)
    expect(AVENUE.passants).toBe(18)
    expect(new Set(HEURE_DE_POINTE.map((p) => p.sens))).toEqual(new Set([1, -1]))
    // Trottoir de la rambarde à gauche (x < -4), trottoir des façades à droite (x > 4) : jamais sur la chaussée.
    for (const p of HEURE_DE_POINTE) expect(Math.abs(p.x), p.av).toBeGreaterThan(4)
    expect(HEURE_DE_POINTE.filter((p) => p.x < 0).length).toBeGreaterThanOrEqual(6)
    expect(HEURE_DE_POINTE.filter((p) => p.x > 0).length).toBeGreaterThanOrEqual(6)
    // Des corps variés : seize personnes différentes pour dix-huit passants.
    expect(new Set(HEURE_DE_POINTE.map((p) => p.av)).size).toBe(16)
  })

  it('chaque passant a son modèle, sa marche et toutes ses textures, et aucun modèle n intègre d image', () => {
    const marches = jsonGlb('marches.glb')
    expect(marches.animations?.map((a) => a.name).sort()).toEqual([...MARCHES].sort())
    for (const p of HEURE_DE_POINTE) expect(MARCHES, p.av).toContain(p.marche)
    for (const nom of new Set(HEURE_DE_POINTE.map((p) => AVATARS[p.av]))) {
      const glb = jsonGlb(`${nom}.glb`)
      expect(glb.images ?? [], nom).toEqual([])
      // Le squelette de Rocketbox lié à la peau, visage et doigts compris : 80 ou 81 os selon la personne.
      expect(glb.skins?.[0]?.joints.length, nom).toBeGreaterThanOrEqual(80)
      expect(glb.materials?.length, nom).toBeGreaterThanOrEqual(2)
      for (const m of glb.materials ?? []) {
        expect(m.extras?.couleur, `${nom} ${m.name}`).toMatch(/\.webp$/)
        for (const texture of [m.extras?.couleur, m.extras?.normale])
          if (texture)
            expect(() => readFileSync(new URL(texture, DOSSIER_FOULE)), texture).not.toThrow()
      }
    }
  })

  it('la marche capturée est redressée : l avance retirée du clip, la vitesse rendue en m/s', () => {
    // 120 cm en 1,2 s le long de z, avec un balancement latéral de 3 cm dans le cycle.
    const temps = [0, 0.3, 0.6, 0.9, 1.2]
    const valeurs = temps.flatMap((t, i) => [3 * Math.sin((i * Math.PI) / 2), 88, 100 * t])
    const clip = new THREE.AnimationClip('m_walk_test', 1.2, [
      new THREE.VectorKeyframeTrack('Bip01.position', temps, valeurs)
    ])
    expect(redresserMarche(clip)).toBeCloseTo(1, 6)
    const v = clip.tracks[0].values
    // Le départ et l'arrivée coïncident : le clip boucle sur place, les pieds ne glissent plus.
    expect(v[0]).toBeCloseTo(0, 6)
    expect(v[2]).toBeCloseTo(0, 6)
    expect(v[12]).toBeCloseTo(0, 6)
    expect(v[14]).toBeCloseTo(0, 6)
    // La hauteur du bassin et le balancement dans le cycle sont gardés.
    expect(v[1]).toBe(88)
    expect(v[3]).toBeCloseTo(3, 5)
  })

  it('chaque passant est à sa place à l instant de référence, et la foule reste dans sa fenêtre', () => {
    for (const p of HEURE_DE_POINTE)
      expect(positionZ(p, 1.2, FOULE.tRef, 0)).toBeCloseTo(enrouler(p.zf), 9)
    for (const z of [-200, -56.0001, -56, 0, 13.999, 14, 250]) {
      const r = enrouler(z)
      expect(r).toBeGreaterThanOrEqual(FOULE.debut)
      expect(r).toBeLessThan(FOULE.debut + FOULE.fenetre)
    }
    // Il marche dans son sens : 10 s plus tard, celui qui s'éloigne est 10 × sa vitesse plus loin.
    const p = HEURE_DE_POINTE[0]
    expect(p.sens).toBe(1)
    expect(positionZ(p, 1, FOULE.tRef + 10, 0)).toBeCloseTo(enrouler(p.zf - 10), 9)
  })

  it('personne ne traverse la caméra : on s écarte en approchant, on reprend sa file une fois passé', () => {
    const [camX, , camZ] = CAMERA_AVENUE.position
    // La caméra est posée dans la file de gauche : c'est ce qui rend l'écart nécessaire.
    expect(HEURE_DE_POINTE.some((p) => Math.abs(p.x - camX) < ECART_CAMERA.distance)).toBe(true)
    for (const p of HEURE_DE_POINTE) {
      for (let z = camZ - 8; z <= camZ + 8; z += 0.05) {
        const x = ecarterDeLaCamera(p.x, z, camX, camZ)
        // Jamais plus près que l'écart quand on est à hauteur de la caméra.
        if (Math.abs(z - camZ) < ECART_CAMERA.plein)
          expect(Math.abs(x - camX), `${p.av} z=${z.toFixed(2)}`).toBeGreaterThanOrEqual(
            ECART_CAMERA.distance - 1e-9
          )
        // Toujours sur le trottoir (de -7,2 à -4 à gauche).
        if (p.x < 0) expect(x).toBeGreaterThan(-7.2)
        if (p.x < 0) expect(x).toBeLessThan(-4)
      }
      // Loin de la caméra, chacun est dans sa file.
      expect(ecarterDeLaCamera(p.x, camZ - 20, camX, camZ)).toBe(p.x)
    }
    // Un écart continu : pas de saut d'un pas à l'autre.
    let avant = ecarterDeLaCamera(-5.5, camZ - 6, camX, camZ)
    for (let z = camZ - 6; z <= camZ + 6; z += 0.01) {
      const x = ecarterDeLaCamera(-5.5, z, camX, camZ)
      expect(Math.abs(x - avant)).toBeLessThan(0.01)
      avant = x
    }
  })

  it('la foule n ajoute aucune lumière, et décode ses images hors du fil principal', () => {
    // Rien de lourd dans la première image de la foule : sa sphère englobante est posée d'avance
    // (sinon 261 ms de déformation sommet par sommet), ses programmes sont finalisés avant.
    expect(foule).toMatch(/mesh\.boundingSphere = mesh\.geometry\.boundingSphere\.clone\(\)/)
    expect(scene).toMatch(
      /\.then\(\(\) => finaliserProgrammes\(prete\.groupe\)\)\s*\.then\(montrer/
    )
    expect(foule).not.toMatch(/Light\s*\(/)
    expect(foule).toMatch(/createImageBitmap\(/)
    // Elle n'entre dans la scène qu'une fois ses programmes compilés en tâche de fond.
    expect(scene).toMatch(
      /\.then\(\(\) => compilerEnFond\(prete\.groupe, scene\)\)\s*\.then\(\(\) => finaliserProgrammes/
    )
    // Ses textures partent vers la carte graphique une par tâche, avant : d'un bloc, 917 ms de gel.
    expect(scene).toMatch(
      /renderer\.initTexture\(texture\)\s*await new Promise<void>\(\(ok\) => setTimeout\(ok, 0\)\)/
    )
  })
})
