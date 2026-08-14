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
  /**
   * Ce que l'entrée EST : un ajout de capacité, ou une correction.
   *
   * Constaté sur la première passe réelle : sur 10 candidats tirés d'un CHANGELOG, 8 étaient des
   * corrections de bugs — « corrige la connexion OAuth MCP », « pings keepalive contre un timeout »,
   * « corrige un crash sur les chemins UNC ». Proposer d'implémenter la correction d'un bug qu'on n'a
   * pas n'a aucun sens, et les deux vraies features étaient noyées dans le lot.
   */
  type: TypeEntree
  /** Contrat étendu (14/08) : quoi / pourquoi / comment, affichés dépliés dans l'onglet Tickets. */
  what?: string
  why?: string
  how?: string
  /**
   * PERTINENCE pour Autowin, 0-100, telle que le scout l'a jugée : à quel point cette nouveauté
   * mérite d'être reprise ici. `undefined` = le scout n'en a pas donné (source ancienne, ou modèle
   * qui a ignoré la consigne) — on ne l'invente pas, l'absence est un fait distinct d'un zéro.
   */
  pertinence?: number
  /** Le prompt prêt à partir dans le chat. */
  prompt: string
  /** Quand la passe a vu cette entrée pour la première fois. */
  vuLe: string
  statut: 'nouveau' | 'ecarte' | 'prompte'
}

/**
 * La nature d'une entrée de notes de version.
 *
 * Les trois natures sont CONSERVÉES, et c'est un revirement assumé : la première version refusait tout
 * ce qui n'était pas un `ajout`, ce qui écartait 19 entrées sur 21 dans un seul CHANGELOG. Écarter
 * n'était pas idiot — on ne réimplémente pas le correctif d'un bug qu'on n'a pas — mais ça jetait de
 * l'information que l'utilisateur veut voir : ce que les concurrents CORRIGENT dit aussi où ils butent.
 *
 * La séparation se fait donc à l'AFFICHAGE (deux colonnes), pas à l'entrée. Ce qui reste refusé, c'est
 * seulement ce qui n'a pas de preuve : citation, date ou URL manquantes.
 */
export type TypeEntree = 'ajout' | 'correction' | 'autre'

/** Ramène ce qu'un scout a écrit à l'une des trois natures. Inconnu → `autre`, jamais deviné. */
export function natureDe(brut: string | undefined): TypeEntree {
  const valeur = brut?.trim().toLowerCase()
  return valeur === 'ajout' || valeur === 'correction' ? valeur : 'autre'
}

/** Ce qu'un scout rend : les champs bruts, avant tout contrôle. */
export interface CandidatBrut {
  concurrent?: string
  titre?: string
  url?: string
  dateSource?: string
  citation?: string
  langue?: string
  type?: string
  /** Pertinence 0-100 telle que rendue par le scout ; bornée à l'entrée, jamais crue sur parole. */
  pertinence?: number
  /** Contrat étendu du scout interne (14/08) : ce que ça fait / pourquoi l'usage le réclame / le 1er pas. */
  what?: string
  why?: string
  how?: string
}

/**
 * Ramène une pertinence brute (nombre, chaîne numérique, hors bornes) à un entier 0-100, ou
 * `undefined`. Piège trouvé par test : `Number(null)`, `Number('')` et `Number([])` valent `0`, pas
 * `NaN` — accepter aveuglément `Number(valeur)` aurait transformé une note ABSENTE en un vrai zéro,
 * exactement le mensonge que le champ optionnel doit éviter. On n'accepte donc QUE `number` ou une
 * chaîne non vide entièrement numérique.
 */
export function bornerPertinence(valeur: unknown): number | undefined {
  let n: number
  if (typeof valeur === 'number') n = valeur
  else if (typeof valeur === 'string' && valeur.trim() !== '') n = Number(valeur)
  else return undefined
  if (!Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(100, Math.round(n)))
}

export type RaisonRefus =
  | 'concurrent manquant'
  | 'titre manquant'
  | 'url manquante'
  | 'url non http(s)'
  | 'date manquante'
  | 'citation manquante'
  | 'citation trop courte'
  | 'nature non precisee'
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
 * Minimum pour une citation INTERNE : une ligne de code, pas une phrase.
 *
 * Dix caracteres suffisent a exclure un fragment inutilisable (`}`, `return`) sans refuser une ligne
 * courte et parfaitement probante.
 */
export const CITATION_MINIMUM_INTERNE = 10

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

/**
 * Ancrage INTERNE : `chemin/du/fichier.ts:123`.
 *
 * Un candidat tire du depot n'a pas d'URL publique — son adresse verifiable est le fichier et la
 * ligne. Le champ `url` du modele signifie « ou aller voir » : l'ancrage y tient exactement le meme
 * role, et l'exigence de fond (une adresse qu'un verificateur peut rouvrir) est respectee. La forme
 * est CONTRAINTE (chemin sous `src/` ou `scripts/`, suivi d'un numero de ligne) pour qu'une chaine
 * quelconque ne passe pas pour un ancrage.
 */
export function ancrageInterne(valeur: string): boolean {
  return /^(?:src|scripts)\/[\w./-]+:\d+$/.test(valeur)
}

function premierRefus(brut: CandidatBrut): RaisonRefus | undefined {
  if (!brut.concurrent?.trim()) return 'concurrent manquant'
  if (!brut.titre?.trim()) return 'titre manquant'
  if (!brut.url?.trim()) return 'url manquante'
  if (!urlAcceptable(brut.url.trim()) && !ancrageInterne(brut.url.trim())) return 'url non http(s)'
  if (!brut.dateSource?.trim()) return 'date manquante'
  if (!brut.citation?.trim()) return 'citation manquante'
  /**
   * Le minimum de 40 caracteres vise la PROSE d'un changelog : « nouvelle fonctionnalite » ne prouve
   * rien. Un candidat INTERNE prouve autrement — son ancrage `fichier:ligne` dit ou verifier, et la
   * citation est la ligne elle-meme. Or une ligne de code probante est souvent courte :
   * `const maintenant = Date.now()` fait 29 caracteres, et
   * une ligne d'enregistrement de canal IPC en fait 39. Appliquer le seuil de la prose a du code
   * refusait donc de vrais defauts pour un caractere manquant — constate sur le premier test de
   * bout en bout, avant que ce chemin ne serve.
   *
   * Le seuil interne reste NON NUL : une citation vide ne prouve rien, quelle que soit l'origine.
   */
  const minimum = ancrageInterne(brut.url.trim()) ? CITATION_MINIMUM_INTERNE : CITATION_MINIMUM
  if (brut.citation.trim().length < minimum) return 'citation trop courte'
  // Une nature ABSENTE est refusée plutôt que devinée : classer à la place du scout reviendrait à
  // décider d'après un titre, ce qui est exactement l'à-peu-près qu'on cherche à éviter.
  if (!brut.type?.trim()) return 'nature non precisee'
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
      ...(bornerPertinence(brut.pertinence) !== undefined
        ? { pertinence: bornerPertinence(brut.pertinence) }
        : {}),
      type: natureDe(brut.type),
      ...(brut.what?.trim() ? { what: brut.what.trim() } : {}),
      ...(brut.why?.trim() ? { why: brut.why.trim() } : {}),
      ...(brut.how?.trim() ? { how: brut.how.trim() } : {}),
      prompt: contexte.redigerPrompt(brut),
      vuLe: contexte.maintenant,
      statut: 'nouveau'
    })
  }

  return { retenus, refuses }
}
