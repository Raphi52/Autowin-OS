import type { Message } from '../providers/types'
import { estRelanceSansObjet } from '../../shared/relance-sans-objet'

/**
 * « GO », « OK », « VAS-Y » : la cible vient de l'historique, jointe par le code.
 *
 * Une relance sans objet n'est pas une demande vide : c'est l'accord pour exécuter la rubrique
 * « 👉 Recommandé » de la dernière clôture, ou, si le tour précédent est resté sans réponse, sa
 * demande. Une règle en prose le disait à chaque message (~1 100 caractères) pour un cas rare ; ce
 * bloc ne part que sur une relance reconnue (`estRelanceSansObjet`), et rien quand aucune cible n'est
 * lisible : mieux vaut aucune cible qu'une cible fabriquée.
 */
const RUBRIQUE_RECOMMANDE = /👉\s*\**\s*Recommand[ée]\s*\**\s*:?\s*\**/gu
/** Ce qui suit la rubrique sans en faire partie : ligne technique, autre rubrique, titre, bloc. */
const FIN_DE_RUBRIQUE = /^\s*(?:AUTOWIN_[A-Z_]+V1\b|#{1,6}\s|[✅📍⏳❓]|```)/u

/** Le texte de la DERNIÈRE rubrique « 👉 Recommandé » d'une réponse, sans son intitulé. */
export function recommandationDe(reponse: string): string | undefined {
  const rubrique = [...reponse.matchAll(RUBRIQUE_RECOMMANDE)].at(-1)
  if (!rubrique) return undefined
  const lignes: string[] = []
  for (const ligne of reponse.slice(rubrique.index + rubrique[0].length).split('\n')) {
    if (FIN_DE_RUBRIQUE.test(ligne) || (!ligne.trim() && lignes.length > 0)) break
    if (ligne.trim()) lignes.push(ligne.trim())
  }
  return lignes.join(' ') || undefined
}

/** Le bloc joint au message du tour, ou '' si le message nomme son objet ou si rien n'est lisible. */
export function blocRelanceSansCible(history: readonly Message[]): string {
  const dernier = history.at(-1)
  if (dernier?.role !== 'user' || !estRelanceSansObjet(dernier.content)) return ''
  const precedent = history.at(-2)
  const cible =
    precedent?.role === 'user'
      ? { d: 'la demande du tour précédent, resté sans réponse', texte: precedent.content.trim() }
      : precedent?.role === 'assistant'
        ? {
            d: 'la rubrique « 👉 Recommandé » de ta dernière réponse',
            texte: recommandationDe(precedent.content)
          }
        : undefined
  if (!cible?.texte) return ''
  return (
    `RELANCE SANS CIBLE — « ${dernier.content.trim()} » ne nomme pas son objet : c'est l'ordre ` +
    `d'exécuter ${cible.d}, telle quelle, sans autre action ni redemander la cible :\n${cible.texte}`
  )
}
