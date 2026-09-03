/**
 * Normalise les reponses d'une question `ask`.
 *
 * Contrat elargi le 20/08. L'ancien etait `options: string[]`, donc le libelle portait TOUT le
 * raisonnement — chemins de fichiers, parentheses, mises en garde — et le front ne pouvait etre
 * honnete : ni recommandation marquee, ni consequence, ni residu. Une reponse porte desormais un
 * libelle court et sa consequence. Les chaines nues restent acceptees : un modele qui emet
 * l'ancienne forme obtient un bloc degrade mais valide, jamais une erreur.
 *
 * Ce module ne DECIDE rien : il borne des longueurs et laisse tomber ce qui n'est pas exploitable.
 */

export interface ReponseAskDetail {
  fait?: string
  touche?: string
  neReglePas?: string
}

export interface ReponseAsk {
  libelle: string
  consequence?: string
  recommande?: true
  detail?: ReponseAskDetail
  envoi?: string
}

const PLAFOND_LIBELLE = 200
const PLAFOND_LIGNE = 400
const PLAFOND_REPONSES = 4

function borne(valeur: unknown, plafond: number): string | undefined {
  if (typeof valeur !== 'string') return undefined
  const propre = valeur.trim()
  if (!propre) return undefined
  return propre.slice(0, plafond)
}

function detail(valeur: unknown): ReponseAskDetail | undefined {
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return undefined
  const brut = valeur as Record<string, unknown>
  const fait = borne(brut.fait, PLAFOND_LIGNE)
  const touche = borne(brut.touche, PLAFOND_LIGNE)
  const neReglePas = borne(brut.neReglePas, PLAFOND_LIGNE)
  if (!fait && !touche && !neReglePas) return undefined
  return { ...(fait && { fait }), ...(touche && { touche }), ...(neReglePas && { neReglePas }) }
}

function reponse(valeur: unknown): ReponseAsk | null {
  if (typeof valeur === 'string') {
    const libelle = borne(valeur, PLAFOND_LIBELLE)
    return libelle ? { libelle } : null
  }
  if (!valeur || typeof valeur !== 'object' || Array.isArray(valeur)) return null
  const brut = valeur as Record<string, unknown>
  const libelle = borne(brut.libelle, PLAFOND_LIBELLE)
  if (!libelle) return null
  const consequence = borne(brut.consequence, PLAFOND_LIGNE)
  const envoi = borne(brut.envoi, PLAFOND_LIGNE)
  const detaille = detail(brut.detail)
  return {
    libelle,
    ...(consequence && { consequence }),
    ...(brut.recommande === true && { recommande: true as const }),
    ...(detaille && { detail: detaille }),
    ...(envoi && { envoi })
  }
}

/**
 * Les reponses exploitables, plafonnees a quatre. Deux « recommande » ne recommandent rien : la
 * premiere garde la marque, les suivantes la perdent — l'option reste, seule la marque tombe.
 */
/**
 * Vrai quand la question accepte PLUSIEURS reponses.
 *
 * Certaines questions ne sont pas un choix exclusif : « lesquels de ces correctifs veux-tu ? ». Les
 * cocher une par une et envoyer d'un coup evite quatre tours de conversation. Le drapeau est
 * DECLARE par le modele, jamais devine a partir du libelle des options.
 */
export function choixMultipleDemande(brut: unknown): boolean {
  return brut === true
}

export function normaliserReponsesAsk(brut: unknown): ReponseAsk[] {
  const reponses = (Array.isArray(brut) ? brut : [])
    .map(reponse)
    .filter((option): option is ReponseAsk => option !== null)
    .slice(0, PLAFOND_REPONSES)
  let dejaRecommandee = false
  return reponses.map((option) => {
    if (!option.recommande) return option
    if (dejaRecommandee) {
      // On retire la marque sans jeter l'option : ce qui tombe, c'est la recommandation en double.
      const sansMarque: ReponseAsk = { libelle: option.libelle }
      if (option.consequence) sansMarque.consequence = option.consequence
      if (option.detail) sansMarque.detail = option.detail
      if (option.envoi) sansMarque.envoi = option.envoi
      return sansMarque
    }
    dejaRecommandee = true
    return option
  })
}
