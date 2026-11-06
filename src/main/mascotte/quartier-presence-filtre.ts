/**
 * LE FILTRE DES TITRES PUBLIÉS (plan « Village commun », conv-1429, D-9 de `grill/agent-hq-japon-town.md`).
 *
 * Décision de l'utilisateur : le partage de présence est actif pour tous, donc un filtre passe AVANT
 * toute écriture sur le partage. Mesure du 2026-11-01 (`grill/quartier/scripts/bulles-sensibles.mjs`,
 * 11 939 phrases d'agents) : 1,0 % portent un chemin, un long identifiant, une adresse, un nom de
 * base ou un long numéro. `redactSecrets` (`crash-handlers.ts`) ne masque que les jetons connus : il
 * fallait ce filtre dédié.
 *
 * Fonction pure, sans état : chaque morceau sensible devient « … », puis le titre est coupé à
 * `PRESENCE_TITRE_MAX`. Les règles sont générales (formes de chemins, d'adresses, de numéros) : aucun
 * nom de client ni de base n'est écrit ici.
 *
 * Ce qu'il retire :
 *  - les adresses web (avec protocole, `www.`, ou un nom de domaine courant) et les adresses mail ;
 *  - les chemins Windows (`C:\…`, `D:/…`), UNC (`\\serveur\…`, `//serveur/…`) et Unix (`/a/b`, `~/…`,
 *    `./…`, un chemin relatif qui finit par une extension) — y compris la suite d'un chemin coupée
 *    par une espace (`Projets IA\Board`) ;
 *  - les GUID, les longs identifiants (16 caractères et plus, chiffres ET lettres mêlés) ;
 *  - les noms en MAJUSCULES_AVEC_SOULIGNÉ (noms de bases, constantes) ;
 *  - les nombres de 6 chiffres et plus, même groupés par des espaces ou des points (`123 456 789`).
 *
 * Ce qu'il garde : une commande de skill (`/build`), une date ISO, un numéro de fil (`conv-1430`), un
 * mot long sans chiffre (`authentification`), « oui/non », « TCP/IP ».
 */
import { PRESENCE_TITRE_MAX } from '../../shared/quartier-presence'

const ELLIPSE = '…'
/** Marques internes : un chemin (dont la suite après une espace est aussi retirée) et un autre morceau. */
const MARQUE_CHEMIN = '\uE000'
const MARQUE = '\uE001'

/** Lettres (accents compris), chiffres et les signes qu'on trouve dans un nom de fichier. */
const CAR_FICHIER = String.raw`[\p{L}\p{N}_.@$+~-]`

const REGLES: readonly { motif: RegExp; marque: string }[] = [
  // Adresses web avec protocole : avant les chemins, elles contiennent des barres obliques.
  { motif: /\b(?:https?|ftp|file|smb):\/\/[^\s<>"'«»]+/giu, marque: MARQUE },
  // Adresses mail : avant les noms de domaine, sinon il resterait « prenom.nom@… ».
  { motif: /[\p{L}\p{N}_.+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu, marque: MARQUE },
  { motif: /\bwww\.[^\s<>"'«»]+/giu, marque: MARQUE },
  // Un nom de domaine sans protocole (`exemple.com/x`) : seulement les terminaisons courantes, pour
  // qu'un nom de fichier (`board.json`) ne soit pas pris pour une adresse.
  {
    motif:
      /(?<![\p{L}\p{N}_.@-])(?:[\p{L}\p{N}-]+\.)+(?:com|fr|net|org|io|eu|dev|app|info|local|lan|intra|corp|internal)(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}])(?:\/[^\s<>"'«»]*)?/giu,
    marque: MARQUE
  },
  // UNC (`\\serveur\partage`) et chemins à lettre de lecteur (`D:\…`, `D:/…`).
  { motif: /\\\\[^\s\\]+(?:\\\S*)?/gu, marque: MARQUE_CHEMIN },
  { motif: /(?<![\p{L}\p{N}_])[A-Za-z]:[\\/]\S*/gu, marque: MARQUE_CHEMIN },
  // Tout mot qui porte une barre oblique inverse est un morceau de chemin Windows.
  { motif: /(?=\S*[\p{L}\p{N}])\S*\\\S*/gu, marque: MARQUE_CHEMIN },
  // Unix : `~/…`, `./…`, `../…`.
  { motif: /(?<![\p{L}\p{N}_/])(?:~|\.\.?)\/\S*/gu, marque: MARQUE_CHEMIN },
  // Unix absolu et UNC à barres droites : au moins deux segments, pour garder une commande `/build`.
  {
    motif: new RegExp(
      String.raw`(?<![\p{L}\p{N}_.:/~-])\/{1,2}${CAR_FICHIER}+(?:\/${CAR_FICHIER}+)+\/?`,
      'gu'
    ),
    marque: MARQUE_CHEMIN
  },
  // Chemin relatif qui finit par une extension (`dossier/fichier.pdf`) ; « oui/non » reste.
  {
    motif: new RegExp(
      String.raw`(?<![\p{L}\p{N}_/])${CAR_FICHIER}+(?:\/${CAR_FICHIER}+)*\/${CAR_FICHIER}*\.[\p{L}\p{N}]{1,6}(?![\p{L}\p{N}_])`,
      'gu'
    ),
    marque: MARQUE_CHEMIN
  },
  // GUID.
  {
    motif: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
    marque: MARQUE
  },
  // Noms en MAJUSCULES_AVEC_SOULIGNÉ : bases de données, constantes.
  { motif: /(?<![\p{L}\p{N}_])[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+(?![\p{L}\p{N}_])/gu, marque: MARQUE }
]

/** Un mot de 16 caractères et plus qui mêle chiffres et lettres : jeton, empreinte, identifiant. */
const MOT_LONG = /(?<![\p{L}\p{N}_-])[A-Za-z0-9_-]{16,}(?![\p{L}\p{N}_-])/gu
/** 6 chiffres et plus, éventuellement groupés par UNE espace (fine ou insécable) ou un point. */
const NOMBRE_LONG = /(?<![\p{L}\p{N}_])\d(?:[ .\u00a0\u202f]?\d){5,}(?![\p{L}\p{N}_])/gu
/**
 * La suite d'un chemin coupé par une espace (`\\serveur\Projets IA\Board`, `D:\Mes Rapport final.pdf`)
 * part avec lui : un mot qui porte une barre oblique, ou qui finit par une extension.
 */
const SUITE_DE_CHEMIN = new RegExp(
  String.raw`${MARQUE_CHEMIN}(?:\s+(?:(?=\S*[\p{L}\p{N}])\S*[\\/]\S*|\S*\.[\p{L}\p{N}]{1,6}(?=\s|$)))+`,
  'gu'
)

/** Caractères de contrôle et zone privée : ils casseraient l'affichage ou imiteraient une marque. */
// eslint-disable-next-line no-control-regex
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f\uE000-\uF8FF]/gu

/**
 * Le titre tel qu'il peut partir sur le partage : sans chemin, adresse, long numéro, long identifiant
 * ni nom de base, sur une ligne, et coupé à `max` caractères (« … » final quand il est coupé).
 */
export function filtrerTitre(brut: string, max: number = PRESENCE_TITRE_MAX): string {
  let t = String(brut ?? '')
    .replace(INVISIBLES, ' ')
    .replace(/\s+/gu, ' ')
  for (const { motif, marque } of REGLES) t = t.replace(motif, marque)
  t = t.replace(MOT_LONG, (mot) => (/\d/.test(mot) && /[A-Za-z]/.test(mot) ? MARQUE : mot))
  t = t.replace(NOMBRE_LONG, MARQUE)
  t = t.replace(SUITE_DE_CHEMIN, MARQUE_CHEMIN)
  t = t
    .replace(/[\uE000\uE001]/gu, ELLIPSE)
    // Deux morceaux retirés côte à côte n'en font qu'un : « … … » ne dit rien de plus.
    .replace(/…(?:[\s,;:/\\.-]*…)+/gu, ELLIPSE)
    .replace(/\s+/gu, ' ')
    .trim()
  return couper(t, max)
}

/** Coupe à `max` caractères (points de code, pour ne jamais casser un émoji), « … » final compris. */
export function couper(texte: string, max: number): string {
  const car = Array.from(texte)
  if (car.length <= max) return texte
  return `${car
    .slice(0, Math.max(0, max - 1))
    .join('')
    .trimEnd()}${ELLIPSE}`
}
