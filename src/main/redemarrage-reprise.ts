import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * REPRISE APRES REDEMARRAGE — le chainon qui manquait.
 *
 * Un workflow qui exige un redemarrage de l'app (rechargement du process principal, dependance
 * native, variable d'environnement non rechargeable a chaud) coupait la tache en deux : l'app
 * repartait vierge et la consigne mourait avec l'ancien process. Le modele n'a AUCUNE memoire qui
 * survive au process — la consigne doit donc etre posee SUR LE DISQUE avant de tuer l'app, puis
 * consommee UNE SEULE FOIS au demarrage suivant.
 *
 * Trois proprietes non negociables :
 * - consommation destructive (le fichier est supprime a la lecture) : sinon un plantage au premier
 *   tour relancerait la meme consigne a chaque demarrage, en boucle.
 * - peremption : une consigne posee puis jamais reprise (l'utilisateur a ferme, la relance a
 *   echoue) ne doit pas resurgir trois jours plus tard dans une conversation devenue sans rapport.
 * - aucune execution ici : ce module ecrit et lit du texte, il ne redemarre rien.
 */
export interface RepriseEnAttente {
  /** La conversation ou la tache doit reprendre. */
  conversationId: string
  /** Le message renvoye a l'agent au demarrage, redige comme une consigne autonome. */
  consigne: string
  /** Pourquoi le redemarrage a ete demande — trace lisible, jamais interprete. */
  raison?: string
  /** Horodatage de la pose, pour la peremption. */
  poseeA: number
}

/** Au-dela, la consigne est consideree perimee et jetee sans etre rejouee. */
export const PEREMPTION_REPRISE_MS = 15 * 60 * 1000

export function cheminReprise(racineDonnees: string): string {
  return join(racineDonnees, 'redemarrage', 'reprise-en-attente.json')
}

export function poserReprise(
  racineDonnees: string,
  reprise: Omit<RepriseEnAttente, 'poseeA'> & { poseeA?: number }
): RepriseEnAttente {
  const conversationId = reprise.conversationId?.trim()
  const consigne = reprise.consigne?.trim()
  if (!conversationId) throw new Error('Reprise impossible : aucune conversation cible.')
  if (!consigne) throw new Error('Reprise impossible : aucune consigne à reprendre.')
  const payload: RepriseEnAttente = {
    conversationId,
    consigne,
    ...(reprise.raison?.trim() ? { raison: reprise.raison.trim() } : {}),
    poseeA: reprise.poseeA ?? Date.now()
  }
  const chemin = cheminReprise(racineDonnees)
  mkdirSync(dirname(chemin), { recursive: true })
  writeFileSync(chemin, JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

/**
 * Lit la consigne en attente ET la supprime, qu'elle soit valide ou non.
 *
 * La suppression precede toute decision de validite : un fichier corrompu qui resterait la
 * ferait echouer chaque demarrage suivant de la meme facon.
 */
export function consommerReprise(
  racineDonnees: string,
  maintenant: number = Date.now()
): RepriseEnAttente | null {
  const chemin = cheminReprise(racineDonnees)
  if (!existsSync(chemin)) return null
  let brut = ''
  try {
    brut = readFileSync(chemin, 'utf8')
  } finally {
    rmSync(chemin, { force: true })
  }
  let parse: unknown
  try {
    parse = JSON.parse(brut)
  } catch {
    return null
  }
  if (!parse || typeof parse !== 'object') return null
  const candidat = parse as Partial<RepriseEnAttente>
  if (typeof candidat.conversationId !== 'string' || !candidat.conversationId.trim()) return null
  if (typeof candidat.consigne !== 'string' || !candidat.consigne.trim()) return null
  const poseeA = typeof candidat.poseeA === 'number' ? candidat.poseeA : 0
  if (maintenant - poseeA > PEREMPTION_REPRISE_MS) return null
  return {
    conversationId: candidat.conversationId.trim(),
    consigne: candidat.consigne.trim(),
    ...(typeof candidat.raison === 'string' && candidat.raison.trim()
      ? { raison: candidat.raison.trim() }
      : {}),
    poseeA
  }
}
