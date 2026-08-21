import * as THREE from 'three'

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
    const arm = Math.sin(angle * 2.5 + t * 5.5)
    positions[o] = options.center.x + (Math.cos(angle) * spread * 2.4 + arm * 0.7) * options.scale
    positions[o + 1] = options.center.y + (Math.sin(angle) * spread * 1.7 + arm * 0.5) * options.scale
    positions[o + 2] = options.center.z + (random() - 0.5) * 0.9 * options.scale

    scratch.copy(primary).lerp(secondary, Math.pow(random(), 1.4))
    // Le coeur du filament est plus clair : sans ce gradient, la nébuleuse est un aplat coloré.
    scratch.lerp(new THREE.Color(0xffffff), Math.max(0, 0.42 - spread) * 0.6)
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
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
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
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float falloff = 1.0 - smoothstep(0.0, 0.5, d);
        if (falloff <= 0.002) discard;
        // Puissance 1.8 : un dégradé linéaire donne des disques nets, donc du confetti.
        gl_FragColor = vec4(vColor, pow(falloff, 1.8) * 0.5);
      }
    `,
    vertexColors: true
  })

  return new THREE.Points(geometry, material)
}

/**
 * Une planète annelée. Sphère éclairée en rasant, plus deux ou trois anneaux fins.
 *
 * Les anneaux sont des cercles FILAIRES et non des disques texturés : c'est ainsi qu'ils sont dessinés
 * sur le fond d'écran d'origine — des traits d'orbite, pas des anneaux de Saturne photoréalistes.
 */
function buildPlanet(options: {
  radius: number
  position: THREE.Vector3
  color: number
  ringColor: number
  rings: number
  tilt: number
}): THREE.Group {
  const group = new THREE.Group()
  group.position.copy(options.position)

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(options.radius, 48, 32),
    new THREE.MeshStandardMaterial({
      color: options.color,
      roughness: 0.86,
      metalness: 0.06,
      // Nuit non noire : sans cette trace de lumière, la moitié sombre est un trou dans l'image.
      emissive: new THREE.Color(options.color).multiplyScalar(0.06)
    })
  )
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
      uniforms: { uColor: { value: new THREE.Color(options.ringColor) } },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vView = -view.xyz;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
          gl_FragColor = vec4(uColor, pow(rim, 3.2) * 0.55);
        }
      `
    })
  )
  group.add(halo)

  for (let i = 0; i < options.rings; i += 1) {
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        new THREE.EllipseCurve(
          0,
          0,
          options.radius * (1.55 + i * 0.22),
          options.radius * (1.55 + i * 0.22),
          0,
          Math.PI * 2
        ).getPoints(128)
      ),
      new THREE.LineBasicMaterial({
        color: options.ringColor,
        transparent: true,
        opacity: 0.34 - i * 0.07,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    ring.rotation.x = Math.PI / 2 - options.tilt
    ring.rotation.z = options.tilt * 0.4
    group.add(ring)
  }

  return group
}

/**
 * Les arcs orbitaux : de longues courbes fines qui traversent le champ.
 *
 * Sur le fond d'écran d'origine, ce sont eux qui donnent l'échelle — sans ces traits, les planètes
 * flottent sans rien qui les relie. Rendus en lignes, ce qui coûte presque rien.
 */
function buildOrbits(random: () => number): THREE.Group {
  const group = new THREE.Group()
  const palette = [ROSE, CYAN, GOLD, VIOLET]

  for (let i = 0; i < 7; i += 1) {
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
 * Monte la scène complète dans un canevas.
 *
 * Rend `null` quand WebGL n'est pas disponible — happy-dom en test, machine sans pilote, contexte
 * perdu. Le décor est un DÉCOR : son absence ne doit jamais empêcher la page d'accueil de s'afficher
 * ni un test de rendu de passer.
 */
export function createDecorScene(): DecorScene | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'default' })
  } catch {
    return null
  }

  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200)
  camera.position.set(0, 0, 26)

  const random = seededRandom(0x5eed1)

  const stars = buildStars(random)
  scene.add(stars)

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
  const nebulaSpecs = [
    { fx: -0.86, fy: 0.62, z: -11, color: ROSE, secondary: VIOLET, k: 0.38 },
    { fx: -0.78, fy: -0.68, z: -8, color: CYAN, secondary: 0x2b6cff, k: 0.34 },
    { fx: 0.86, fy: 0.68, z: -12, color: CYAN, secondary: VIOLET, k: 0.36 },
    { fx: 0.8, fy: -0.64, z: -8, color: ROSE, secondary: 0xff6bd6, k: 0.32 }
  ]
  const nebulas = nebulaSpecs.map((spec) =>
    buildNebula(random, { center: new THREE.Vector3(0, 0, 0), color: spec.color, secondary: spec.secondary, scale: 1 })
  )
  for (const nebula of nebulas) scene.add(nebula)

  // Meme regle pour les planetes, avec une nuance : leur ECHELLE reste UNIFORME (`min` des deux
  // demi-extensions). Les etirer avec le cadre en ferait des ellipses, ce qui se voit tout de suite.
  const planetSpecs = [
    { fx: 0.72, fy: -0.74, z: -5, radius: 0.2, color: 0xc98a4a, ringColor: GOLD, rings: 3, tilt: 0.42 },
    { fx: 0.82, fy: 0.6, z: -8, radius: 0.15, color: 0x3f6fa8, ringColor: CYAN, rings: 2, tilt: -0.3 },
    { fx: -0.8, fy: -0.6, z: -7, radius: 0.12, color: 0x7a4a72, ringColor: ROSE, rings: 2, tilt: 0.55 }
  ]
  const planets = planetSpecs.map((spec) =>
    buildPlanet({
      radius: 1,
      position: new THREE.Vector3(0, 0, 0),
      color: spec.color,
      ringColor: spec.ringColor,
      rings: spec.rings,
      tilt: spec.tilt
    })
  )
  for (const planet of planets) scene.add(planet)

  const orbits = buildOrbits(random)
  scene.add(orbits)

  // Éclairage rasant : c'est le terminateur qui donne le volume. Un éclairage frontal aplatirait
  // les planètes exactement comme une image plaquée.
  const sun = new THREE.DirectionalLight(0xfff0dd, 2.3)
  sun.position.set(-9, 5, 7)
  scene.add(sun)
  // L'ambiante est très faible et TEINTÉE : à zéro, la face sombre devient un trou noir découpé.
  scene.add(new THREE.AmbientLight(0x2a2440, 0.55))

  const pointRatios: THREE.ShaderMaterial[] = [
    stars.material as THREE.ShaderMaterial,
    ...nebulas.map((nebula) => nebula.material as THREE.ShaderMaterial)
  ]

  let width = 1
  let height = 1

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
        planet.position.set(spec.fx * halfWidth, spec.fy * halfHeight, spec.z)
        const size = Math.max(0.6, uniform * spec.radius)
        planet.scale.setScalar(size)
      })
      orbits.scale.setScalar(Math.max(halfWidth, halfHeight) * 0.62)
      stars.scale.setScalar(Math.max(1, Math.max(halfWidth, halfHeight) / 12))
      // Plafonné à 1.75 : au-delà, le coût par pixel monte sans que ça se voie sur un écran de
      // travail — et cette vue reste allumée toute la journée.
      const ratio = Math.min(window.devicePixelRatio || 1, 1.75)
      renderer.setPixelRatio(ratio)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      for (const material of pointRatios) material.uniforms.uPixelRatio.value = ratio
    },

    render(elapsed, look) {
      for (const material of pointRatios) material.uniforms.uTime.value = elapsed
      // Rotations lentes et de vitesses différentes : synchronisées, elles se liraient comme un
      // seul bloc qui tourne.
      stars.rotation.y = elapsed * 0.004
      orbits.rotation.y = elapsed * 0.012
      planets[0].rotation.y = elapsed * 0.06
      planets[1].rotation.y = -elapsed * 0.045
      planets[2].rotation.y = elapsed * 0.08
      // La caméra suit le regard, amortie en amont par l'appelant. C'est LE signal de profondeur :
      // un décor fixe se lit comme une texture, même en 3D.
      camera.position.x = look.x * 2.6
      camera.position.y = look.y * -1.8
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
    },

    dispose() {
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose?.()
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material?.dispose?.()
      })
      renderer.dispose()
      canvas.remove()
    }
  }
}
