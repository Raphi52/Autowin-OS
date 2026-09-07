/**
 * GARDE-FOU `frame` — un enonce livre a l'executant doit ENUMERER les cas limites d'entree.
 *
 * Cause localisee, pas devinee. Banc `arena-bench-ax3` (2026-09-07, 6 agents en une vague,
 * 3 repliques par bras, meme tache, meme critere comportemental de 30 assertions) :
 *   bras `a` — enonce SANS cas limites : 0 vert / 3. Defauts reels (drapeau repete avale en
 *              silence 3 fois sur 3 ; pile Node sur une valeur hors plage 2 fois sur 3).
 *   bras `x` — memes mots + la LISTE des cas limites en prose : 3 verts / 3 (30/30).
 * Separation parfaite, p = 0,10 (plancher atteignable a n=3), ecart de cout inter-bras (x3,12)
 * tres au-dessus de la dispersion intra-bras (+45 % / +20 %). Journal : `arena-duels.jsonl`.
 *
 * Niveau d'enforcement choisi des la premiere fois : garde-fou DETERMINISTE, pas une phrase de
 * plus dans la skill — c'est le seul facteur du kit dont l'effet soit mesure hors du bruit.
 *
 * Usage : node scripts/frame-cas-limites-check.mjs <chemin-du-RUN.md>
 *   exit 0 = tenu · exit 1 = cadrage refuse · exit 2 = fichier illisible.
 */
import { readFileSync } from 'node:fs'

/** Minimum de cas enumeres sous la rubrique pour qu'elle soit autre chose qu'un alibi. */
export const CAS_MINIMUM = 3

/**
 * Signes qu'un besoin decrit une ENTREE utilisateur — donc qu'il y a des cas limites a enumerer.
 * Volontairement large : le garde-fou doit se declencher par defaut, pas seulement sur les CLI.
 */
const MARQUEURS_ENTREE = [
  /(^|[^\w-])--[a-z][\w-]*/i, // un drapeau de ligne de commande
  /\b(argument|parametre|paramètre|option|drapeau|flag|saisie|champ|formulaire|input)\b/i,
  /\b(valeur|entree|entrée)\s+(saisie|fournie|passee|passée|utilisateur)\b/i,
  /\b(requete|requête|payload|query\s?string|variable d'environnement)\b/i
]

/** Titre ou amorce de la rubrique attendue. */
const TITRE_RUBRIQUE = /^\s*(#{2,6}\s*)?cas\s+limites?\b.*$/i
/** Dispense EXPLICITE et motivee — jamais un simple silence. */
const DISPENSE = /^\s*cas\s+limites?\s*:\s*(sans objet|aucun)\b.*[-—:]\s*\S+/i

/** Isole la section `## Besoin` (jusqu'au prochain titre de meme niveau). */
function sectionBesoin(texte) {
  const lignes = String(texte).split(/\r?\n/)
  const debut = lignes.findIndex((l) => /^##\s+Besoin\b/i.test(l))
  if (debut === -1) return String(texte) // pas de RUN structure : on juge le texte entier
  let fin = lignes.length
  for (let i = debut + 1; i < lignes.length; i++) {
    if (/^##\s+/.test(lignes[i])) {
      fin = i
      break
    }
  }
  return lignes.slice(debut, fin).join('\n')
}

/**
 * @param {string} texte  Le RUN.md complet, ou la seule section `## Besoin`.
 * @returns {{tenu: boolean, motif: string, cas: string[]}}
 */
export function verifierCasLimites(texte) {
  const besoin = sectionBesoin(texte)
  const lignes = besoin.split(/\r?\n/)

  const dispense = lignes.find((l) => DISPENSE.test(l))
  if (dispense) {
    return { tenu: true, motif: `dispense explicite et motivee : ${dispense.trim()}`, cas: [] }
  }

  const debutRubrique = lignes.findIndex((l) => TITRE_RUBRIQUE.test(l))
  const cas = []
  if (debutRubrique !== -1) {
    for (let i = debutRubrique + 1; i < lignes.length; i++) {
      const l = lignes[i]
      if (/^\s*#{2,6}\s/.test(l)) break // rubrique suivante
      if (/^\s*([-*]|\d+[.)])\s+\S/.test(l)) cas.push(l.trim())
    }
  }
  if (cas.length >= CAS_MINIMUM) {
    return { tenu: true, motif: `${cas.length} cas limites enumeres`, cas }
  }

  // Rien d'enumere : le refus ne tombe que si le besoin decrit bien une entree.
  const sansEntree = !MARQUEURS_ENTREE.some((re) => re.test(besoin))
  if (sansEntree && debutRubrique === -1) {
    return { tenu: true, motif: 'aucune entree utilisateur decrite — rien a enumerer', cas: [] }
  }
  const motif =
    debutRubrique === -1
      ? `le besoin decrit une entree utilisateur mais n'enumere AUCUN cas limite (minimum ${CAS_MINIMUM}). ` +
        `Ajoute une rubrique « Cas limites d'entree », ou une dispense motivee ` +
        `(« Cas limites : sans objet — <raison> »).`
      : `rubrique « Cas limites » presente mais ${cas.length} cas enumere(s) : il en faut au moins ${CAS_MINIMUM}.`
  return { tenu: false, motif, cas }
}

/** @param {string} chemin RUN.md a verifier. */
export function verifierFichier(chemin) {
  return verifierCasLimites(readFileSync(chemin, 'utf8'))
}

const estCli = String(process.argv[1] || '').includes('frame-cas-limites-check.mjs')
if (estCli && process.argv[2]) {
  let r
  try {
    r = verifierFichier(process.argv[2])
  } catch (e) {
    console.error(`illisible : ${e.message}`)
    process.exit(2)
  }
  if (r.tenu) {
    console.log(`CADRAGE TENU — ${r.motif}`)
    process.exit(0)
  }
  console.error(`CADRAGE REFUSE — ${r.motif}`)
  process.exit(1)
}
