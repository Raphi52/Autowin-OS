/**
 * LA VAGUE DU CADRE, CALCULEE — les `@keyframes` de la lumiere qui traverse les blocs du fil
 * (src/renderer/src/components/anneau-activite.css, entre les deux marques `vague-du-cadre`).
 *
 * Pourquoi un calcul et pas des etapes ecrites a la main : la demande est « moins lineaire, presque
 * chaotique, vraiment comme la video de Pinterest » (2026-11-13). Mesure sur cette video (75 images
 * a 15 images/s, anneau deroule secteur par secteur) : plusieurs trainees de lumiere a la fois, qui
 * OSCILLENT autour de leur place (jusqu'a revenir en arriere), un blanc qui GONFLE jusqu'a couvrir
 * plus de la moitie de l'anneau puis retombe, et une aura qui s'allume avec lui. Une vitesse
 * constante n'en garde rien. Ici, chaque passage suit une progression balancee (une sinusoide sur
 * la course, nulle aux bords), une largeur qui enfle en eclat puis retombe, une intensite qui
 * vacille ; un second reflet, plus fin, croise le premier. Les trois passages du cycle ont chacun
 * leurs reglages : aucun ne ressemble au precedent.
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
 * Les trois passages. `balancement` : amplitude de l'oscillation sur la course (fraction de la
 * course) ; `oscillations` : nombre d'allers-retours pendant le passage ; `eclat` : largeur de la
 * bande au plus fort (1 = 220 px) ; `pic` : moment de cet eclat (0 a 1) ; `phase` : decalage des
 * oscillations. Au-dessus de ~0,056 x 2 pi x oscillations, la lumiere repart en arriere. Ordre de
 * grandeur mesure sur la video : le blanc y oscille de +/- 25 degres sur un anneau de 118 px de
 * rayon, soit +/- 50 px ; ici +/- 50 a 100 px sur une course de 1 144 px.
 */
export const PASSAGES = [
  { balancement: 0.06, oscillations: 2.5, eclat: 2.3, pic: 0.5, phase: 0 },
  { balancement: 0.065, oscillations: 2, eclat: 1.5, pic: 0.34, phase: 1.7 },
  { balancement: 0.085, oscillations: 3, eclat: 1.9, pic: 0.64, phase: 3.9 }
]

const arrondi = (n, chiffres = 3) => {
  const v = Number(n.toFixed(chiffres))
  return Object.is(v, -0) ? 0 : v
}
/** Nulle aux deux bords du passage : la lumiere entre et sort sans a-coup. */
const enveloppe = (u) => Math.sin(Math.PI * u)
const cloche = (u, centre, largeur) => Math.exp(-(((u - centre) / largeur) ** 2))

/**
 * Les etats d'un passage : progression `p` sur la course (en dehors du bloc a 0 et a 1), largeur,
 * pente et intensite, pour le reflet principal (et son aura) et pour le second reflet.
 */
export function etatsDuPassage(reglage, etapes = ETAPES) {
  const { balancement, oscillations, eclat, pic, phase } = reglage
  const etats = []
  for (let k = 0; k <= etapes; k++) {
    const u = k / etapes
    const env = enveloppe(u)
    const p =
      -0.03 + 1.06 * u + balancement * Math.sin(2 * Math.PI * oscillations * u + phase) * env
    const principal = {
      p,
      largeur:
        1 +
        (eclat - 1) * cloche(u, pic, 0.17) +
        0.12 * Math.sin(2 * Math.PI * 3.3 * u + phase) * env,
      pente: 45 + 5 * Math.sin(2 * Math.PI * 1.3 * u + phase) * env,
      intensite: Math.min(
        1,
        Math.max(
          0.35,
          0.55 + 0.45 * cloche(u, pic, 0.22) + 0.14 * Math.sin(2 * Math.PI * 4.7 * u + phase * 2)
        )
      )
    }
    // Le second reflet suit le premier a distance variable, et le croise.
    const second = {
      p: p + (0.03 + 0.09 * Math.sin(2 * Math.PI * 0.85 * u + phase + 2.2)) * env,
      largeur: 0.55 + 0.2 * Math.sin(2 * Math.PI * 2.1 * u + phase),
      pente: 45 - 7 * Math.sin(2 * Math.PI * 1.1 * u + phase + 1) * env,
      intensite: Math.min(
        0.9,
        Math.max(0.3, 0.6 + 0.3 * Math.sin(2 * Math.PI * 3.7 * u + phase + 0.5))
      )
    }
    etats.push({ u, principal, second })
  }
  return etats
}

const transform = ({ p, largeur, pente }) =>
  `translateX(calc(100cqw + var(--vague-avance) - var(--vague-course) * ${arrondi(p)})) skewX(${arrondi(pente, 1)}deg) scaleX(${arrondi(largeur, 2)})`

/** Pourcentage du cycle, a 3 decimales : 14 etapes en 2,6 s tombent entre deux centiemes. */
const pourcent = (secondes) => `${arrondi((secondes / (ECART_S * PASSAGES.length)) * 100, 3)}%`

/** Un `@keyframes` pour un reflet : ses trois passages, puis l'attente hors du bloc. */
function keyframes(nom, cle) {
  const lignes = [`@keyframes ${nom} {`]
  PASSAGES.forEach((reglage, i) => {
    const etats = etatsDuPassage(reglage)
    etats.forEach((etat, k) => {
      const t = i * ECART_S + etat.u * DUREE_S
      const e = etat[cle]
      lignes.push(`  ${pourcent(t)} {`)
      lignes.push(`    transform: ${transform(e)};`)
      lignes.push(`    opacity: ${arrondi(e.intensite, 2)};`)
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
  return [
    DEBUT,
    keyframes('cadre-vague', 'principal'),
    keyframes('cadre-vague-second', 'second'),
    FIN
  ].join('\n')
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
      `vague du cadre reecrite : ${PASSAGES.length} passages, ${ETAPES + 1} etapes chacun`
    )
  }
}
