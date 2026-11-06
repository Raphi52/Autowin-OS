import type { ConversationStateKey } from './chat-view-model'
import type { Conv } from './chat-view-types'
import { etatDuFil } from './lots-dans-la-liste'

/**
 * LE SIGNE D'UNE SUPER CONV DANS LA LISTE DE GAUCHE (2026-10-31, /draft « un signe
 * distinctif pour les super convs dans la liste de gauche », proposition retenue « 6 · Raccourci »).
 *
 * Les lots n'ont plus de ligne : rien ne distinguait un fil chef d'un fil seul. La
 * ligne d'un chef porte donc une pile sous elle, une jauge fine (un segment par lot du plan qu'il
 * montre), le compte des lots finis, et un raccourci « N ? » vers le premier lot qui attend ta
 * réponse.
 *
 * L'état d'un lot est lu sur SON fil, par `etatDuFil` : la règle qui allume déjà le spinner et la
 * question du chef (`activiteDesLots`). Un lot sans fil ouvert est « à faire ».
 *
 * Le signe voyage en CHAÎNE (`lettres|rang|fil`) : la ligne de liste est mémorisée (`memo`), et
 * `convs` est refait à chaque rafraîchissement ; une chaîne égale ne la redessine pas.
 */

export type EtatDuSegment = 'fini' | 'cours' | 'question' | 'echec' | 'arret' | 'afaire'

export interface SigneSuperConv {
  /** Un segment par lot du plan montré, par rang. Vide si ce plan n'a encore aucun fil ouvert. */
  segments: EtatDuSegment[]
  finis: number
  total: number
  /** Le premier lot, par rang, qui attend ta réponse. */
  question?: { rang: number; fil: string }
}

const LETTRES: Record<EtatDuSegment, string> = {
  fini: 'f',
  cours: 'c',
  question: 'q',
  echec: 'e',
  arret: 'a',
  afaire: 'x'
}
const ETAT_DE_LA_LETTRE = new Map(
  Object.entries(LETTRES).map(([etat, lettre]) => [lettre, etat as EtatDuSegment])
)

const SEGMENT_DE_L_ETAT: Record<ConversationStateKey, EtatDuSegment> = {
  running: 'cours',
  asking: 'question',
  completed: 'fini',
  unread: 'fini',
  failed: 'echec',
  interrupted: 'arret',
  cancelled: 'arret',
  // Dernier message de l'utilisateur, sans réponse et sans tour qui tourne : le lot est à l'arrêt.
  waiting: 'arret',
  empty: 'afaire'
}

interface LienVersLeChef {
  chef: string
  rang: number
  total: number
  /** Le lot appartient au plan que montre son chef. */
  onglet: boolean
}

/**
 * Pur : chef → son signe encodé. Tout chef d'un plan en a un, même quand le plan qu'il montre n'a
 * encore aucun fil (chaîne vide : la pile seule).
 */
export function signesDesSuperConvs(
  convs: readonly Conv[],
  liens: ReadonlyMap<string, LienVersLeChef>,
  occupes: ReadonlySet<string>
): Map<string, string> {
  const parId = new Map(convs.map((c) => [c.id, c]))
  const lotsDuChef = new Map<string, Array<{ fil: string; rang: number; total: number }>>()
  for (const [fil, lien] of liens) {
    const lots = lotsDuChef.get(lien.chef) ?? []
    if (lien.onglet) lots.push({ fil, rang: lien.rang, total: lien.total })
    lotsDuChef.set(lien.chef, lots)
  }
  const signes = new Map<string, string>()
  for (const [chef, lots] of lotsDuChef) {
    const total = Math.max(0, ...lots.map((lot) => lot.total))
    const parRang = new Map(lots.map((lot) => [lot.rang, lot.fil]))
    let lettres = ''
    let question = ''
    for (let rang = 1; rang <= total; rang += 1) {
      const fil = parRang.get(rang)
      const c = fil ? parId.get(fil) : undefined
      const etat = c ? SEGMENT_DE_L_ETAT[etatDuFil(c, occupes.has(c.id), false).key] : 'afaire'
      lettres += LETTRES[etat]
      if (etat === 'question' && !question && fil) question = `|${rang}|${fil}`
    }
    signes.set(chef, lettres + question)
  }
  return signes
}

/** Pur : le signe décodé. */
export function lireSigneSuperConv(code: string): SigneSuperConv {
  const [lettres = '', rang, fil] = code.split('|')
  const segments = [...lettres].map((lettre) => ETAT_DE_LA_LETTRE.get(lettre) ?? 'afaire')
  const rangDeLaQuestion = Number(rang)
  return {
    segments,
    finis: segments.filter((etat) => etat === 'fini').length,
    total: segments.length,
    ...(fil && Number.isInteger(rangDeLaQuestion) && rangDeLaQuestion > 0
      ? { question: { rang: rangDeLaQuestion, fil } }
      : {})
  }
}
