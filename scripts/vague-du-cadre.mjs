/**
 * LA VAGUE DU CADRE, CALCULEE — les `@keyframes` de la lumiere qui traverse les blocs du fil
 * (src/renderer/src/components/anneau-activite.css, entre les deux marques `vague-du-cadre`).
 *
 * Pourquoi un calcul et pas des etapes ecrites a la main : la demande est « moins lineaire, presque
 * chaotique, vraiment comme la video de Pinterest » (2026-11-13). Mesure sur cette video : plusieurs
 * trainees de lumiere a la fois, qui OSCILLENT autour de leur place (jusqu'a revenir en arriere), un
 * blanc qui GONFLE jusqu'a couvrir plus de la moitie de l'anneau puis retombe, et une aura qui
 * s'allume avec lui. Une vitesse constante n'en garde rien. Ici, chaque passage suit une progression
 * balancee (une sinusoide sur la course, nulle aux bords), un blanc qui enfle en eclat puis retombe,
 * une intensite qui vacille ; un second reflet, plus fin, croise le premier. Les trois passages du
 * cycle ont chacun leurs reglages : aucun ne ressemble au precedent.
 *
 * SEUL LE BLANC ENFLE (mesure au pixel sur les 150 images, 2026-11-13) : quand le blanc passe de
 * 4 a 170 degres d'anneau, ses franges de couleur gardent 21 a 34 degres de chaque cote. L'eclat
 * est donc en trois pieces : le coeur blanc, seul etire (`scaleX`), et ses deux franges, qui
 * s'ecartent d'autant (`COEUR_DEMI_PX * (largeur - 1)` chacune) sans changer de largeur. Etirer la
 * bande entiere, comme avant, etalait aussi les franges.
 * L'INTENSITE est une animation a part (`cadre-vague-intensite`), posee sur les calques qui portent
 * l'eclat et le halo : les trois pieces se recouvrent de quelques pixels de blanc, et une opacite
 * propre a chacune eclaircirait ces recouvrements ; sur le calque, elles s'estompent ensemble.
 *
 * CE QUI NE BOUGE PAS (anneau-activite.css) : un passage toutes les 4 s ; seuls `transform` et
 * `opacity` sont animes (la carte graphique fait glisser une bande deja peinte) ; la position passe
 * TOUJOURS par `100cqw + --vague-avance - --vague-course * p`, avec le meme `p` pour tous les blocs a
 * un instant donne : c'est ce qui garde une seule diagonale pour le groupe, dans l'ordre Actions,
 * Raisonnement, Etapes, quel que soit le balancement.
 *
 * Usage : node scripts/vague-du-cadre.mjs             reecrit le bloc dans la feuille
 *         node scripts/vague-du-cadre.mjs --verifier  code 1 si la feuille n'est plus a jour
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as prettier from 'prettier'

export const FEUILLE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src/renderer/src/components/anneau-activite.css'
)
export const DEBUT = '/* vague-du-cadre : debut du bloc calcule par scripts/vague-du-cadre.mjs */'
export const FIN = '/* vague-du-cadre : fin du bloc calcule */'

/** Un passage toutes les 4 s ; le cycle en enchaine trois, chacun avec ses reglages. */
export const ECART_S = 4
/** Duree d'un passage : la lumiere hesite, il lui faut un peu plus que les 2,1 s d'un trajet droit. */
export const DUREE_S = 2.6
/** Etapes par passage : assez pour que le balancement se lise, sans alourdir la feuille. */
export const ETAPES = 14
/**
 * Demi-largeur du coeur blanc au repos, en pixels (le blanc plein de 40 px dessine dans la feuille,
 * de 90 a 130 px sur la bande de 220) : de combien chaque frange s'ecarte quand le coeur enfle.
 */
export const COEUR_DEMI_PX = 20

/**
 * Les trois passages. `balancement` : amplitude de l'oscillation sur la course (fraction de la
 * course) ; `oscillations` : nombre d'allers-retours pendant le passage ; `eclat` : largeur du coeur
 * blanc au plus fort (1 = 40 px) ; `pic` : moment de cet eclat (0 a 1) ; `phase` : decalage des
 * oscillations. Au-dessus de ~0,056 x 2 pi x oscillations, la lumiere repart en arriere. Ordres de
 * grandeur mesures sur la video : le blanc y oscille de +/- 25 degres sur un anneau de 118 px de
 * rayon, soit +/- 50 px (ici +/- 50 a 100 px sur une course de 1 144 px) ; il couvre 17 degres en
 * temps normal (le coeur de 40 px, a 2,2 px par degre sur un bloc de 350 x 52) et jusqu'a 150 a
 * 200 degres au plus fort de l'eclat, soit 40 a 60 % de l'anneau. Sur un bloc, la diagonale ne pose
 * qu'une partie de l'eclat (le reste tombe sur le bloc voisin) : un coeur de 180 px (4,5) n'y
 * couvrait que 36 % du tour au plus fort (film mesure par scripts/anneau_lumiere.py), 240 px (6) en
 * couvrent la moitie.
 */
export const PASSAGES = [
  { balancement: 0.06, oscillations: 2.5, eclat: 6, pic: 0.5, phase: 0 },
  { balancement: 0.065, oscillations: 2, eclat: 2.4, pic: 0.36, phase: 1.7 },
  { balancement: 0.085, oscillations: 3, eclat: 4.2, pic: 0.62, phase: 3.9 }
]

const arrondi = (n, chiffres = 3) => {
  const v = Number(n.toFixed(chiffres))
  return Object.is(v, -0) ? 0 : v
}
/** Nulle aux deux bords du passage : la lumiere entre et sort sans a-coup. */
const enveloppe = (u) => Math.sin(Math.PI * u)
const cloche = (u, centre, largeur) => Math.exp(-(((u - centre) / largeur) ** 2))

/**
 * Les etats d'un passage : progression `p` sur la course (en dehors du bloc a 0 et a 1), largeur du
 * coeur, pente et intensite, pour l'eclat principal (et son halo) et pour le second reflet.
 */
export function etatsDuPassage(reglage, etapes = ETAPES) {
  const { balancement, oscillations, eclat, pic, phase } = reglage
  const etats = []
  for (let k = 0; k <= etapes; k++) {
    const u = k / etapes
    const env = enveloppe(u)
    const p =
      -0.03 + 1.06 * u + balancement * Math.sin(2 * Math.PI * oscillations * u + phase) * env
    // L'enveloppe tient le coeur a sa taille de repos a l'entree et a la sortie du bloc.
    const largeur =
      1 + ((eclat - 1) * cloche(u, pic, 0.2) + 0.12 * Math.sin(2 * Math.PI * 3.3 * u + phase)) * env
    const principal = {
      p,
      largeur,
      ecart: COEUR_DEMI_PX * (largeur - 1),
      pente: 45 + 5 * Math.sin(2 * Math.PI * 1.3 * u + phase) * env,
      // Vacille sans s'eteindre : sur la video, le blanc reste blanc (la lumiere varie par sa TAILLE,
      // l'eclat) ; une opacite qui descendait a 0,35 ternissait tout l'eclat d'un coup, l'or en olive
      // (film mesure par scripts/anneau_lumiere.py : orange moyen #ce7f61 contre #c95527).
      intensite: Math.min(
        1,
        Math.max(
          0.65,
          0.78 + 0.22 * cloche(u, pic, 0.22) + 0.12 * Math.sin(2 * Math.PI * 4.7 * u + phase * 2)
        )
      )
    }
    // Le second reflet suit le premier a distance variable, et le croise.
    const second = {
      p: p + (0.03 + 0.09 * Math.sin(2 * Math.PI * 0.85 * u + phase + 2.2)) * env,
      largeur: 0.95 + 0.25 * Math.sin(2 * Math.PI * 2.1 * u + phase),
      pente: 45 - 7 * Math.sin(2 * Math.PI * 1.1 * u + phase + 1) * env,
      intensite: Math.min(
        0.95,
        Math.max(0.55, 0.75 + 0.2 * Math.sin(2 * Math.PI * 3.7 * u + phase + 0.5))
      )
    }
    etats.push({ u, principal, second })
  }
  return etats
}

/** La position sur la course, decalee de `decalage` pixels (les franges de part et d'autre du coeur). */
const translation = (p, decalage = 0) => {
  const d = arrondi(decalage, 1)
  const px = d === 0 ? '' : d > 0 ? ` + ${d}px` : ` - ${-d}px`
  return `translateX(calc(100cqw + var(--vague-avance) - var(--vague-course) * ${arrondi(p)}${px}))`
}

/**
 * Les animations du bloc, une par piece : ce que chacune ecrit a chaque etape. `cle` choisit le
 * reflet (principal ou second).
 */
export const ANIMATIONS = [
  {
    nom: 'cadre-vague',
    cle: 'principal',
    etape: (e) => [
      `transform: ${translation(e.p)} skewX(${arrondi(e.pente, 1)}deg) scaleX(${arrondi(e.largeur, 2)});`
    ]
  },
  {
    nom: 'cadre-vague-gauche',
    cle: 'principal',
    etape: (e) => [`transform: ${translation(e.p, -e.ecart)} skewX(${arrondi(e.pente, 1)}deg);`]
  },
  {
    nom: 'cadre-vague-droite',
    cle: 'principal',
    etape: (e) => [`transform: ${translation(e.p, e.ecart)} skewX(${arrondi(e.pente, 1)}deg);`]
  },
  {
    nom: 'cadre-vague-intensite',
    cle: 'principal',
    etape: (e) => [`opacity: ${arrondi(e.intensite, 2)};`]
  },
  {
    nom: 'cadre-vague-second',
    cle: 'second',
    etape: (e) => [
      `transform: ${translation(e.p)} skewX(${arrondi(e.pente, 1)}deg) scaleX(${arrondi(e.largeur, 2)});`,
      `opacity: ${arrondi(e.intensite, 2)};`
    ]
  }
]

/** Pourcentage du cycle, a 3 decimales : 14 etapes en 2,6 s tombent entre deux centiemes. */
const pourcent = (secondes) => `${arrondi((secondes / (ECART_S * PASSAGES.length)) * 100, 3)}%`

/** Un `@keyframes` pour une piece : ses trois passages, puis l'attente hors du bloc. */
function keyframes({ nom, cle, etape }) {
  const lignes = [`@keyframes ${nom} {`]
  PASSAGES.forEach((reglage, i) => {
    const etats = etatsDuPassage(reglage)
    etats.forEach((etat, k) => {
      const t = i * ECART_S + etat.u * DUREE_S
      lignes.push(`  ${pourcent(t)} {`)
      for (const declaration of etape(etat[cle])) lignes.push(`    ${declaration}`)
      // La fin du passage tient hors du bloc jusqu'au suivant, puis saute a son depart d'un coup :
      // interpolee, la bande retraverserait le bloc a l'envers pendant l'attente.
      if (k === etats.length - 1) lignes.push('    animation-timing-function: step-end;')
      lignes.push('  }')
    })
  })
  lignes.push('}')
  return lignes.join('\n')
}

/** Le bloc complet a poser entre les marques de la feuille. */
export function blocCalcule() {
  return [DEBUT, ...ANIMATIONS.map(keyframes), FIN].join('\n')
}

/**
 * La feuille avec le bloc recalcule, mise en forme comme le reste du depot (Prettier coupe les
 * longues etapes : sans cela, la verification lirait une feuille deja formatee comme perimee).
 * Leve une erreur si les marques manquent.
 */
export async function feuilleAJour(texte) {
  const debut = texte.indexOf(DEBUT)
  const fin = texte.indexOf(FIN)
  if (debut < 0 || fin < debut) throw new Error(`marques vague-du-cadre absentes de ${FEUILLE}`)
  const brut = texte.slice(0, debut) + blocCalcule() + texte.slice(fin + FIN.length)
  const options = (await prettier.resolveConfig(FEUILLE)) ?? {}
  return prettier.format(brut, { ...options, filepath: FEUILLE })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const texte = readFileSync(FEUILLE, 'utf8')
  const attendu = await feuilleAJour(texte)
  if (process.argv.includes('--verifier')) {
    if (attendu !== texte) {
      console.error(
        'anneau-activite.css : la vague n est plus a jour — node scripts/vague-du-cadre.mjs'
      )
      process.exit(1)
    }
    console.log('vague du cadre a jour')
  } else {
    writeFileSync(FEUILLE, attendu)
    console.log(
      `vague du cadre reecrite : ${ANIMATIONS.length} animations, ${PASSAGES.length} passages, ${ETAPES + 1} etapes chacun`
    )
  }
}
