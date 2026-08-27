import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/**
 * Le décor 3D de la page d'accueil : la scène, sans React.
 *
 * Ce fichier RECRÉE en temps réel le monde du fond d'écran que `theme.css` sert aux autres vues
 * (`assets/autowin-galaxy-bg-hq.png`) : centre noir, nébuleuses roses et cyan dans les angles,
 * planètes annelées, arcs orbitaux fins. L'intention n'est pas « un décor spatial » mais CE
 * décor-là — la page d'accueil doit appartenir à l'application, pas ressembler à une autre
 * application posée à côté.
 *
 * Séparé du composant React pour deux raisons : la scène se teste et se relit sans monter
 * d'interface, et le cycle de vie WebGL (création, redimensionnement, libération) est assez pointu
 * pour mériter son propre endroit.
 */

/** Palette reprise de `theme.css` — aucune couleur inventée ici. */
const ROSE = 0xef3f91
const CYAN = 0x49cfff
const GOLD = 0xe9bd4e
const VIOLET = 0x8f7cff
/** L'anthracite des surfaces sombres de `theme.css` — la nappe reste dans le monde de l'app. */
const ANTHRACITE = 0x1b222c

/**
 * L'effacement du canevas, OPAQUE et noir.
 *
 * Ce n'est pas un detail cosmetique : en alpha 0, l'image plate `autowin-galaxy-bg-hq.png` posee sur
 * `body` par `theme.css` passait au travers du canevas, et l'utilisateur voyait l'image au lieu de sa
 * reproduction 3D (conv-1397). Un fond opaque fait du decor la SEULE source du fond sur l'accueil ;
 * le noir est celui du centre du fond d'ecran, donc la jonction avec les bords reste invisible.
 */
export const FOND_DECOR = { couleur: 0x000000, alpha: 1 } as const

/**
 * La CHAÎNE CINÉMATIQUE du décor (demande conv-1402 : « ultra magnifique, effet wow »).
 *
 * Ce qui manquait n'était pas de la matière — la scène en avait déjà beaucoup — mais l'étage qui
 * transforme une accumulation de points additifs en IMAGE. Trois réglages, chacun visible s'il est
 * retiré :
 *  1. `bloom` — les hautes lumières (cœurs de nébuleuse, étoiles franches, limbes de planète)
 *     débordent. C'est LE marqueur d'un rendu de jeu récent ; sans lui, un point additif reste un
 *     point. `seuil` bien au-dessus de zéro : seules les hautes lumières débordent, sinon tout
 *     l'écran laiteux et le texte posé dessus devient illisible ;
 *  2. `exposition` — au-dessus de 1, parce que le tone mapping filmique COMPRIME les hautes
 *     lumières : à exposition 1, l'image sortirait plus sombre qu'avant le changement, ce qui se
 *     lirait comme une régression ;
 *  3. `toneMapping` ACES filmique — les additions saturaient en blanc plat ; ACES tient les
 *     couleurs jusque dans les surbrillances, ce qui garde le rose et le cyan dans les cœurs.
 *
 * Exporté pour être RELU par le test : happy-dom n'a pas de WebGL, mais le réglage est une donnée.
 */
export const POST_TRAITEMENT = {
  toneMapping: 'ACESFilmic',
  exposition: 1.18,
  bloom: { force: 1.05, rayon: 0.78, seuil: 0.24 }
} as const

/**
 * Les ÉTOILES FILANTES : l'événement rare du décor.
 *
 * C'est ce qui sépare un fond d'écran d'une image — quelque chose ARRIVE. Le réglage est tenu du
 * côté de la rareté : peu de filantes, une traînée courte, et une période longue par filante, avec
 * une phase propre. À période courte, il en passe une toutes les deux secondes et le décor devient
 * bruyant ; synchronisées, elles partiraient en salve, ce qui se lit immédiatement comme un effet.
 */
export const FILANTES = {
  nombre: 7,
  /** Secondes entre deux passages d'une MÊME filante. */
  periode: 26,
  /** Durée d'un passage, en secondes. Fraction de la période : c'est ce rapport qui fait la rareté. */
  duree: 1.5,
  /** Nombre de points qui composent la traînée d'une filante. */
  segments: 28
} as const

const FILANTE_VERTEX_SHADER = [
  'attribute float aTrainee;',
  'attribute vec3 aDirection;',
  'attribute vec2 aCycle;', // x = phase de départ (s), y = longueur de la traînée
  'uniform float uTime;',
  'uniform float uFilantePeriode;',
  'uniform float uFilanteDuree;',
  'uniform float uPixelRatio;',
  'uniform float uEchelle;',
  'varying float vTrainee;',
  'varying float vIntensite;',
  'varying vec3 vColor;',
  'void main() {',
  '  vColor = color;',
  '  vTrainee = aTrainee;',
  '  float cycle = mod(uTime + aCycle.x, uFilantePeriode);',
  '  float t = cycle / uFilanteDuree;',
  // Hors de sa fenêtre, la filante n'existe pas : intensité nulle, le fragment sera jeté. Une
  // filante qui reste visible entre deux passages serait une barre fixe dans le ciel.
  '  float active = step(t, 1.0);',
  // Allumage et extinction progressifs : un saut d'opacité se voit comme une apparition.
  '  float fondu = sin(clamp(t, 0.0, 1.0) * 3.14159265) ;',
  '  vIntensite = active * fondu * (1.0 - aTrainee * 0.92);',
  // La tête avance le long de la trajectoire ; chaque point de la traînée traîne derrière elle.
  '  vec3 dir = normalize(aDirection);',
  '  float parcours = (t * 2.1 - aTrainee * aCycle.y) * uEchelle;',
  '  vec3 p = position * uEchelle + dir * parcours;',
  '  vec4 view = modelViewMatrix * vec4(p, 1.0);',
  '  gl_Position = projectionMatrix * view;',
  // La tête est plus grosse que la queue : c'est ce dégradé de TAILLE, autant que d'opacité, qui
  // fait lire une traînée plutôt qu'un chapelet de points.
  '  gl_PointSize = uPixelRatio * (1.0 - aTrainee * 0.75) * (46.0 / -view.z);',
  '}'
].join('\n')

/**
 * Le fragment d'une filante : un grain rond, dégradé le long de la traînée.
 *
 * Exporté pour être RELU par le test — sans gradient sur `vTrainee`, une étoile filante n'est
 * qu'un point qui se déplace.
 */
export const FILANTE_FRAGMENT_SHADER = [
  'precision highp float;',
  'varying float vTrainee;',
  'varying float vIntensite;',
  'varying vec3 vColor;',
  'void main() {',
  '  if (vIntensite <= 0.001) discard;',
  '  float d = length(gl_PointCoord - vec2(0.5));',
  '  float falloff = 1.0 - smoothstep(0.0, 0.5, d);',
  '  if (falloff <= 0.002) discard;',
  // La tête tire vers le blanc chaud, la queue garde la teinte : une traînée monochrome est plate.
  '  vec3 couleur = mix(vColor, vec3(1.0, 0.96, 0.88), pow(1.0 - vTrainee, 3.0));',
  '  gl_FragColor = vec4(couleur, pow(falloff, 1.6) * vIntensite);',
  '}'
].join('\n')

/**
 * La couche des filantes : UNE géométrie de points pour toutes, animée dans le vertex shader.
 *
 * Tout est calculé sur le GPU depuis la phase de chaque filante : côté JavaScript, une filante ne
 * coûte rien par image, et il n'y a aucun état à synchroniser avec la boucle de rendu.
 */
function buildFilantes(random: () => number): THREE.Points {
  const total = FILANTES.nombre * FILANTES.segments
  const positions = new Float32Array(total * 3)
  const colors = new Float32Array(total * 3)
  const directions = new Float32Array(total * 3)
  const trainees = new Float32Array(total)
  const cycles = new Float32Array(total * 2)
  const teinte = new THREE.Color()

  for (let f = 0; f < FILANTES.nombre; f += 1) {
    // Un départ dans le champ, jamais au centre : le milieu de l'écran porte les widgets.
    const depart = new THREE.Vector3(
      (random() - 0.5) * 1.8,
      0.35 + random() * 0.75,
      -0.5 - random() * 0.5
    )
    // Une descente en biais : une filante horizontale ou verticale se lit comme une barre.
    const direction = new THREE.Vector3(random() > 0.5 ? -1 : 1, -0.45 - random() * 0.5, 0)
    const phase = random() * FILANTES.periode
    const longueur = 0.18 + random() * 0.22
    teinte.setHex(random() > 0.6 ? CYAN : 0xffffff)
    teinte.lerp(new THREE.Color(GOLD), random() * 0.35)

    for (let s = 0; s < FILANTES.segments; s += 1) {
      const i = f * FILANTES.segments + s
      const o = i * 3
      positions[o] = depart.x
      positions[o + 1] = depart.y
      positions[o + 2] = depart.z
      directions[o] = direction.x
      directions[o + 1] = direction.y
      directions[o + 2] = direction.z
      colors[o] = teinte.r
      colors[o + 1] = teinte.g
      colors[o + 2] = teinte.b
      trainees[i] = s / (FILANTES.segments - 1)
      cycles[i * 2] = phase
      cycles[i * 2 + 1] = longueur
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aDirection', new THREE.BufferAttribute(directions, 3))
  geometry.setAttribute('aTrainee', new THREE.BufferAttribute(trainees, 1))
  geometry.setAttribute('aCycle', new THREE.BufferAttribute(cycles, 2))

  return new THREE.Points(
    geometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uEchelle: { value: 1 },
        uFilantePeriode: { value: FILANTES.periode },
        uFilanteDuree: { value: FILANTES.duree }
      },
      vertexShader: FILANTE_VERTEX_SHADER,
      fragmentShader: FILANTE_FRAGMENT_SHADER
    })
  )
}

/**
 * Les directions visuelles du décor, entre lesquelles l'utilisateur choisit.
 *
 * Ce ne sont PAS des variantes cosmétiques : chacune se distingue des autres sur au moins deux axes —
 * le sujet dominant, la densité de matière, le langage formel (matière diffuse contre ligne), l'usage
 * de l'accent, et le régime de mouvement. Toutes restent dans le monde déjà validé par l'utilisateur :
 * centre noir, nébuleuses roses et cyan, or pour la structure.
 */
export type DecorVariant = 'actuel' | 'limbe' | 'poussiere' | 'orbites' | 'nappe'

export const DECOR_VARIANTS: readonly { id: DecorVariant; nom: string; resume: string }[] = [
  {
    id: 'actuel',
    nom: 'Actuel',
    resume: 'quatre nébuleuses aux angles, trois planètes annelées, arcs discrets'
  },
  {
    id: 'limbe',
    nom: 'Limbe',
    resume: 'UNE géante annelée au bord, cadrée serré, peu de matière, mouvement lent'
  },
  {
    id: 'poussiere',
    nom: 'Poussière',
    resume: 'que de la matière : filaments sur six plans, forte parallaxe, aucune silhouette'
  },
  {
    id: 'orbites',
    nom: 'Orbites',
    resume: 'géométrie plutôt que matière : arcs fins en or et cyan, satellites qui glissent dessus'
  },
  {
    id: 'nappe',
    nom: 'Nappe',
    resume:
      'une seule nappe de bruit organique, dégradé or sur anthracite, dérive très lente, aucune silhouette'
  }
]

export interface DecorScene {
  /** Avance la scène. `elapsed` en secondes, `look` = regard normalisé dans [-1, 1]. */
  render(elapsed: number, look: { x: number; y: number }): void
  resize(width: number, height: number): void
  dispose(): void
  readonly canvas: HTMLCanvasElement
}

/** Un tirage déterministe : deux lancements donnent le MÊME ciel, sinon le décor « bouge » entre deux ouvertures. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * Le champ d'étoiles. Deux populations distinctes : une poussière dense et fine partout, et quelques
 * étoiles franches. Une seule population donne soit un brouillard, soit un ciel troué — jamais un
 * ciel.
 */
function buildStars(random: () => number): THREE.Points {
  const COUNT = 2600
  const positions = new Float32Array(COUNT * 3)
  const colors = new Float32Array(COUNT * 3)
  const sizes = new Float32Array(COUNT)
  const tint = new THREE.Color()

  for (let i = 0; i < COUNT; i += 1) {
    const o = i * 3
    // Réparties dans une coquille : au plus près, une étoile passerait devant les planètes.
    const radius = 42 + random() * 46
    const theta = random() * Math.PI * 2
    const phi = Math.acos(random() * 2 - 1)
    positions[o] = Math.sin(phi) * Math.cos(theta) * radius
    positions[o + 1] = Math.cos(phi) * radius * 0.72
    positions[o + 2] = Math.sin(phi) * Math.sin(theta) * radius

    const bright = random()
    // Les étoiles franches sont rares (8 %) mais c'est elles qu'on voit ; le reste fait la matière.
    sizes[i] = bright > 0.92 ? 1.5 + random() * 1.6 : 0.35 + random() * 0.5
    tint.setHex(bright > 0.88 ? (random() > 0.5 ? CYAN : GOLD) : 0xffffff)
    tint.lerp(new THREE.Color(0xffffff), 0.45)
    colors[o] = tint.r
    colors[o + 1] = tint.g
    colors[o + 2] = tint.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: `
      attribute float aSize;
      varying vec3 vColor;
      varying float vTwinkle;
      uniform float uTime;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        // Scintillement désynchronisé par la position : un scintillement global ferait clignoter
        // tout le ciel en même temps, ce qui se lit immédiatement comme un effet.
        vTwinkle = 0.72 + 0.28 * sin(uTime * 1.6 + position.x * 0.7 + position.z * 0.4);
        gl_PointSize = aSize * uPixelRatio * (52.0 / -view.z);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        // Grain rond à bord doux : un carré se voit et casse l'illusion.
        float d = length(gl_PointCoord - vec2(0.5));
        float falloff = 1.0 - smoothstep(0.1, 0.5, d);
        if (falloff <= 0.002) discard;
        gl_FragColor = vec4(vColor, falloff * vTwinkle);
      }
    `,
    vertexColors: true
  })

  return new THREE.Points(geometry, material)
}

/**
 * L'ÉCLAT des lunes (les corps annelés du décor), demandé en baisse le 2026-08-26 : « les lunes
 * sont trop lumineuses ».
 *
 * Ce qui brillait n'était pas la surface — elle est éclairée par un terminateur — mais deux couches
 * ADDITIVES dont l'opacité était écrite en dur dans les shaders : le halo atmosphérique (0,55) et
 * les anneaux (0,62). Additives et reprises par le bloom, elles se cumulaient en une auréole
 * laiteuse. Réglages sortis en constante pour être relus par le test, faute de WebGL en test.
 */
export const ECLAT_LUNES = {
  /** Opacité du halo sur le limbe. */
  halo: 0.3,
  /** Puissance du limbe : plus haute = lueur collée au bord au lieu de baigner le disque. */
  limbe: 4.2,
  /** Opacité du premier anneau ; les suivants décroissent. */
  anneau: 0.42
} as const

/**
 * La SURFACE des petites lunes (`buildLune`), corrigée le 2026-08-26 : « on dirait des soleils ».
 *
 * `buildLune` réutilise le shader des planètes ; or ce shader ajoute `uClair` sur le LIMBE
 * (`couleur += uClair * rim * …`). Sur une bille de rayon 0,15, le limbe couvre presque tout le
 * disque à l'écran : avec un `uClair` à 60 % de blanc, il ne restait qu'un halo blanc. On atténue
 * donc DEUX choses, et seulement pour les lunes : le mélange vers le blanc, et le poids du limbe.
 */
export const SURFACE_LUNE = {
  /**
   * Part de blanc dans le ton clair des crêtes (planètes : 0,6 vers un blanc chaud).
   *
   * 0,06 : plancher pratique. Le test de contrat exige `> 0,05`, garde-fou contre une lune plate ;
   * on s'y range au plus près après trois passes « encore trop lumineuses » (conv-1410, conv-1426).
   */
  clair: 0.06,
  /**
   * Poids du limbe, INDÉPENDANT de la couleur. 1 = celui des planètes.
   *
   * À 1 ce curseur n'atténue rien aujourd'hui — et c'est assumé : sa valeur n'est pas dans son
   * réglage actuel mais dans son EXISTENCE. Avant lui, assombrir le limbe obligeait à toucher la
   * couleur, les deux effets étant confondus dans un seul nombre. C'est l'apport réel de la branche.
   */
  rim: 0.12,
  /**
   * Gain appliqué à la TEINTE de la lune avant tout éclairage (1 = teinte nominale).
   *
   * Troisième curseur, ajouté le 2026-08-27 parce que les deux autres touchaient leur plancher et
   * que la lune restait trop claire : `clair` et `rim` ne portent que les crêtes et le limbe,
   * jamais le corps du globe. Ce facteur assombrit la matière elle-même — le seul levier restant.
   */
  gain: 0.45
} as const

/**
 * La MATIÈRE du nuage (les nébuleuses), refaite le 2026-08-26 : « le nuage est moche ».
 *
 * Le défaut nommé : un amas presque isotrope dont le cœur était blanchi (lerp 0,42 vers le blanc) et
 * rendu à alpha 0,5 — sous le bloom, cela se lit comme du coton gris, pas comme un filament. La
 * correction garde le même nombre de points mais les organise : étirement franchement anisotrope,
 * plusieurs bras de filament, cœur beaucoup moins désaturé, alpha plus bas.
 */
export const MATIERE_NUAGE = {
  /** Combien de bras de filament structurent l'amas. 1 = boule de coton. */
  filaments: 3,
  /** Étirement du nuage : x nettement > y, sinon c'est une boule. */
  etirement: { x: 3.1, y: 1.15, z: 0.7 },
  /** Blanchiment du cœur du filament. Trop haut = aplat laiteux. */
  blancCoeur: 0.24,
  /** Opacité d'un grain. */
  alpha: 0.34
} as const

/**
 * Une nébuleuse : un amas de points colorés, étiré et posé dans un angle du champ.
 *
 * C'est le motif dominant du fond d'écran d'origine — des filaments roses et cyan qui montent des
 * coins vers le centre en laissant le milieu noir. Rendu en points plutôt qu'en image : une image
 * plaquée ne réagirait pas à la parallaxe, et c'est précisément la réaction qui fait la 3D.
 */
function buildNebula(
  random: () => number,
  options: { center: THREE.Vector3; color: number; secondary: number; scale: number }
): THREE.Points {
  const COUNT = 5200
  const positions = new Float32Array(COUNT * 3)
  const colors = new Float32Array(COUNT * 3)
  const sizes = new Float32Array(COUNT)
  const primary = new THREE.Color(options.color)
  const secondary = new THREE.Color(options.secondary)
  const scratch = new THREE.Color()

  for (let i = 0; i < COUNT; i += 1) {
    const o = i * 3
    // Trois axes d'étirement différents : une nébuleuse sphérique ressemble à une boule de coton.
    // Puissance 2 sur le tirage pour concentrer la matière au coeur du filament.
    const t = random()
    const spread = Math.pow(t, 2)
    const angle = random() * Math.PI * 2
    // Plusieurs bras au lieu d'un seul, et un pli secondaire plus rapide : c'est ce qui donne au
    // nuage un dessin de filament plutôt qu'un contour de boule.
    const arm = Math.sin(angle * MATIERE_NUAGE.filaments + t * 5.5)
    const pli = Math.sin(angle * (MATIERE_NUAGE.filaments * 2 + 1) + t * 9.1) * 0.35
    // Le grain se serre vers le coeur du bras : `bras` proche de 1 = sur le filament.
    const bras = Math.pow(Math.abs(arm), 1.6)
    positions[o] =
      options.center.x +
      (Math.cos(angle) * spread * MATIERE_NUAGE.etirement.x + (arm + pli) * 0.9) * options.scale
    positions[o + 1] =
      options.center.y +
      (Math.sin(angle) * spread * MATIERE_NUAGE.etirement.y + (arm - pli) * 0.45) * options.scale
    positions[o + 2] =
      options.center.z + (random() - 0.5) * MATIERE_NUAGE.etirement.z * options.scale

    scratch.copy(primary).lerp(secondary, Math.pow(random(), 1.4))
    // Le coeur du filament est plus clair : sans ce gradient, la nébuleuse est un aplat coloré.
    // Le blanchiment suit le BRAS, pas seulement le centre : la lumière dessine la structure.
    scratch.lerp(
      new THREE.Color(0xffffff),
      Math.max(0, MATIERE_NUAGE.blancCoeur - spread * 0.5) * bras
    )
    colors[o] = scratch.r
    colors[o + 1] = scratch.g
    colors[o + 2] = scratch.b
    sizes[i] = (0.9 + random() * 2.6) * (1.25 - spread * 0.55)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uAlpha: { value: MATIERE_NUAGE.alpha }
    },
    vertexShader: `
      attribute float aSize;
      varying vec3 vColor;
      uniform float uTime;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec3 p = position;
        // Respiration lente et désynchronisée : la nébuleuse vit sans qu'on voie une animation.
        p += vec3(
          sin(uTime * 0.12 + p.y * 0.5),
          cos(uTime * 0.1 + p.x * 0.4),
          sin(uTime * 0.08 + p.z * 0.6)
        ) * 0.14;
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = aSize * uPixelRatio * (46.0 / -view.z);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      uniform float uAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float falloff = 1.0 - smoothstep(0.0, 0.5, d);
        if (falloff <= 0.002) discard;
        // Puissance 2.4 : un dégradé trop plat donne des disques nets, donc du confetti.
        gl_FragColor = vec4(vColor, pow(falloff, 2.4) * uAlpha);
      }
    `,
    vertexColors: true
  })

  return new THREE.Points(geometry, material)
}

/**
 * La DIRECTION de la lumière du monde, normalisée — la même valeur que la `DirectionalLight` de la
 * scène, en une seule source.
 *
 * Les shaders de planète et d'anneau éclairent EUX-MÊMES leur surface (ils ne passent pas par le
 * pipeline standard). Sans constante partagée, un terminateur peint d'un côté et une ombre d'anneau
 * portée de l'autre : le défaut se voit tout de suite, et rien ne le rattrape.
 */
const SOLEIL = new THREE.Vector3(-9, 5, 7).normalize()

/** Bruit fractal 3D, partagé par la surface et les anneaux : valeur-bruit sur 5 octaves. */
const GLSL_FBM = [
  'float hash31(vec3 p) {',
  '  p = fract(p * 0.3183099 + vec3(0.1, 0.71, 0.37));',
  '  p *= 17.0;',
  '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));',
  '}',
  'float bruit(vec3 x) {',
  '  vec3 i = floor(x);',
  '  vec3 f = fract(x);',
  '  f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),',
  '                 mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),',
  '             mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),',
  '                 mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);',
  '}',
  'float fbm(vec3 p) {',
  '  float somme = 0.0;',
  '  float amplitude = 0.5;',
  '  for (int o = 0; o < 5; o += 1) {',
  '    somme += amplitude * bruit(p);',
  '    p *= 2.03;',
  '    amplitude *= 0.5;',
  '  }',
  '  return somme;',
  '}'
].join('\n')

const PLANETE_VERTEX_SHADER = [
  'varying vec3 vObjet;',
  'varying vec3 vNormaleMonde;',
  'varying vec3 vVue;',
  'void main() {',
  '  vObjet = normalize(position);',
  '  vNormaleMonde = normalize(mat3(modelMatrix) * normal);',
  '  vec4 vue = modelViewMatrix * vec4(position, 1.0);',
  '  vVue = -vue.xyz;',
  '  gl_Position = projectionMatrix * vue;',
  '}'
].join('\n')

/**
 * La SURFACE d'une planète, calculée pixel par pixel (refonte demandée en conv-1400).
 *
 * Avant, le globe était une couleur UNIE sur une sphère : une bille de plastique. Quatre choix
 * portent le détail, et chacun se voit s'il est retiré :
 *  1. le bruit est FRACTAL (5 octaves) — une seule octave donne des taches molles, pas des continents ;
 *  2. il est ÉTIRÉ en latitude par uBandes : c'est l'étirement qui fait la géante gazeuse ; un bruit
 *     isotrope donne du camouflage militaire ;
 *  3. la lumière vient de uLumiere, la MÊME que la scène, avec un terminateur ADOUCI (bascule
 *     commencée sous zéro) — une coupure nette donne un croissant de carton ;
 *  4. la face nuit garde uNuit, une braise très basse : à zéro, la planète est amputée sur le fond
 *     noir et la silhouette disparaît.
 *
 * uSeed est ce qui rend chaque planète unique : même code, relief différent.
 *
 * Exporté pour être RELU par le test : happy-dom n'a pas de WebGL, mais le contrat du shader est du
 * texte, et il se vérifie.
 */
export const PLANETE_FRAGMENT_SHADER = [
  'precision highp float;',
  'uniform vec3 uBase;',
  'uniform vec3 uClair;',
  'uniform vec3 uSombre;',
  'uniform vec3 uNuit;',
  'uniform vec3 uLumiere;',
  'uniform float uBandes;',
  'uniform float uRim;',
  'uniform float uSeed;',
  'uniform float uTime;',
  'varying vec3 vObjet;',
  'varying vec3 vNormaleMonde;',
  'varying vec3 vVue;',
  GLSL_FBM,
  'void main() {',
  '  vec3 graine = vec3(uSeed * 13.7, uSeed * 7.1, uSeed * 3.3);',
  '  vec3 p = vec3(vObjet.x, vObjet.y * uBandes, vObjet.z) * 2.4 + graine;',
  '  float turbulence = fbm(p + vec3(uTime * 0.02, 0.0, 0.0));',
  '  float volute = fbm(p * 0.45 + turbulence * 1.7 + graine.zxy);',
  // WARP DE DOMAINE : le bruit est replié sur lui-même avant d'être re-échantillonné. C'est ce pli
  // qui donne des bords de continents SINUEUX ; sans lui, le fbm seul fait des taches convexes.
  '  vec3 pw = p + vec3(volute, turbulence, volute * 0.7) * 1.35;',
  // CRÊTES RIDGED (1 - |2f-1|) : des lignes de relief au lieu de nappes molles — chaînes de
  // montagnes et bords de tempêtes.
  '  float ridged = pow(clamp(1.0 - abs(fbm(pw * 1.9) * 2.0 - 1.0), 0.0, 1.0), 2.1);',
  '  float matiere = clamp(turbulence * 0.62 + volute * 0.52, 0.0, 1.0);',
  '  float cretes = pow(smoothstep(0.46, 0.88, matiere), 1.25);',
  '  vec3 albedo = mix(uSombre, uBase, smoothstep(0.22, 0.64, matiere));',
  '  albedo = mix(albedo, uClair, cretes * 0.72 + ridged * 0.20);',
  // VEINAGE fin : une troisième échelle assombrissante, sinon la surface n'a que deux fréquences.
  '  albedo = mix(albedo, uSombre, 0.32 * pow(clamp(fbm(p * 3.7 + graine.yzx), 0.0, 1.0), 1.6));',
  // GRAIN serré (320 au lieu de 140) : le pixel proche cesse d'être lisse à l écran.
  '  albedo *= 0.94 + 0.10 * bruit(vObjet * 320.0 + graine);',
  '  vec3 n = normalize(vNormaleMonde);',
  '  vec3 v = normalize(vVue);',
  // Le relief MORD sur l éclairage : les crêtes projettent leur propre ombre approchée, ce qui
  // sculpte le terminateur au lieu de le laisser lisse.
  '  float relief = (ridged - 0.5) * 0.55 + (matiere - 0.5) * 0.35;',
  '  float incidence = dot(n, normalize(uLumiere)) - relief * 0.11;',
  '  float jour = smoothstep(-0.22, 0.45, incidence);',
  // LUMINOSITÉ BAISSÉE (demande conv-1451) : gain de jour 1.15 -> 0.70, ambiante 0.08 -> 0.05,
  // braise de nuit et limbe atténués dans la même proportion. Les planètes se posent dans le fond
  // sombre au lieu de brûler ; le détail ci-dessus reste lisible parce qu il vient de l ALBEDO.
  '  vec3 couleur = albedo * (0.05 + 0.70 * jour);',
  '  couleur += uNuit * (1.0 - jour) * (0.16 + 0.24 * cretes);',
  '  float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.8);',
  '  couleur += uClair * rim * uRim * (0.30 + 0.55 * jour) * 0.45;',
  '  gl_FragColor = vec4(couleur, 1.0);',
  '}'
].join('\n')

const ANNEAU_VERTEX_SHADER = [
  'uniform mat3 uOrientation;',
  'uniform float uInterieur;',
  'uniform float uExterieur;',
  'varying float vRadius;',
  'varying vec3 vRelatif;',
  'void main() {',
  '  float r = length(position.xy);',
  '  vRadius = clamp((r - uInterieur) / max(uExterieur - uInterieur, 0.0001), 0.0, 1.0);',
  '  vRelatif = uOrientation * position;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}'
].join('\n')

/**
 * Les ANNEAUX, en matière et non plus en fil de fer.
 *
 * Avant la refonte, c'étaient des lignes : des cercles d'un pixel. Ici, un disque de géométrie dont
 * la densité est calculée le long du RAYON :
 *  1. des sillons concentriques par bruit fractal — l'anneau a un grain ;
 *  2. des DIVISIONS franches (discard) : une lacune de type Cassini est un TROU, pas une baisse
 *     d'opacité, qui se lirait comme une salissure ;
 *  3. l'OMBRE PORTÉE du globe sur l'anneau, calculée depuis la position du point relative au centre :
 *     sans elle, l'anneau brille derrière la face nuit, et c'est CE détail qui trahit un anneau
 *     décoratif.
 */
export const ANNEAU_FRAGMENT_SHADER = [
  'precision highp float;',
  'uniform vec3 uCouleur;',
  'uniform vec3 uLumiere;',
  'uniform float uRayonGlobe;',
  'uniform float uOmbre;',
  'uniform float uSeed;',
  'uniform float uOpacite;',
  'varying float vRadius;',
  'varying vec3 vRelatif;',
  GLSL_FBM,
  'void main() {',
  '  float grain = fbm(vec3(vRadius * 26.0, uSeed * 5.0, 0.0));',
  '  float sillons = fbm(vec3(vRadius * 90.0, uSeed, 0.0));',
  '  float densite = grain * 0.75 + sillons * 0.45;',
  '  densite *= smoothstep(0.0, 0.12, vRadius) * (1.0 - smoothstep(0.82, 1.0, vRadius));',
  '  if (densite < 0.2) discard;',
  '  vec3 l = normalize(uLumiere);',
  '  float t = dot(vRelatif, l);',
  '  float distanceAxe = length(vRelatif - l * t);',
  '  float ombre = t < 0.0 ? smoothstep(uRayonGlobe * 1.05, uRayonGlobe * 0.72, distanceAxe) : 0.0;',
  '  vec3 couleur = uCouleur * (0.55 + 0.9 * densite) * mix(1.0, 1.0 - uOmbre, ombre);',
  '  gl_FragColor = vec4(couleur, clamp(densite, 0.0, 1.0) * uOpacite);',
  '}'
].join('\n')

/**
 * LES LUNES (demande conv-1408 : « des lunes autour des planetes »).
 *
 * Réglage tenu en fractions du RAYON de la planète, parce qu'une lune vit dans le repère local de sa
 * planète : le groupe est mis à l'échelle par `resize`, donc une distance en unités monde produirait
 * une lune collée sur une petite planète et perdue autour d'une grande.
 *
 * `rayonMin` est au-delà des anneaux les plus proches (premier anneau intérieur = 1,45 rayon) : une
 * lune posée en dessous serait enfouie dans la matière de l'anneau au lieu de tourner autour.
 */
export const LUNES = {
  /** Rayon d'orbite minimal, en rayons de planète. */
  rayonMin: 1.9,
  /** Écart entre deux orbites successives : c'est lui qui empêche deux lunes de se superposer. */
  ecart: 0.55,
  /** Vitesse angulaire de référence ; divisée par le rayon, comme une orbite réelle. */
  vitesse: 0.85,
  /** Taille d'une lune, en rayons de planète. Petite : une lune de la taille du globe se lit comme une seconde planète. */
  taille: 0.15
} as const

/**
 * La position d'une lune sur son orbite, dans le repère LOCAL de sa planète.
 *
 * Fonction PURE, et c'est délibéré : happy-dom n'a pas de WebGL, donc « elles tournent » ne peut se
 * prouver que sur une valeur calculable hors GPU. Deux propriétés portent la demande — la position
 * change avec le temps (elle tourne), le RAYON ne change pas (elle ne s'échappe pas).
 */
export function orbiteLune(
  index: number,
  total: number,
  temps: number
): { x: number; y: number; z: number } {
  const rayon = LUNES.rayonMin + (index + 1) * LUNES.ecart
  // Une phase de départ propre par lune : à phase égale, les lunes d'une planète partent en file.
  const phase = (index / Math.max(total, 1)) * Math.PI * 2
  const angle = phase + (temps * LUNES.vitesse) / rayon
  // Chaque orbite a son inclinaison : coplanaires, les lunes se liraient comme un collier plat.
  const inclinaison = 0.32 + index * 0.44
  return {
    x: Math.cos(angle) * rayon,
    y: Math.sin(angle) * rayon * Math.sin(inclinaison),
    z: Math.sin(angle) * rayon * Math.cos(inclinaison)
  }
}

/**
 * Une lune : un petit globe, éclairé par le MÊME soleil que sa planète.
 *
 * Elle réutilise le shader de surface des planètes plutôt qu'une couleur unie : une bille lisse à
 * côté d'un globe détaillé se voit immédiatement. `bandes` bas — une lune n'est pas une géante
 * gazeuse, son relief est cratérisé donc isotrope.
 */
function buildLune(seed: number, teinte: number): THREE.Mesh {
  const base = new THREE.Color(teinte).multiplyScalar(SURFACE_LUNE.gain)
  return new THREE.Mesh(
    new THREE.SphereGeometry(LUNES.taille, 32, 20),
    new THREE.ShaderMaterial({
      vertexShader: PLANETE_VERTEX_SHADER,
      fragmentShader: PLANETE_FRAGMENT_SHADER,
      uniforms: {
        uBase: { value: base },
        // `uClair` sert AUSSI de couleur de rim dans PLANETE_FRAGMENT_SHADER. Sur un globe de 0,15
        // rayon, ce rim recouvre presque tout le disque à l'écran : à 0,6 de blanc la lune ne se lit
        // plus que comme une boule de lumière (« on dirait des soleils », conv-1410).
        //
        // FUSION de deux corrections concurrentes du MÊME défaut, le 2026-08-26. `86baa8f6` (déjà
        // dans l'arbre) baissait `uClair` à 0,14 sans test ; la branche de secours
        // `run-aac6581e8933-1`, restée non publiée, apportait DEUX curseurs séparés et un test de
        // contrat. On garde sa structure — meilleure — et le rendu de `86baa8f6`, que l'utilisateur
        // a sous les yeux et a explicitement choisi de conserver.
        uClair: { value: base.clone().lerp(new THREE.Color(0xffffff), SURFACE_LUNE.clair) },
        uSombre: { value: base.clone().multiplyScalar(0.28) },
        uNuit: { value: base.clone().multiplyScalar(0.07) },
        uLumiere: { value: SOLEIL.clone() },
        uBandes: { value: 1.1 },
        uRim: { value: SURFACE_LUNE.rim },
        uSeed: { value: seed },
        uTime: { value: 0 }
      }
    })
  )
}

/**
 * Une planète annelée, ULTRA détaillée (demande conv-1400).
 *
 * Le globe porte un shader de surface (continents fractals, bandes, terminateur adouci, limbe) ; ses
 * anneaux sont des disques de matière troués par des divisions, sur lesquels le globe projette son
 * ombre. Rien n'est texturé : tout est CALCULÉ — le décor reste synthétique, comme décidé en conv-1399.
 */
function buildPlanet(options: {
  radius: number
  position: THREE.Vector3
  color: number
  ringColor: number
  rings: number
  tilt: number
  seed: number
  bandes: number
  lunes: number
}): { group: THREE.Group; lunes: THREE.Mesh[] } {
  const group = new THREE.Group()
  group.position.copy(options.position)

  const base = new THREE.Color(options.color)
  // Les trois tons de la surface DÉRIVENT de la couleur de la planète : la palette du décor reste
  // celle de theme.css, le détail ne l'élargit pas.
  const clair = base.clone().lerp(new THREE.Color(0xffeecd), 0.44)
  const sombre = base.clone().multiplyScalar(0.42)

  const surface = new THREE.ShaderMaterial({
    vertexShader: PLANETE_VERTEX_SHADER,
    fragmentShader: PLANETE_FRAGMENT_SHADER,
    uniforms: {
      uBase: { value: base },
      uClair: { value: clair },
      uSombre: { value: sombre },
      uNuit: { value: new THREE.Color(options.ringColor).multiplyScalar(0.22) },
      uLumiere: { value: SOLEIL.clone() },
      uBandes: { value: options.bandes },
      uRim: { value: 1 },
      uSeed: { value: options.seed },
      uTime: { value: 0 }
    }
  })

  // 96x64 : à 48x32 (l'ancien maillage), la silhouette d'une grande planète était un polygone
  // visible — aucun détail de surface ne rattrape un contour facetté.
  const globe = new THREE.Mesh(new THREE.SphereGeometry(options.radius, 96, 64), surface)
  group.add(globe)

  // Halo atmosphérique : une seconde sphère à peine plus grande, rendue par sa FACE INTERNE, dont
  // l'opacité croît sur le limbe. C'est ce liseré qui empêche la planète d'être un autocollant.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(options.radius * 1.14, 40, 26),
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(options.ringColor) },
        uOpaciteHalo: { value: ECLAT_LUNES.halo },
        uLimbe: { value: ECLAT_LUNES.limbe }
      },
      vertexShader: [
        'varying vec3 vNormal;',
        'varying vec3 vView;',
        'void main() {',
        '  vNormal = normalize(normalMatrix * normal);',
        '  vec4 view = modelViewMatrix * vec4(position, 1.0);',
        '  vView = -view.xyz;',
        '  gl_Position = projectionMatrix * view;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor;',
        'uniform float uOpaciteHalo;',
        'uniform float uLimbe;',
        'varying vec3 vNormal;',
        'varying vec3 vView;',
        'void main() {',
        '  float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));',
        '  gl_FragColor = vec4(uColor, pow(rim, uLimbe) * uOpaciteHalo);',
        '}'
      ].join('\n')
    })
  )
  group.add(halo)

  for (let i = 0; i < options.rings; i += 1) {
    const interieur = options.radius * (1.45 + i * 0.42)
    const exterieur = interieur + options.radius * (0.44 + i * 0.1)
    const materiau = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: ANNEAU_VERTEX_SHADER,
      fragmentShader: ANNEAU_FRAGMENT_SHADER,
      uniforms: {
        uCouleur: { value: new THREE.Color(options.ringColor) },
        uLumiere: { value: SOLEIL.clone() },
        uRayonGlobe: { value: options.radius },
        uOmbre: { value: 0.82 },
        uSeed: { value: options.seed + i * 4.3 },
        uOpacite: { value: ECLAT_LUNES.anneau - i * 0.09 },
        uInterieur: { value: interieur },
        uExterieur: { value: exterieur },
        uOrientation: { value: new THREE.Matrix3() }
      }
    })
    // 256 segments : en dessous, le bord de l'anneau devient un polygone à l'écran.
    const anneau = new THREE.Mesh(new THREE.RingGeometry(interieur, exterieur, 256, 3), materiau)
    anneau.rotation.x = Math.PI / 2 - options.tilt
    anneau.rotation.z = options.tilt * 0.4
    // L'orientation de l'anneau, figée dans un uniform : le shader en a besoin pour replacer chaque
    // point dans le repère du globe et savoir s'il tombe dans son ombre.
    anneau.updateMatrix()
    materiau.uniforms.uOrientation.value.setFromMatrix4(anneau.matrix)
    group.add(anneau)
  }

  // Les lunes sont AJOUTÉES AU GROUPE de la planète : c'est ce qui les fait suivre son cadrage et sa
  // parallaxe. Posées dans la scène, elles resteraient au centre du monde pendant que la planète
  // migre vers son coin — donc « autour de rien ».
  const lunes: THREE.Mesh[] = []
  for (let i = 0; i < options.lunes; i += 1) {
    const lune = buildLune(options.seed * 3.1 + i * 9.7, i % 2 === 0 ? 0xbfc6d4 : 0x9aa2b4)
    const p = orbiteLune(i, options.lunes, 0)
    lune.position.set(p.x, p.y, p.z)
    group.add(lune)
    lunes.push(lune)
  }

  return { group, lunes }
}

/**
 * LE NUAGE COSMIQUE CENTRAL (demande conv-1408 : « un nuage cosmique bleu violet au milieu qui se
 * déplace »).
 *
 * La composition tenait le centre NOIR par principe — les nébuleuses vivent dans les angles pour que
 * les widgets du milieu restent lisibles. La demande change ce principe, pas la contrainte : le nuage
 * occupe le milieu, mais reste translucide et sans bord dur, sinon il rend le texte posé dessus
 * illisible et se lit comme un rectangle collé.
 */
export const NUAGE_COSMIQUE = {
  /** Bleu profond : canal bleu dominant, c'est ce qui fait le « bleu » de la demande. */
  couleur: 0x3f7bff,
  /** Le violet de theme.css : c'est lui qui apporte le rouge, donc le « violet ». */
  secondaire: VIOLET,
  /** Opacité maximale du cœur. Basse : le centre porte les widgets de l'accueil. */
  opacite: 0.55,
  /** Rose magenta : la troisieme teinte de la nebuleuse, portee par les seuls filaments. */
  accent: 0xff4fa3,
  /** Turquoise : la teinte froide des bords, ce qui empeche la nebuleuse de virer monochrome. */
  froid: 0x2fe6ff,
  /**
   * Les BRAISES (conv-1449, image jointe) : l'or-orange qui occupe la moitie chaude de la nebuleuse
   * de reference. Sans elle, le nuage reste un camaieu bleu-violet et ne ressemble pas a l'image.
   */
  chaud: 0xff8a2b,
  /** Profondeur : derrière les planètes, devant les nébuleuses d'angle. */
  z: -14,
  /** Taille, en fraction du demi-cadre. */
  k: 1.15,
  /**
   * LA DÉRIVE — « qui se déplace ». Amplitude en fraction du demi-cadre : elle doit rester bien
   * inférieure à 1, sinon le nuage quitte le milieu et la demande n'est plus tenue.
   */
  derive: { amplitude: 0.3, vitesseX: 0.062, vitesseY: 0.049 }
} as const

/**
 * L'ETOILE au coeur du nuage (conv-1449) : dans l'image de reference, une etoile blanche a branches
 * perce la nebuleuse. Elle est reglee ici parce qu'un eclat en dur dans le shader n'est ni relisible
 * ni bornable, et un coeur trop blanc rendrait illisibles les widgets poses au milieu.
 */
export const ETOILE_NUAGE = {
  /** Intensite du coeur additif. */
  eclat: 0.85,
  /** Nombre de branches. 4 minimum : deux branches font une croix, pas une etoile. */
  branches: 6,
  /** Rayon du halo, en fraction de la demi-taille du plan. Petit : l'etoile ponctue, elle n'inonde pas. */
  rayon: 0.055,
  /** Amplitude du scintillement : sans elle, l'etoile est un point colle sur le nuage. */
  pulsation: 0.22
} as const

/**
 * LA DYNAMIQUE de la matiere (conv-1449 : « qu'il soit plus dynamique »). Les vitesses etaient en dur
 * dans le fragment (0.017 / 0.011), donc invisibles et non reglables ; elles remontent ici et passent
 * par des uniforms.
 */
export const NUAGE_DYNAMIQUE = {
  /** Vitesse de defilement du champ. Ancienne valeur : 0,017 — quasi immobile a l'oeil. */
  vitesseMatiere: 0.085,
  /** Vitesse propre du domain warping : c'est elle qui fait TOURNER les volutes sur elles-memes. */
  vitesseWarp: 0.14,
  /** Respiration de la densite. Bornee : au-dela, le nuage clignote au lieu de respirer. */
  respiration: 0.18
} as const

/**
 * La position du nuage à l'instant `temps`, en unités monde.
 *
 * Deux sinus de périodes non harmoniques : une seule fréquence donnerait un va-et-vient de métronome,
 * qui se lit comme une animation. Fonction PURE — c'est la seule façon de PROUVER le déplacement sans
 * GPU (happy-dom n'a pas de WebGL).
 */
export function positionNuage(
  temps: number,
  cadre: { halfWidth: number; halfHeight: number }
): { x: number; y: number } {
  const { amplitude, vitesseX, vitesseY } = NUAGE_COSMIQUE.derive
  const ondeX = Math.sin(temps * vitesseX) * 0.6 + Math.sin(temps * vitesseX * 0.62 + 1.3) * 0.4
  const ondeY = Math.cos(temps * vitesseY) * 0.55 + Math.sin(temps * vitesseY * 1.47 + 0.7) * 0.45
  return {
    x: ondeX * amplitude * cadre.halfWidth,
    y: ondeY * amplitude * cadre.halfHeight
  }
}

/**
 * Le nuage lui-même : un plan billboard dont la matière est un bruit fractal à coordonnées déformées.
 *
 * Trois choix portent le rendu :
 *  1. fbm avec DOMAIN WARPING — sans la déformation, on voit un moutonnement régulier, pas des volutes ;
 *  2. un masque RADIAL doux : le plan n'a pas de bord visible, sinon c'est une vignette rectangulaire ;
 *  3. le cœur tire vers le blanc bleuté : un nuage d'une seule teinte est un aplat coloré.
 */
/**
 * Le nuage : un fbm a coordonnees deformees, rendu en NEBULEUSE.
 *
 * Les GROS CARRES venaient de trois causes cumulees, corrigees ici :
 *  1. hash en sin(dot(...)) — sature en float et fabrique des cellules alignees sur les axes ;
 *  2. fade CUBIQUE — discontinuite de derivee, donc arete de cellule visible ; passe en QUINTIQUE ;
 *  3. octaves non tournees a frequence de base 3.4 — une cellule couvrait des dizaines de pixels ;
 *     desormais rotation par octave, 7 octaves, base 7.5.
 * La couleur ajoute une TROISIEME teinte (uAccent) portee par les seuls filaments : deux teintes
 * donnent un aplat, trois donnent une nebuleuse.
 */
export const NUAGE_FRAGMENT_SHADER = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform float uTime;',
  'uniform vec3 uBleu;',
  'uniform vec3 uViolet;',
  'uniform vec3 uAccent;',
  'uniform vec3 uFroid;',
  'uniform vec3 uChaud;',
  'uniform float uOpacite;',
  'uniform float uVitesse;',
  'uniform float uWarp;',
  'uniform float uRespiration;',
  'uniform float uEtoile;',
  'uniform float uEtoileRayon;',
  'uniform float uBranches;',
  'uniform float uPulsation;',
  'float hashN(vec2 p) {',
  '  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));',
  '  q += dot(q, q.yzx + 33.33);',
  '  return fract((q.x + q.y) * q.z);',
  '}',
  'float bruitN(vec2 p) {',
  '  vec2 i = floor(p);',
  '  vec2 f = fract(p);',
  '  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
  '  return mix(mix(hashN(i), hashN(i + vec2(1.0, 0.0)), u.x),',
  '             mix(hashN(i + vec2(0.0, 1.0)), hashN(i + vec2(1.0, 1.0)), u.x), u.y);',
  '}',
  'float fbm(vec2 p) {',
  '  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);',
  '  float somme = 0.0;',
  '  float amplitude = 0.5;',
  '  for (int octave = 0; octave < 7; octave++) {',
  '    somme += amplitude * bruitN(p);',
  '    p = rot * p * 2.07 + vec2(11.7, 5.3);',
  '    amplitude *= 0.5;',
  '  }',
  '  return somme;',
  '}',
  'void main() {',
  '  vec2 c = vUv - 0.5;',
  '  float masque = 1.0 - smoothstep(0.10, 0.5, length(c));',
  '  if (masque <= 0.001) discard;',
  // Rotation lente du champ : la nebuleuse de reference TOURNE, elle ne glisse pas de biais.
  '  float spin = uTime * uWarp * 0.35;',
  '  mat2 tourne = mat2(cos(spin), -sin(spin), sin(spin), cos(spin));',
  '  vec2 p = (tourne * c + 0.5) * 7.5;',
  '  vec2 derive = vec2(uTime * uVitesse, uTime * -uVitesse * 0.65);',
  '  float w1 = fbm(p + derive);',
  '  float w2 = fbm(p + vec2(3.7, 8.1) + derive * 1.6);',
  // Le warp lui-meme respire : c'est ce mouvement-la qui fait vivre les volutes sur place.
  '  float pulseWarp = 2.4 + 0.7 * sin(uTime * uWarp);',
  '  vec2 q = p + vec2(w1, w2) * pulseWarp + derive * 0.4;',
  '  float champ = fbm(q);',
  '  float filaments = fbm(q * 2.6 + vec2(w2, w1) + derive * 2.0);',
  '  float densite = pow(clamp(champ * 1.45, 0.0, 1.0), 1.7);',
  '  densite *= 0.72 + 0.55 * filaments;',
  '  densite *= 1.0 + uRespiration * sin(uTime * uWarp * 0.7 + champ * 6.0);',
  '  densite = clamp(densite, 0.0, 1.0);',
  // Quatre teintes comme l'image : bleu-violet au fond, turquoise aux bords, braises sur un versant,
  // magenta porte par les seuls filaments. Deux teintes donnent un aplat.
  '  vec3 couleur = mix(uBleu, uViolet, smoothstep(0.18, 0.72, champ));',
  '  couleur = mix(couleur, uFroid, smoothstep(0.62, 0.12, champ) * 0.55);',
  '  float versant = smoothstep(-0.28, 0.30, -c.x + (w1 - 0.5) * 0.8);',
  '  couleur = mix(couleur, uChaud, versant * smoothstep(0.22, 0.80, champ) * 0.78);',
  '  couleur = mix(couleur, uAccent, smoothstep(0.48, 0.92, filaments) * 0.85);',
  '  couleur += mix(uAccent, uChaud, versant) * pow(clamp(filaments, 0.0, 1.0), 3.0) * 1.3;',
  '  float chaud = pow(smoothstep(0.70, 1.0, champ * 0.6 + filaments * 0.6), 2.2);',
  '  couleur += mix(uChaud, vec3(1.0, 0.95, 0.86), 0.45) * chaud * 2.1;',
  '  couleur = mix(couleur, vec3(0.96, 0.97, 1.0), pow(densite, 2.6) * 0.72);',
  '  float alpha = clamp(densite + chaud * 0.55, 0.0, 1.0) * masque * uOpacite;',
  // L'ETOILE : un coeur gaussien plus un diffracteur a uBranches, qui scintille.
  '  float d = length(c);',
  '  float angle = atan(c.y, c.x);',
  '  float scintille = 1.0 + uPulsation * sin(uTime * 1.7);',
  '  float coeur = exp(-pow(d / max(uEtoileRayon, 0.001), 2.0));',
  '  float pointes = pow(max(0.0, abs(cos(angle * uBranches * 0.5))), 8.0);',
  '  pointes *= exp(-d / max(uEtoileRayon * 3.2, 0.001));',
  '  float etoile = (coeur + pointes * 0.85) * uEtoile * scintille;',
  '  couleur += vec3(1.0, 0.97, 0.92) * etoile;',
  '  alpha = clamp(alpha + etoile * 0.9, 0.0, 1.0);',
  '  gl_FragColor = vec4(couleur, alpha);',
  '}'
].join('\n')

/** Le nuage central : un plan porté par NUAGE_FRAGMENT_SHADER, replacé chaque image par `positionNuage`. */
function buildNuage(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uBleu: { value: new THREE.Color(NUAGE_COSMIQUE.couleur) },
      uViolet: { value: new THREE.Color(NUAGE_COSMIQUE.secondaire) },
      uAccent: { value: new THREE.Color(NUAGE_COSMIQUE.accent) },
      uFroid: { value: new THREE.Color(NUAGE_COSMIQUE.froid) },
      uChaud: { value: new THREE.Color(NUAGE_COSMIQUE.chaud) },
      uOpacite: { value: NUAGE_COSMIQUE.opacite },
      uVitesse: { value: NUAGE_DYNAMIQUE.vitesseMatiere },
      uWarp: { value: NUAGE_DYNAMIQUE.vitesseWarp },
      uRespiration: { value: NUAGE_DYNAMIQUE.respiration },
      uEtoile: { value: ETOILE_NUAGE.eclat },
      uEtoileRayon: { value: ETOILE_NUAGE.rayon },
      uBranches: { value: ETOILE_NUAGE.branches },
      uPulsation: { value: ETOILE_NUAGE.pulsation }
    },
    vertexShader: NAPPE_VERTEX_SHADER,
    fragmentShader: NUAGE_FRAGMENT_SHADER
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 1, 1), material)
  return mesh
}

/**
 * Le shader de la NAPPE : un champ de bruit fractal (fbm) qui module un dégradé or → anthracite.
 *
 * Trois choix portent tout le rendu, et chacun se voit s'il est retiré :
 *  1. le bruit est FRACTAL (somme d'octaves de valeur-bruit) — un simple `mix()` de gradient donne
 *     une bande dégradée « fond d'écran de 2010 », pas une matière ;
 *  2. l'or n'arrive que sur les CRÊTES, en puissance élevée : appliqué à plat, il jaunit tout
 *     l'écran et écrase la lisibilité des widgets posés dessus ;
 *  3. un grain fin (bruit haute fréquence, très faible amplitude) casse le banding des dégradés
 *     sombres, qui est LE défaut visible d'un shader anthracite sur un écran 8 bits.
 *
 * Exporté pour être RELU par le test : happy-dom n'a pas de WebGL, mais le contrat du shader —
 * fbm, or, anthracite — est du texte, et il se vérifie.
 */
export const NAPPE_FRAGMENT_SHADER = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform float uTime;',
  'uniform vec3 uOr;',
  'uniform vec3 uAnthracite;',
  'uniform float uGrain;',
  // Valeur-bruit interpolée en douceur : la base organique.
  'float hash(vec2 p) {',
  '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
  '}',
  'float bruit(vec2 p) {',
  '  vec2 i = floor(p);',
  '  vec2 f = fract(p);',
  '  vec2 u = f * f * (3.0 - 2.0 * f);',
  '  float a = hash(i);',
  '  float b = hash(i + vec2(1.0, 0.0));',
  '  float c = hash(i + vec2(0.0, 1.0));',
  '  float d = hash(i + vec2(1.0, 1.0));',
  '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
  '}',
  // Cinq octaves : en dessous de quatre, la nappe se lit comme des taches ; au-dessus de six, le
  // gain visuel disparaît et le coût par pixel reste, or cette vue tourne toute la journée.
  'float fbm(vec2 p) {',
  '  float somme = 0.0;',
  '  float amplitude = 0.5;',
  '  for (int octave = 0; octave < 5; octave++) {',
  '    somme += amplitude * bruit(p);',
  '    p = p * 2.03 + vec2(17.3, 9.1);',
  '    amplitude *= 0.5;',
  '  }',
  '  return somme;',
  '}',
  'void main() {',
  '  vec2 p = vUv * 3.0;',
  // Domain warping : le bruit déforme ses propres coordonnées. C'est ce qui fait les volutes
  // continues plutôt qu'un moutonnement régulier.
  '  vec2 derive = vec2(uTime * 0.011, uTime * -0.007);',
  '  float w1 = fbm(p + derive);',
  '  float w2 = fbm(p + vec2(5.2, 1.3) + derive * 1.7);',
  '  float champ = fbm(p + vec2(w1, w2) * 1.6 + derive * 0.5);',
  '  float crete = pow(clamp(champ * 1.25, 0.0, 1.0), 3.2);',
  // Vignette douce : le centre reste sombre, les widgets restent lisibles au milieu.
  '  vec2 c = vUv - 0.5;',
  '  float vignette = smoothstep(0.12, 0.72, length(c));',
  '  vec3 couleur = mix(uAnthracite, uOr, crete * (0.35 + 0.65 * vignette));',
  '  couleur += (hash(vUv * 2048.0) - 0.5) * uGrain;',
  '  float alpha = 0.55 + 0.45 * crete;',
  '  gl_FragColor = vec4(couleur, alpha);',
  '}'
].join('\n')

const NAPPE_VERTEX_SHADER = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}'
].join('\n')

/** La nappe : un plan unique, posé loin derrière, qui porte tout le shader. */
function buildNappe(spec: { or: number; anthracite: number }): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uOr: { value: new THREE.Color(spec.or) },
      uAnthracite: { value: new THREE.Color(spec.anthracite) },
      uGrain: { value: 0.012 }
    },
    vertexShader: NAPPE_VERTEX_SHADER,
    fragmentShader: NAPPE_FRAGMENT_SHADER
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 1, 1), material)
  // Rendue en premier : c'est un fond, elle ne doit jamais masquer les étoiles.
  mesh.renderOrder = -1
  return mesh
}

/**
 * Les arcs orbitaux : de longues courbes fines qui traversent le champ.
 *
 * Sur le fond d'écran d'origine, ce sont eux qui donnent l'échelle — sans ces traits, les planètes
 * flottent sans rien qui les relie. Rendus en lignes, ce qui coûte presque rien.
 */
function buildOrbits(random: () => number, count = 7): THREE.Group {
  const group = new THREE.Group()
  const palette = [ROSE, CYAN, GOLD, VIOLET]

  for (let i = 0; i < count; i += 1) {
    const radius = 12 + random() * 22
    const points: THREE.Vector3[] = []
    // Un arc, pas un cercle complet : un cercle entier se lit comme un cerceau posé sur l'image.
    const start = random() * Math.PI * 2
    const span = Math.PI * (0.7 + random() * 0.9)
    for (let step = 0; step <= 96; step += 1) {
      const angle = start + (span * step) / 96
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * radius,
          Math.sin(angle * 0.6) * radius * 0.34,
          Math.sin(angle) * radius
        )
      )
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: palette[i % palette.length],
        transparent: true,
        opacity: 0.14 + random() * 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    line.rotation.set(random() * 0.9 - 0.45, random() * Math.PI, random() * 0.7 - 0.35)
    group.add(line)
  }

  return group
}

/**
 * Des points qui glissent le long d'orbites, à des vitesses différentes.
 *
 * Le mouvement est calculé DANS le vertex shader depuis une phase par point : une animation en
 * JavaScript sur deux cents objets coûterait un parcours de tableau par image, pour un résultat
 * identique. Chaque satellite porte son rayon, son inclinaison et sa vitesse propre.
 */
function buildSatellites(random: () => number, count: number): THREE.Points {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  // x = rayon, y = vitesse, z = phase de départ. Les positions servent d'axe d'inclinaison.
  const orbites = new Float32Array(count * 3)
  const teinte = new THREE.Color()

  for (let i = 0; i < count; i += 1) {
    const o = i * 3
    const inclinaison = (random() - 0.5) * 1.1
    positions[o] = Math.cos(inclinaison)
    positions[o + 1] = Math.sin(inclinaison)
    positions[o + 2] = random() * Math.PI * 2
    orbites[o] = 0.18 + random() * 0.9
    // Vitesse décroissante avec le rayon : une orbite lointaine qui va vite se lit comme une erreur.
    orbites[o + 1] = (0.25 + random() * 0.5) / (0.4 + orbites[o])
    orbites[o + 2] = random() * Math.PI * 2
    teinte.setHex(random() > 0.45 ? GOLD : CYAN)
    colors[o] = teinte.r
    colors[o + 1] = teinte.g
    colors[o + 2] = teinte.b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aOrbite', new THREE.BufferAttribute(orbites, 3))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uEchelle: { value: 1 } },
    vertexShader: [
      'attribute vec3 aOrbite;',
      'varying vec3 vColor;',
      'uniform float uTime;',
      'uniform float uPixelRatio;',
      'uniform float uEchelle;',
      'void main() {',
      '  vColor = color;',
      '  float rayon = aOrbite.x * uEchelle;',
      '  float angle = aOrbite.z + uTime * aOrbite.y;',
      '  vec3 plan = normalize(vec3(position.x, position.y, 0.0));',
      '  vec3 normale = normalize(cross(plan, vec3(0.0, 0.0, 1.0)));',
      '  vec3 p = (plan * cos(angle) + normale * sin(angle)) * rayon;',
      '  p.z += sin(position.z + uTime * 0.1) * rayon * 0.12;',
      '  vec4 view = modelViewMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * view;',
      '  gl_PointSize = uPixelRatio * (34.0 / -view.z);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vColor;',
      'void main() {',
      '  float d = length(gl_PointCoord - vec2(0.5));',
      '  float falloff = 1.0 - smoothstep(0.08, 0.5, d);',
      '  if (falloff <= 0.002) discard;',
      '  gl_FragColor = vec4(vColor, falloff * 0.95);',
      '}'
    ].join('\n'),
    vertexColors: true
  })

  return new THREE.Points(geometry, material)
}

// Les nébuleuses vivent dans les ANGLES et le centre reste noir : c'est la composition du fond
// d'écran, et c'est aussi ce qui garde les widgets lisibles au milieu.
/**
 * Les elements du decor sont declares en FRACTIONS du cadre visible, jamais en coordonnees monde.
 *
 * Mesure du 2026-08-21 dans l'app : avec des positions monde fixes, une surface de 405x956 (rapport
 * 0,42) reduisait la demi-largeur visible a ~5 unites alors que les nebuleuses etaient posees a 13
 * — elles etaient donc INTEGRALEMENT hors champ, et le decor paraissait absent. Une composition
 * doit se declarer par rapport au cadre qui la montre.
 */
/**
 * La composition, par direction. Chaque entrée dit OÙ se posent les éléments, en FRACTIONS du cadre
 * visible — jamais en coordonnées monde, sinon un cadre étroit les met hors champ (défaut mesuré).
 */
interface Composition {
  nebuleuses: { fx: number; fy: number; z: number; color: number; secondary: number; k: number }[]
  planetes: {
    fx: number
    fy: number
    z: number
    radius: number
    color: number
    ringColor: number
    rings: number
    tilt: number
    /**
     * Le grain de la surface. Deux planètes de même `seed` portent le MÊME relief au pixel près :
     * à l'écran, cela se lit immédiatement comme un copier-coller.
     */
    seed: number
    /** Étirement du bruit en latitude : c'est lui qui fait la géante gazeuse plutôt qu'une tache. */
    bandes: number
    /** Nombre de LUNES en orbite autour d'elle (conv-1408). 0 = aucune. */
    lunes: number
  }[]
  arcs: number
  satellites: number
  /**
   * LE NUAGE COSMIQUE CENTRAL, quand la direction en a un. `fx`/`fy` sont son point d'ancrage en
   * fractions du cadre : la demande dit « au milieu », donc proche de (0, 0) — c'est la dérive de
   * `positionNuage` qui l'écarte, pas l'ancrage.
   */
  nuage?: { fx: number; fy: number }
  /**
   * La nappe de bruit, quand la direction en a une. Absente pour toutes les autres : c'est une
   * MATIÈRE de fond, pas un calque ajouté partout.
   */
  nappe?: { or: number; anthracite: number; z: number; k: number }
  /** Multiplicateur de vitesse : le régime de mouvement fait partie de la direction. */
  tempo: number
  /** Amplitude de la parallaxe de caméra. */
  parallaxe: number
}

export const COMPOSITIONS: Record<DecorVariant, Composition> = {
  actuel: {
    nebuleuses: [
      { fx: -0.86, fy: 0.62, z: -11, color: ROSE, secondary: VIOLET, k: 0.38 },
      { fx: -0.78, fy: -0.68, z: -8, color: CYAN, secondary: 0x2b6cff, k: 0.34 },
      { fx: 0.86, fy: 0.68, z: -12, color: CYAN, secondary: VIOLET, k: 0.36 },
      { fx: 0.8, fy: -0.64, z: -8, color: ROSE, secondary: 0xff6bd6, k: 0.32 }
    ],
    planetes: [
      {
        fx: 0.72,
        fy: -0.74,
        z: -5,
        radius: 0.2,
        color: 0xc98a4a,
        ringColor: GOLD,
        rings: 3,
        tilt: 0.42,
        seed: 1.7,
        bandes: 5.2,
        lunes: 3
      },
      {
        fx: 0.82,
        fy: 0.6,
        z: -8,
        radius: 0.15,
        color: 0x3f6fa8,
        ringColor: CYAN,
        rings: 2,
        tilt: -0.3,
        seed: 8.3,
        bandes: 3.4,
        lunes: 2
      },
      {
        fx: -0.8,
        fy: -0.6,
        z: -7,
        radius: 0.12,
        color: 0x7a4a72,
        ringColor: ROSE,
        rings: 2,
        tilt: 0.55,
        seed: 14.9,
        bandes: 6.8,
        lunes: 1
      }
    ],
    arcs: 7,
    satellites: 0,
    // Le nuage cosmique demandé en conv-1408 : ancré au milieu, il DÉRIVE autour de ce point.
    nuage: { fx: 0, fy: 0 },
    tempo: 1,
    parallaxe: 1
  },
  // UN sujet dominant au lieu de plusieurs, et beaucoup moins de matière : le contraste vient de la
  // silhouette et du terminateur, pas de l'accumulation.
  limbe: {
    nebuleuses: [
      { fx: -0.7, fy: 0.4, z: -16, color: VIOLET, secondary: 0x2b6cff, k: 0.5 },
      { fx: 0.15, fy: -0.85, z: -14, color: ROSE, secondary: VIOLET, k: 0.42 }
    ],
    planetes: [
      {
        fx: 0.98,
        fy: -0.12,
        z: -2,
        radius: 0.66,
        color: 0xc98a4a,
        ringColor: GOLD,
        rings: 4,
        tilt: 0.34,
        seed: 3.1,
        bandes: 7.5,
        lunes: 4
      },
      {
        fx: -0.9,
        fy: 0.74,
        z: -13,
        radius: 0.07,
        color: 0x3f6fa8,
        ringColor: CYAN,
        rings: 1,
        tilt: -0.4,
        seed: 21.4,
        bandes: 3.2,
        lunes: 1
      }
    ],
    arcs: 3,
    satellites: 0,
    tempo: 0.45,
    parallaxe: 0.7
  },
  // Que de la matière, sur six plans de profondeur : la parallaxe fait tout le relief, aucune forme
  // dure ne vient l'aider.
  poussiere: {
    nebuleuses: [
      { fx: -0.9, fy: 0.5, z: -20, color: VIOLET, secondary: 0x2b6cff, k: 0.62 },
      { fx: -0.35, fy: -0.6, z: -14, color: CYAN, secondary: VIOLET, k: 0.5 },
      { fx: 0.3, fy: 0.62, z: -9, color: ROSE, secondary: 0xff6bd6, k: 0.44 },
      { fx: 0.92, fy: -0.35, z: -5, color: ROSE, secondary: VIOLET, k: 0.4 },
      { fx: 0.5, fy: 0.1, z: -2, color: CYAN, secondary: 0x8fd0ff, k: 0.26 },
      { fx: -0.55, fy: 0.0, z: -3, color: VIOLET, secondary: ROSE, k: 0.24 }
    ],
    planetes: [],
    arcs: 2,
    satellites: 0,
    tempo: 1.4,
    parallaxe: 2.2
  },
  // La ligne remplace le grain : arcs fins et satellites qui glissent dessus. L'or structurel domine,
  // la matière se retire.
  orbites: {
    nebuleuses: [
      { fx: -0.85, fy: -0.62, z: -18, color: VIOLET, secondary: 0x2b6cff, k: 0.34 },
      { fx: 0.85, fy: 0.62, z: -18, color: CYAN, secondary: VIOLET, k: 0.3 }
    ],
    planetes: [
      {
        fx: 0.06,
        fy: -0.04,
        z: -9,
        radius: 0.13,
        color: 0x2c3f66,
        ringColor: GOLD,
        rings: 3,
        tilt: 0.5,
        seed: 5.6,
        bandes: 4.1,
        lunes: 2
      }
    ],
    arcs: 16,
    satellites: 220,
    tempo: 0.8,
    parallaxe: 1.3
  },
  // Le haut de gamme par SOUSTRACTION : plus de silhouette, plus de ligne, plus d'accumulation. Une
  // seule nappe de bruit fractal or/anthracite, qui dérive assez lentement pour qu'on ne la
  // surprenne jamais en mouvement — c'est cette lenteur qui fait la matière, pas l'animation.
  nappe: {
    // Deux voiles très étalés et très profonds : ils donnent à la nappe une épaisseur, sans
    // ramener la palette rose/cyan au premier plan.
    nebuleuses: [
      { fx: -0.75, fy: 0.35, z: -24, color: VIOLET, secondary: 0x2b6cff, k: 0.7 },
      { fx: 0.7, fy: -0.4, z: -22, color: CYAN, secondary: VIOLET, k: 0.6 }
    ],
    planetes: [],
    arcs: 0,
    satellites: 0,
    // Strictement la plus lente du catalogue : « très lente » est une propriété vérifiable, pas un mot.
    tempo: 0.12,
    parallaxe: 0.35,
    nappe: { or: GOLD, anthracite: ANTHRACITE, z: -30, k: 1.15 }
  }
}

/** La direction par DEFAUT, choisie par l'utilisateur le 2026-08-21 sur rendus compares. */
/*
 * LA COMPOSITION A PLANETES, demandee le 2026-08-24 et assumee comme un CHANGEMENT de decision.
 *
 * `poussiere` etait le defaut, choisi par l'utilisateur sur rendus compares -- une vraie decision,
 * encodee dans le test voisin. Elle est remplacee, pas contournee : la demande « bascule le decor sur
 * la composition a planetes, avec la parallaxe curseur dessus » a ete formulee deux fois, et le test
 * qui gardait l'ancien choix a refuse l'edition d'un agent qui n'avait pas lu la decision.
 *
 * La promesse de `poussiere` reste testee, sous son nom propre : changer de defaut ne doit pas
 * effacer la garantie d'une direction qu'on peut encore choisir.
 */
export const DECOR_DEFAUT: DecorVariant = 'actuel'

/**
 * Monte la scène complète dans un canevas.
 *
 * Rend `null` quand WebGL n'est pas disponible — happy-dom en test, machine sans pilote, contexte
 * perdu. Le décor est un DÉCOR : son absence ne doit jamais empêcher la page d'accueil de s'afficher
 * ni un test de rendu de passer.
 */
export function createDecorScene(variante: DecorVariant = DECOR_DEFAUT): DecorScene | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'default' })
  } catch {
    return null
  }

  renderer.setClearColor(FOND_DECOR.couleur, FOND_DECOR.alpha)
  // L'étage cinématique : ACES filmique tient les couleurs dans les surbrillances, l'exposition
  // compense la compression qu'il applique. Les deux viennent de POST_TRAITEMENT — un réglage écrit
  // en dur ici serait un réglage qu'on croit pouvoir changer et qui ne change rien.
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = POST_TRAITEMENT.exposition
  const canvas = renderer.domElement

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200)
  camera.position.set(0, 0, 26)

  const random = seededRandom(0x5eed1)

  const stars = buildStars(random)
  scene.add(stars)

  const composition = COMPOSITIONS[variante] ?? COMPOSITIONS[DECOR_DEFAUT]
  const nebulaSpecs = composition.nebuleuses

  const nappeSpec = composition.nappe
  const nappe = nappeSpec ? buildNappe(nappeSpec) : null
  if (nappe) scene.add(nappe)

  const nebulas = nebulaSpecs.map((spec) =>
    buildNebula(random, {
      center: new THREE.Vector3(0, 0, 0),
      color: spec.color,
      secondary: spec.secondary,
      scale: 1
    })
  )
  for (const nebula of nebulas) scene.add(nebula)

  // Meme regle pour les planetes, avec une nuance : leur ECHELLE reste UNIFORME (`min` des deux
  // demi-extensions). Les etirer avec le cadre en ferait des ellipses, ce qui se voit tout de suite.
  // Le nuage central : monté avant les planètes pour rester DERRIÈRE elles dans l'ordre de rendu
  // additif — un nuage devant une planète l'effacerait au lieu de l'entourer.
  const nuageSpec = composition.nuage
  const nuage = nuageSpec ? buildNuage() : null
  if (nuage) scene.add(nuage)

  const planetSpecs = composition.planetes
  const planetesMontees = planetSpecs.map((spec) =>
    buildPlanet({
      radius: 1,
      position: new THREE.Vector3(0, 0, 0),
      color: spec.color,
      ringColor: spec.ringColor,
      rings: spec.rings,
      tilt: spec.tilt,
      seed: spec.seed,
      bandes: spec.bandes,
      lunes: spec.lunes
    })
  )
  const planets = planetesMontees.map((entry) => entry.group)
  const lunesParPlanete = planetesMontees.map((entry) => entry.lunes)
  for (const planet of planets) scene.add(planet)
  /**
   * La position CADREE de chaque planete, posee par `resize`.
   *
   * Elle est memorisee parce que `render` deplace ensuite les planetes autour d'elle pour suivre le
   * curseur : sans base stable, chaque image repartirait de la position deja decalee de la
   * precedente et les planetes deriveraient hors du cadre.
   */
  const planetBases = planetSpecs.map(() => new THREE.Vector3())

  const orbits = buildOrbits(random, composition.arcs)
  scene.add(orbits)

  const satellites =
    composition.satellites > 0 ? buildSatellites(random, composition.satellites) : null
  if (satellites) scene.add(satellites)

  // Les filantes appartiennent à TOUTES les directions : c'est l'événement du décor, pas un motif
  // d'une composition. Leur rareté vient de FILANTES, pas de leur absence.
  const filantes = buildFilantes(random)
  scene.add(filantes)

  // Éclairage rasant : c'est le terminateur qui donne le volume. Un éclairage frontal aplatirait
  // les planètes exactement comme une image plaquée.
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.3)
  sun.position.set(-9, 5, 7)
  scene.add(sun)
  // L'ambiante est très faible et TEINTÉE : à zéro, la face sombre devient un trou noir découpé.
  scene.add(new THREE.AmbientLight(0x2a2440, 0.55))

  const pointRatios: THREE.ShaderMaterial[] = [
    stars.material as THREE.ShaderMaterial,
    ...nebulas.map((nebula) => nebula.material as THREE.ShaderMaterial),
    ...(satellites ? [satellites.material as THREE.ShaderMaterial] : []),
    filantes.material as THREE.ShaderMaterial
  ]

  /**
   * La chaîne de post-traitement. Ordre imposé : la scène est rendue, le bloom lit ses hautes
   * lumières, puis OutputPass applique tone mapping et conversion sRGB EN FIN de chaîne — c'est lui
   * qui manque quand une image post-traitée ressort délavée.
   */
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    POST_TRAITEMENT.bloom.force,
    POST_TRAITEMENT.bloom.rayon,
    POST_TRAITEMENT.bloom.seuil
  )
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  let width = 1
  let height = 1
  /**
   * Le demi-cadre visible à la profondeur du nuage, mémorisé par `resize`.
   *
   * `render` en a besoin pour convertir la dérive de `positionNuage` (exprimée en fractions du cadre)
   * en unités monde : sans lui, la même dérive sortirait du champ sur une fenêtre étroite — c'est
   * exactement le défaut déjà mesuré le 2026-08-21 sur les nébuleuses posées en coordonnées monde.
   */
  const cadreNuage = { halfWidth: 1, halfHeight: 1 }

  return {
    canvas,

    resize(nextWidth, nextHeight) {
      if (nextWidth <= 0 || nextHeight <= 0) return
      width = nextWidth
      height = nextHeight
      // Le cadre visible A LA DISTANCE DU DECOR, d'ou tout le placement decoule.
      const distance = camera.position.z + 9
      const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * distance
      const halfWidth = halfHeight * (nextWidth / nextHeight)
      const uniform = Math.min(halfWidth, halfHeight)
      nebulaSpecs.forEach((spec, index) => {
        const nebula = nebulas[index]
        nebula.position.set(spec.fx * halfWidth, spec.fy * halfHeight, spec.z)
        // Les nebuleuses, elles, S'ETIRENT avec le cadre : ce sont des nuages, un nuage etire reste
        // un nuage, et c'est ce qui leur permet d'habiller un cadre etroit comme un cadre large.
        nebula.scale.set(halfWidth * spec.k, halfHeight * spec.k, uniform * spec.k)
      })
      planetSpecs.forEach((spec, index) => {
        const planet = planets[index]
        planetBases[index].set(spec.fx * halfWidth, spec.fy * halfHeight, spec.z)
        planet.position.copy(planetBases[index])
        const size = Math.max(0.6, uniform * spec.radius)
        planet.scale.setScalar(size)
      })
      // La nappe couvre TOUT le cadre à sa profondeur, avec une marge : un bord visible la
      // trahirait comme un plan posé, au lieu d'une matière de fond.
      if (nappe && nappeSpec) {
        const distanceNappe = camera.position.z - nappeSpec.z
        const demiHauteur = Math.tan((camera.fov * Math.PI) / 360) * distanceNappe
        const demiLargeur = demiHauteur * (nextWidth / nextHeight)
        nappe.position.set(0, 0, nappeSpec.z)
        nappe.scale.set(demiLargeur * nappeSpec.k, demiHauteur * nappeSpec.k, 1)
      }
      if (nuage) {
        const distanceNuage = camera.position.z - NUAGE_COSMIQUE.z
        const demiHauteur = Math.tan((camera.fov * Math.PI) / 360) * distanceNuage
        const demiLargeur = demiHauteur * (nextWidth / nextHeight)
        cadreNuage.halfWidth = demiLargeur
        cadreNuage.halfHeight = demiHauteur
        // Échelle UNIFORME : un nuage étiré avec le cadre devient une bande horizontale sur un écran
        // large, et le masque radial du shader ne le lit plus comme un nuage.
        const taille = Math.min(demiLargeur, demiHauteur) * NUAGE_COSMIQUE.k
        nuage.scale.set(taille, taille, 1)
        nuage.position.set(0, 0, NUAGE_COSMIQUE.z)
      }
      orbits.scale.setScalar(Math.max(halfWidth, halfHeight) * 0.62)
      if (satellites) {
        // Les satellites partagent l'échelle des arcs : sinon ils glisseraient à côté d'eux.
        const material = satellites.material as THREE.ShaderMaterial
        material.uniforms.uEchelle.value = Math.max(halfWidth, halfHeight) * 0.62
      }
      stars.scale.setScalar(Math.max(1, Math.max(halfWidth, halfHeight) / 12))
      // Plafonné à 1.75 : au-delà, le coût par pixel monte sans que ça se voie sur un écran de
      // travail — et cette vue reste allumée toute la journée.
      // Les filantes traversent le CADRE : à échelle fixe, elles seraient minuscules sur un grand
      // écran et sortiraient du champ sur un cadre étroit.
      ;(filantes.material as THREE.ShaderMaterial).uniforms.uEchelle.value = Math.max(
        halfWidth,
        halfHeight
      )
      const ratio = Math.min(window.devicePixelRatio || 1, 1.75)
      renderer.setPixelRatio(ratio)
      renderer.setSize(width, height, false)
      // Le composer possède ses propres cibles de rendu : sans ce setSize, l'image reste à la taille
      // précédente et se retrouve étirée par le canevas.
      composer.setSize(width, height)
      bloom.resolution.set(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      for (const material of pointRatios) material.uniforms.uPixelRatio.value = ratio
    },

    render(elapsed, look) {
      // Le TEMPO appartient à la direction : « Limbe » dérive lentement, « Poussière » respire vite.
      const temps = elapsed * composition.tempo
      for (const material of pointRatios) material.uniforms.uTime.value = temps
      // Les filantes vivent en temps RÉEL, hors tempo : sur « Nappe » (tempo 0,12) une filante
      // n'arriverait qu'une fois toutes les trois minutes, donc jamais pendant qu'on regarde.
      ;(filantes.material as THREE.ShaderMaterial).uniforms.uTime.value = elapsed
      if (nappe) (nappe.material as THREE.ShaderMaterial).uniforms.uTime.value = temps
      // LE NUAGE SE DÉPLACE : deux mouvements distincts, et il faut les deux. Le shader fait vivre sa
      // matière sur place (volutes), `positionNuage` déplace le nuage LUI-MÊME dans le cadre. Sans le
      // second, la matière bouillonne mais le nuage reste planté au centre.
      if (nuage && nuageSpec) {
        ;(nuage.material as THREE.ShaderMaterial).uniforms.uTime.value = temps
        const derive = positionNuage(temps, cadreNuage)
        nuage.position.x = nuageSpec.fx * cadreNuage.halfWidth + derive.x
        nuage.position.y = nuageSpec.fy * cadreNuage.halfHeight + derive.y
      }
      // Rotations lentes et de vitesses différentes : synchronisées, elles se liraient comme un
      // seul bloc qui tourne.
      stars.rotation.y = temps * 0.004
      orbits.rotation.y = temps * 0.012
      // Vitesses différentes et NOMBRE variable selon la direction : « Poussière » n'a aucune
      // planète, et indexer en dur ferait planter la boucle de rendu.
      planets.forEach((planet, index) => {
        planet.rotation.y = temps * (index % 2 === 0 ? 0.06 : -0.045) * (1 + index * 0.3)
        // Glissement DANS LE PLAN au curseur, autour de la position cadree par `resize`.
        // L'amplitude croit avec l'index : les planetes ne bougent pas en bloc, et ce decalage
        // relatif est ce qui se lit comme de la profondeur. Volontairement faible pour rester un
        // fremissement, jamais un deplacement qui decadre la composition.
        const amplitude = (0.9 + index * 0.55) * composition.parallaxe
        const base = planetBases[index]
        planet.position.x = base.x + look.x * amplitude
        planet.position.y = base.y + look.y * amplitude * 0.7
        // Les LUNES tournent autour de leur planète, dans SON repère : la position est locale, donc
        // le cadrage et la parallaxe du groupe les emportent sans calcul supplémentaire.
        const lunes = lunesParPlanete[index]
        lunes.forEach((lune, rang) => {
          const p = orbiteLune(rang, lunes.length, temps)
          lune.position.set(p.x, p.y, p.z)
          // Rotation propre lente : une lune qui orbite sans tourner est un point de matière figé.
          lune.rotation.y = temps * 0.09 * (1 + rang * 0.4)
          ;(lune.material as THREE.ShaderMaterial).uniforms.uTime.value = temps
        })
      })
      // La caméra suit le regard, amortie en amont par l'appelant. C'est LE signal de profondeur :
      // un décor fixe se lit comme une texture, même en 3D.
      camera.position.x = look.x * 2.6 * composition.parallaxe
      camera.position.y = look.y * -1.8 * composition.parallaxe
      camera.lookAt(0, 0, 0)
      // Le rendu passe par la chaîne cinématique, jamais par le renderer directement : deux chemins
      // de rendu, c'est un des deux qui est mort et une image qui ne change pas.
      composer.render()
    },

    dispose() {
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose?.()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material?.dispose?.()
      })
      // Le composer détient des cibles de rendu plein écran : les oublier fuit de la VRAM à chaque
      // ouverture de l'accueil.
      composer.dispose()
      renderer.dispose()
      canvas.remove()
    }
  }
}
