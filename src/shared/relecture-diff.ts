/**
 * RELECTURE LIGNE À LIGNE D'UN DIFF — commenter une ligne précise et renvoyer le lot à l'agent.
 *
 * Écart constaté le 2026-09-28 (veille concurrentielle, conv-877) : Conductor, l'application Codex,
 * Antigravity et GitHub laissent commenter une ligne du diff pour que l'agent reçoive un retour
 * PRÉCIS. Le diff d'Autowin était en lecture seule : un retour devait être retapé à la main dans le
 * chat, avec le chemin et la ligne recopiés de mémoire.
 *
 * Ce module est PUR (aucun React, aucun stockage) : il repère une ligne du diff et compose le message
 * envoyé à l'agent. Deux choix vont au-delà d'un simple « chemin:ligne » :
 * - chaque commentaire emporte le TEXTE EXACT de la ligne visée et ses voisines du même bloc : si
 *   l'agent a déjà décalé les numéros de ligne, il retrouve l'endroit par le contenu ;
 * - les commentaires de plusieurs fichiers partent en UN SEUL message, groupés par fichier et triés
 *   par ligne, comme une relecture GitHub, au lieu d'un aller-retour par remarque.
 */
import type { DiffLine } from './git-read'

/** `apres` : numéro dans le fichier MODIFIÉ (ajout, contexte). `avant` : ligne SUPPRIMÉE, numéro d'origine. */
export type CoteRelecture = 'apres' | 'avant'

export interface RepereLigne {
  cote: CoteRelecture
  ligne: number
  /** Le texte exact de la ligne visée, sans son marqueur de diff (+, -, espace). */
  extrait: string
  /** Lignes voisines du MÊME bloc, marqueur compris ; la ligne visée y figure aussi. */
  voisinage: string[]
  /** Position de la ligne visée dans `voisinage`. */
  indexDansVoisinage: number
}

export interface CommentaireRelecture extends RepereLigne {
  id: string
  chemin: string
  texte: string
}

/** Nombre de lignes de voisinage gardées de chaque côté de la ligne visée. */
export const VOISINAGE_RELECTURE = 2

const COMMENTABLES = new Set<DiffLine['kind']>(['add', 'del', 'context'])

/** Une ligne se commente si elle porte un numéro : ajout, suppression ou contexte. Jamais un en-tête. */
export function ligneCommentable(ligne: DiffLine): boolean {
  if (!COMMENTABLES.has(ligne.kind)) return false
  return ligne.kind === 'del' ? ligne.oldLine !== undefined : ligne.newLine !== undefined
}

/**
 * Repère la ligne `index` du diff parsé : côté, numéro, texte exact et voisinage borné au bloc.
 * Rend `null` pour une ligne qui ne se commente pas (en-tête, bloc `@@`, annotation).
 */
export function repererLigne(lignes: readonly DiffLine[], index: number): RepereLigne | null {
  const cible = lignes[index]
  if (!cible || !ligneCommentable(cible)) return null
  const cote: CoteRelecture = cible.kind === 'del' ? 'avant' : 'apres'
  const ligne = (cote === 'avant' ? cible.oldLine : cible.newLine) as number
  let debut = index
  while (debut > index - VOISINAGE_RELECTURE && debut > 0 && ligneCommentable(lignes[debut - 1]))
    debut--
  let fin = index
  while (
    fin < index + VOISINAGE_RELECTURE &&
    fin < lignes.length - 1 &&
    ligneCommentable(lignes[fin + 1])
  )
    fin++
  return {
    cote,
    ligne,
    extrait: cible.text.slice(1),
    voisinage: lignes.slice(debut, fin + 1).map((l) => l.text),
    indexDansVoisinage: index - debut
  }
}

/** Identité d'un emplacement commentable : un seul commentaire par ligne et par côté d'un fichier. */
export function cleEmplacement(chemin: string, cote: CoteRelecture, ligne: number): string {
  return `${chemin}\0${cote}\0${ligne}`
}

/** Une clôture de bloc plus longue que toute suite d'accents graves du contenu : le bloc ne se casse pas. */
function cloture(contenu: string): string {
  const plusLongue = Math.max(0, ...(contenu.match(/`+/g) ?? []).map((suite) => suite.length))
  return '`'.repeat(Math.max(3, plusLongue + 1))
}

/** Les fichiers dans l'ordre de leur premier commentaire, les commentaires triés par ligne. */
function ordonner(commentaires: readonly CommentaireRelecture[]): CommentaireRelecture[] {
  const rangFichier = new Map<string, number>()
  for (const c of commentaires)
    if (!rangFichier.has(c.chemin)) rangFichier.set(c.chemin, rangFichier.size)
  return [...commentaires].sort(
    (a, b) =>
      (rangFichier.get(a.chemin) as number) - (rangFichier.get(b.chemin) as number) ||
      a.ligne - b.ligne ||
      (a.cote === b.cote ? 0 : a.cote === 'avant' ? -1 : 1)
  )
}

/**
 * Le message de relecture envoyé à l'agent. Rend une chaîne vide s'il n'y a aucun commentaire
 * non vide : on n'envoie jamais une relecture creuse.
 */
export function composerRelecture(commentaires: readonly CommentaireRelecture[]): string {
  const retenus = ordonner(commentaires.filter((c) => c.texte.trim()))
  if (retenus.length === 0) return ''
  const fichiers = new Set(retenus.map((c) => c.chemin)).size
  const nb = retenus.length
  const entete =
    `Relecture de tes changements : ${nb} commentaire${nb > 1 ? 's' : ''} sur ` +
    `${fichiers} fichier${fichiers > 1 ? 's' : ''}. Traite CHAQUE commentaire à l'endroit indiqué ` +
    `et ne modifie rien d'autre. Si le numéro de ligne a bougé, retrouve l'endroit grâce au texte ` +
    `cité. Réponds ensuite point par point : numéro, fichier:ligne, ce que tu as fait — ou pourquoi ` +
    `tu ne l'as pas fait.`
  const blocs = retenus.map((c, i) => {
    const repere =
      c.cote === 'avant'
        ? `${c.chemin}:${c.ligne} (ligne supprimée, numéro d'origine)`
        : `${c.chemin}:${c.ligne}`
    const voisinage = c.voisinage
      .map((l, j) => (j === c.indexDansVoisinage ? `${l}    ⟵ ici` : l))
      .join('\n')
    const clot = cloture(voisinage)
    const texte = c.texte
      .trim()
      .split(/\r?\n/)
      .map((l, j) => (j === 0 ? l : `   ${l}`))
      .join('\n')
    return `${i + 1}. ${repere}\n${clot}diff\n${voisinage}\n${clot}\n   Commentaire : ${texte}`
  })
  return [entete, ...blocs].join('\n\n')
}

/**
 * Relit une liste de commentaires venue d'un stockage non fiable (JSON du navigateur) : tout élément
 * mal formé est écarté, jamais réparé à l'aveugle.
 */
export function relireCommentaires(brut: unknown): CommentaireRelecture[] {
  if (!Array.isArray(brut)) return []
  const sortie: CommentaireRelecture[] = []
  for (const e of brut) {
    if (!e || typeof e !== 'object') continue
    const c = e as Record<string, unknown>
    if (
      typeof c.id !== 'string' ||
      typeof c.chemin !== 'string' ||
      (c.cote !== 'apres' && c.cote !== 'avant') ||
      typeof c.ligne !== 'number' ||
      !Number.isInteger(c.ligne) ||
      typeof c.extrait !== 'string' ||
      typeof c.texte !== 'string' ||
      !Array.isArray(c.voisinage) ||
      !c.voisinage.every((l) => typeof l === 'string') ||
      typeof c.indexDansVoisinage !== 'number'
    )
      continue
    sortie.push({
      id: c.id,
      chemin: c.chemin,
      cote: c.cote,
      ligne: c.ligne,
      extrait: c.extrait,
      texte: c.texte,
      voisinage: c.voisinage as string[],
      indexDansVoisinage: c.indexDansVoisinage
    })
  }
  return sortie
}
