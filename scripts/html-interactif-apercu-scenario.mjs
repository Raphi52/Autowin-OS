/**
 * SCENARIOS DE L'APERCU DES PAGES INTERACTIVES — partie pure, sans Electron.
 *
 * Pourquoi (conv-1304, 2026-10-30) : sur 6 pages ecrites par des modeles dans de vrais fils
 * (conv-1309 a conv-1314), 4 modeles ont ecrit leur propre banc d'essai, parce que
 * `html-interactif-apercu.mjs` clique tout ce qui se clique mais ne sait ni taper dans un champ, ni
 * enchainer deux gestes, ni verifier un resultat : la page sortait en code 0 sans qu'aucun calcul
 * n'ait tourne. Ces bancs ont coute jusqu'a 2,5 $ et 13 minutes par page, et l'un d'eux a fini par
 * bloquer son fil dans le navigateur integre. Un scenario decrit le parcours en JSON ; le moteur de
 * l'apercu le joue avec une vraie souris et un vrai clavier, dans la meme page isolee que le fil.
 *
 * Un scenario est un tableau d'etapes, jouees dans l'ordre sur une page neuve, a chaque largeur.
 */

import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

/** Une etape a UN verbe ; la cle du verbe porte sa cible ou son texte. */
const VERBES = {
  cliquer: { cible: true, options: ['x', 'y'] },
  survoler: { cible: true, options: ['x', 'y'] },
  remplir: { cible: true, requis: ['valeur'] },
  choisir: { cible: true, requis: ['valeur'] },
  touche: { options: [] },
  attendre: { options: [] },
  voir: { options: ['dans'] },
  pasVoir: { options: ['dans'] },
  demande: { options: ['contient'] }
}

/** Les touches que le moteur sait envoyer : refuser une faute de frappe avant de lancer Electron. */
export const TOUCHES = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight'
]

const DEMANDES = ['copier', 'lien', 'prompt']

/** Plafond d'une etape `attendre` : une page qui se juge apres une minute n'a pas sa place ici. */
export const ATTENTE_MAX_MS = 15_000

/** Combien de temps `voir`, `pasVoir` et `demande` laissent a la page pour arriver au resultat. */
export const DELAI_VERIFICATION_MS = 2_000

/**
 * Le dossier de sortie par defaut : propre a la page et stable d'un lancement a l'autre. Un second
 * essai de la meme page ecrase le premier ; deux fils n'ecrivent jamais au meme endroit. Le dossier
 * unique d'avant faisait lire a un fil les captures d'un autre (2 fils sur 6 du banc conv-1304).
 */
export function dossierDeSortie(racine, fichier) {
  const empreinte = createHash('sha1').update(resolve(fichier)).digest('hex').slice(0, 8)
  return join(racine, '.autowin-tmp', 'html-interactif-apercu', `${basename(fichier)}-${empreinte}`)
}

const estFraction = (valeur) => typeof valeur === 'number' && valeur >= 0 && valeur <= 1

/** La phrase d'erreur d'une etape invalide, ou null. La phrase dit quoi ecrire a la place. */
function defautEtape(etape) {
  if (typeof etape !== 'object' || etape === null || Array.isArray(etape))
    return 'une etape est un objet, ex. {"cliquer":"#calculer"}'
  const verbes = Object.keys(etape).filter((cle) => cle in VERBES)
  if (verbes.length !== 1)
    return `une etape porte un seul verbe parmi ${Object.keys(VERBES).join(', ')} (lu : ${
      Object.keys(etape).join(', ') || 'rien'
    })`
  const verbe = verbes[0]
  const regle = VERBES[verbe]
  const permis = new Set([verbe, ...(regle.requis ?? []), ...(regle.options ?? [])])
  const inconnue = Object.keys(etape).find((cle) => !permis.has(cle))
  if (inconnue) return `« ${verbe} » n'accepte pas le champ « ${inconnue} »`
  for (const requis of regle.requis ?? []) {
    if (etape[requis] === undefined) return `« ${verbe} » exige le champ « ${requis} »`
  }
  const valeur = etape[verbe]
  if (regle.cible && (typeof valeur !== 'string' || !valeur.trim()))
    return `« ${verbe} » vise un selecteur CSS ou texte=<libelle visible>`
  for (const axe of ['x', 'y']) {
    if (etape[axe] !== undefined && !estFraction(etape[axe]))
      return `« ${axe} » est une fraction de la cible, de 0 a 1 (0.5 = le milieu)`
  }
  if (verbe === 'touche' && !TOUCHES.includes(valeur))
    return `touche inconnue « ${valeur} » : ${TOUCHES.join(', ')}`
  if (verbe === 'attendre' && !(Number.isFinite(valeur) && valeur >= 0 && valeur <= ATTENTE_MAX_MS))
    return `« attendre » est une duree en millisecondes, de 0 a ${ATTENTE_MAX_MS}`
  if ((verbe === 'voir' || verbe === 'pasVoir') && (typeof valeur !== 'string' || !valeur.trim()))
    return `« ${verbe} » porte le texte cherche dans la page`
  if (etape.dans !== undefined && (typeof etape.dans !== 'string' || !etape.dans.trim()))
    return '« dans » est un selecteur CSS : la zone ou chercher le texte'
  if (verbe === 'demande' && !DEMANDES.includes(valeur))
    return `« demande » vaut ${DEMANDES.join(', ')} : ce que la page demande au fil apres un clic`
  return null
}

/**
 * Lit le texte d'un fichier scenario. Rend `{ etapes }` ou `{ erreur }` ; aucune etape invalide ne
 * part vers Electron : un scenario mal ecrit est un code 2 (usage), jamais un rouge de la page.
 */
export function lireScenario(texte) {
  let brut
  try {
    brut = JSON.parse(texte)
  } catch (erreur) {
    return { erreur: `scenario : JSON illisible (${erreur.message})` }
  }
  if (!Array.isArray(brut) || brut.length === 0)
    return { erreur: 'scenario : un tableau d’etapes non vide est attendu' }
  for (const [rang, etape] of brut.entries()) {
    const defaut = defautEtape(etape)
    if (defaut) return { erreur: `scenario, etape ${rang + 1} : ${defaut}` }
  }
  return { etapes: brut }
}

/** Le verbe d'une etape valide. */
export function verbeDe(etape) {
  return Object.keys(etape).find((cle) => cle in VERBES)
}

/**
 * Le texte comme l'utilisateur le LIT : `toLocaleString('fr-FR')` separe les milliers par une espace
 * fine insecable, qu'un scenario ecrit au clavier ne contient pas. Sans cela, « 1 200 € » serait
 * absent d'une page qui l'affiche.
 */
export function normaliserTexte(texte) {
  return String(texte ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Le texte cherche est-il dans celui de la page ? Insensible a la casse, comme un oeil. */
export function pageContient(textePage, cherche) {
  return normaliserTexte(textePage)
    .toLocaleLowerCase('fr-FR')
    .includes(normaliserTexte(cherche).toLocaleLowerCase('fr-FR'))
}

/** Duree maximale d'un scenario : `html-interactif-apercu.mjs` en deduit son delai de garde. */
export function dureeMaxScenarioMs(etapes) {
  return (etapes ?? []).reduce(
    (total, etape) => total + (etape.attendre ?? DELAI_VERIFICATION_MS) + 500,
    0
  )
}

/** La phrase qui nomme une etape dans le rapport. */
export function decrireEtape(etape) {
  const verbe = verbeDe(etape)
  const valeur = etape.valeur === undefined ? '' : ` = ${JSON.stringify(etape.valeur)}`
  const zone = etape.dans === undefined ? '' : ` dans ${etape.dans}`
  return `${verbe} ${JSON.stringify(etape[verbe])}${valeur}${zone}`
}
