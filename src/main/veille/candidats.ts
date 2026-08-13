/**
 * Ce qui fait qu'un candidat de veille est ACCEPTABLE, et ce qui le fait refuser.
 *
 * La veille lit des notes de version de produits concurrents et en tire des candidats de chantier. Le
 * risque n'est pas de rater une nouveauté : c'est d'en INVENTER une. Un modèle à qui on demande « qu'a
 * sorti Kimi ce mois-ci » produit une réponse plausible même sans avoir rien lu, et une liste de features
 * imaginaires est bien pire qu'une liste vide — elle envoie construire ce qui n'existe pas.
 *
 * D'où la règle unique de ce module : un candidat porte l'URL, la date et la LIGNE CITÉE d'où il vient,
 * sinon il n'entre pas. La citation n'est pas décorative, c'est la pièce qu'un vérificateur hors modèle
 * rejoue : on récupère l'URL et on cherche la citation dedans. Absente → candidat refusé.
 *
 * Aucun refus n'est silencieux. Chaque candidat écarté sort avec sa raison, parce qu'une veille qui filtre
 * sans le dire se lit comme une veille qui n'a rien trouvé.
 */

/** Ce que la vue Tickets affiche, une ligne par candidat. */
export interface CandidatVeille {
  /** Clé stable, calculée : deux passes sur la même entrée ne créent pas deux candidats. */
  id: string
  /** Le produit concurrent — « Codex », « OpenCode »… tel qu'écrit dans la liste de sources. */
  concurrent: string
  titre: string
  /** L'URL RÉELLEMENT lue, pas la page d'accueil du produit. */
  url: string
  /** La date portée par l'entrée lue. Pas la date de la passe : ce qui compte est l'âge de la nouveauté. */
  dateSource: string
  /** La ligne recopiée de la page. C'est elle qu'un vérificateur rejoue. */
  citation: string
  /** Langue dans laquelle la source a été lue : plusieurs concurrents ne publient qu'en anglais. */
  langue?: string
  /** Le prompt prêt à partir dans le chat. */
  prompt: string
  /** Quand la passe a vu cette entrée pour la première fois. */
  vuLe: string
  statut: 'nouveau' | 'ecarte' | 'prompte'
}

/** Ce qu'un scout rend : les champs bruts, avant tout contrôle. */
export interface CandidatBrut {
  concurrent?: string
  titre?: string
  url?: string
  dateSource?: string
  citation?: string
  langue?: string
}

export type RaisonRefus =
  | 'concurrent manquant'
  | 'titre manquant'
  | 'url manquante'
  | 'url non http(s)'
  | 'date manquante'
  | 'citation manquante'
  | 'citation trop courte'
  | 'deja connu'

export interface Refus {
  raison: RaisonRefus
  brut: CandidatBrut
}

/**
 * Longueur minimale d'une citation.
 *
 * Une citation de trois mots ne prouve rien : « nouvelle fonctionnalité » se retrouve dans n'importe
 * quelle page, donc le vérificateur passerait au vert sur un candidat inventé. Quarante caractères, c'est
 * assez pour qu'une phrase recopiée soit unique dans sa page, et assez peu pour ne pas exiger un
 * paragraphe entier.
 */
export const CITATION_MINIMUM = 40

/**
 * Titre réduit à sa forme comparable, pour reconnaître la même entrée d'une passe à l'autre.
 *
 * Les notes de version se réécrivent : une majuscule change, un point final apparaît, deux espaces se
 * glissent. Comparer les titres bruts créerait un doublon à chaque retouche cosmétique.
 */
export function normaliserTitre(titre: string): string {
  return titre
    .toLocaleLowerCase('fr')
    .replace(/[\s ]+/g, ' ')
    .replace(/[.,;:!?()[\]«»"'’]/g, '')
    .trim()
}

/**
 * La clé de déduplication : le produit, l'URL, et le titre normalisé.
 *
 * L'URL seule ne suffit pas — une page de notes de version porte toutes les versions, donc chaque entrée
 * partage l'URL de ses voisines. Le titre seul ne suffit pas non plus : deux concurrents peuvent sortir
 * « support MCP » la même semaine, et ce sont bien deux candidats.
 */
export function cleDedup(candidat: Pick<CandidatBrut, 'concurrent' | 'url' | 'titre'>): string {
  return [
    (candidat.concurrent ?? '').trim().toLocaleLowerCase('fr'),
    (candidat.url ?? '').trim(),
    normaliserTitre(candidat.titre ?? '')
  ].join('|')
}

function urlAcceptable(url: string): boolean {
  try {
    const analysee = new URL(url)
    // `http`/`https` seulement : un `file:` ou un `data:` ne serait pas une source publique vérifiable.
    return analysee.protocol === 'http:' || analysee.protocol === 'https:'
  } catch {
    return false
  }
}

function premierRefus(brut: CandidatBrut): RaisonRefus | undefined {
  if (!brut.concurrent?.trim()) return 'concurrent manquant'
  if (!brut.titre?.trim()) return 'titre manquant'
  if (!brut.url?.trim()) return 'url manquante'
  if (!urlAcceptable(brut.url.trim())) return 'url non http(s)'
  if (!brut.dateSource?.trim()) return 'date manquante'
  if (!brut.citation?.trim()) return 'citation manquante'
  if (brut.citation.trim().length < CITATION_MINIMUM) return 'citation trop courte'
  return undefined
}

export interface Tri {
  retenus: CandidatVeille[]
  refuses: Refus[]
}

/**
 * Trie les candidats bruts d'une passe : ce qui entre, et ce qui est refusé AVEC sa raison.
 *
 * `deja` porte les clés des candidats déjà connus — la déduplication se fait donc contre TOUT l'historique
 * et pas seulement à l'intérieur de la passe, sinon un candidat écarté à la main reviendrait à chaque tour.
 */
export function trierCandidats(
  bruts: readonly CandidatBrut[],
  deja: ReadonlySet<string>,
  contexte: { maintenant: string; redigerPrompt: (candidat: CandidatBrut) => string }
): Tri {
  const retenus: CandidatVeille[] = []
  const refuses: Refus[] = []
  // Les clés vues DANS cette passe comptent aussi : un scout peut rendre deux fois la même entrée.
  const vues = new Set(deja)

  for (const brut of bruts) {
    const raison = premierRefus(brut)
    if (raison) {
      refuses.push({ raison, brut })
      continue
    }
    const cle = cleDedup(brut)
    if (vues.has(cle)) {
      refuses.push({ raison: 'deja connu', brut })
      continue
    }
    vues.add(cle)
    retenus.push({
      id: cle,
      concurrent: brut.concurrent!.trim(),
      titre: brut.titre!.trim(),
      url: brut.url!.trim(),
      dateSource: brut.dateSource!.trim(),
      citation: brut.citation!.trim(),
      ...(brut.langue?.trim() ? { langue: brut.langue.trim() } : {}),
      prompt: contexte.redigerPrompt(brut),
      vuLe: contexte.maintenant,
      statut: 'nouveau'
    })
  }

  return { retenus, refuses }
}
