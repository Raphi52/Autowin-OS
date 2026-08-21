/**
 * Ce que les widgets Outlook affichent, en fonctions pures.
 *
 * La passerelle rend un instantané brut (messages et rendez-vous du profil local). Tout le sens est
 * construit ICI : qui est un interlocuteur, ce qui compte comme « cette semaine », ce qu'on montre
 * quand la semaine est vide. Hors React, pour que ces règles soient testables sans monter d'interface
 * ni dépendre d'une vraie boîte aux lettres — ce qui serait intestable sur une machine d'intégration.
 */

/** La forme rendue par `scripts/outlook-local-snapshot.ps1`. */
export interface OutlookRawMail {
  id: string
  adresse: string
  nom: string
  sujet: string
  /** ISO 8601, ou `null` quand Outlook n'a pas su la donner. */
  recuLe: string | null
  nonLu: boolean
  conversation: string
}

export interface OutlookRawEvent {
  id: string
  sujet: string
  lieu: string
  debut: string
  fin: string
  journeeEntiere: boolean
  recurrent: boolean
}

export interface OutlookSnapshot {
  ok: true
  luLe: string
  boite: string
  mailsNonLus: number
  mails: OutlookRawMail[]
  evenements: OutlookRawEvent[]
}

export interface OutlookFailure {
  ok: false
  erreur: string
}

export type OutlookResult = OutlookSnapshot | OutlookFailure

export interface Interlocuteur {
  /** Clé stable : l'adresse en minuscules, ou le nom affiché à défaut. */
  cle: string
  nom: string
  adresse: string
  /** Messages du fil, du plus récent au plus ancien. */
  messages: { id: string; sujet: string; recuLe: number | null; nonLu: boolean }[]
  nonLus: number
  /** Instant du message le plus récent, pour le classement. */
  dernierEchange: number
}

/**
 * Regroupe les messages par INTERLOCUTEUR.
 *
 * L'identité d'un interlocuteur est son ADRESSE, pas son nom affiché : le même correspondant écrit
 * sous « Jean Dupont » puis « DUPONT Jean », et deux fils pour une seule personne est exactement ce
 * que « trier comme une messagerie » doit éviter. Le nom retenu est celui du message le plus récent,
 * qui est le plus à jour.
 *
 * À défaut d'adresse (notification système, convocation), le nom affiché sert de clé : jeter ces
 * messages ferait disparaître des informations réelles sans le dire.
 */
export function groupByInterlocutor(mails: readonly OutlookRawMail[]): Interlocuteur[] {
  const fils = new Map<string, Interlocuteur>()

  for (const mail of mails) {
    const adresse = (mail.adresse ?? '').trim()
    const nom = (mail.nom ?? '').trim()
    const cle = (adresse || nom).toLowerCase()
    if (cle === '') continue
    const recu = mail.recuLe === null ? null : Date.parse(mail.recuLe)
    const instant = recu !== null && Number.isFinite(recu) ? recu : null

    const existant = fils.get(cle)
    const message = {
      id: mail.id,
      sujet: mail.sujet || '(sans objet)',
      recuLe: instant,
      nonLu: Boolean(mail.nonLu)
    }
    if (existant) {
      existant.messages.push(message)
      if (mail.nonLu) existant.nonLus += 1
      if (instant !== null && instant > existant.dernierEchange) {
        existant.dernierEchange = instant
        // Le nom suit le message le plus récent : c'est la graphie la plus à jour du contact.
        if (nom !== '') existant.nom = nom
      }
    } else {
      fils.set(cle, {
        cle,
        nom: nom || adresse || cle,
        adresse,
        messages: [message],
        nonLus: mail.nonLu ? 1 : 0,
        dernierEchange: instant ?? 0
      })
    }
  }

  for (const fil of fils.values()) {
    fil.messages.sort((a, b) => (b.recuLe ?? 0) - (a.recuLe ?? 0))
  }

  // Les fils qui ont du NON LU passent devant, quelle que soit leur date : trier par date seule
  // enterrerait un message jamais lu sous une pile de fils déjà traités.
  return [...fils.values()].sort((a, b) => {
    if ((a.nonLus > 0) !== (b.nonLus > 0)) return a.nonLus > 0 ? -1 : 1
    return b.dernierEchange - a.dernierEchange
  })
}

export function totalUnread(fils: readonly Interlocuteur[]): number {
  return fils.reduce((total, fil) => total + fil.nonLus, 0)
}

export interface AgendaEntry {
  id: string
  sujet: string
  lieu: string
  debut: number
  fin: number
  journeeEntiere: boolean
  /** `true` quand l'événement commence le jour de référence. */
  aujourdHui: boolean
}

export interface Agenda {
  /** Ce qui reste à venir aujourd'hui. */
  aujourdHui: AgendaEntry[]
  /** Les six jours suivants. */
  semaine: AgendaEntry[]
  /**
   * Le prochain rendez-vous AU-DELÀ de la semaine, et seulement quand la semaine est vide.
   *
   * Sans lui, un agenda simplement calme affiche un vide que l'utilisateur lit comme une panne — la
   * question « est-ce que ça marche ? » est ici plus coûteuse que la ligne qui y répond.
   */
  suivant: AgendaEntry | null
}

const JOUR_MS = 86_400_000

/** Découpe les rendez-vous en aujourd'hui / cette semaine / le prochain au-delà. */
export function splitAgenda(events: readonly OutlookRawEvent[], now: number): Agenda {
  const jour = new Date(now)
  const debutJour = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate()).getTime()
  const finJour = debutJour + JOUR_MS
  const finSemaine = debutJour + 7 * JOUR_MS

  const entries = events
    .map((event) => {
      const debut = Date.parse(event.debut)
      const fin = Date.parse(event.fin)
      if (!Number.isFinite(debut)) return null
      return {
        id: event.id,
        sujet: event.sujet || '(sans titre)',
        lieu: event.lieu ?? '',
        debut,
        fin: Number.isFinite(fin) ? fin : debut,
        journeeEntiere: Boolean(event.journeeEntiere),
        aujourdHui: debut >= debutJour && debut < finJour
      } satisfies AgendaEntry
    })
    .filter((entry): entry is AgendaEntry => entry !== null)
    .sort((a, b) => a.debut - b.debut)

  // Un rendez-vous EN COURS reste « aujourd'hui » : ce qui a commencé il y a dix minutes est
  // précisément ce qu'on veut voir, et le filtrer sur son début seul le ferait disparaître.
  const aujourdHui = entries.filter((entry) => entry.aujourdHui && entry.fin >= now)
  const semaine = entries.filter((entry) => entry.debut >= finJour && entry.debut < finSemaine)
  const suivant =
    aujourdHui.length === 0 && semaine.length === 0
      ? (entries.find((entry) => entry.debut >= finSemaine) ?? null)
      : null

  return { aujourdHui, semaine, suivant }
}

/** Étiquette d'heure d'un rendez-vous, ou « journée » pour un événement sur la journée entière. */
export function formatEventTime(entry: AgendaEntry): string {
  if (entry.journeeEntiere) return 'journée'
  return new Date(entry.debut).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** Jour lisible, pour les rendez-vous qui ne sont pas aujourd'hui. */
export function formatEventDay(entry: AgendaEntry): string {
  return new Date(entry.debut).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })
}

/** Date lisible du dernier échange d'un fil : l'heure aujourd'hui, le jour sinon. */
export function formatExchangeDate(instant: number | null, now: number): string {
  if (instant === null || instant === 0) return ''
  const jour = new Date(now)
  const debutJour = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate()).getTime()
  if (instant >= debutJour) {
    return new Date(instant).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }
  if (instant >= debutJour - JOUR_MS) return 'hier'
  if (instant >= debutJour - 6 * JOUR_MS) {
    return new Date(instant).toLocaleDateString('fr-FR', { weekday: 'short' })
  }
  return new Date(instant).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

/**
 * Valide ce que la passerelle a rendu.
 *
 * La frontière est ici : au-delà, le rendu suppose une forme. Un JSON tronqué, un champ manquant ou
 * un `ok: false` doivent tous devenir un ÉCHEC NOMMÉ — jamais une liste vide, qui se lirait comme
 * « vous n'avez pas de mail » alors qu'elle veut dire « la lecture a échoué ».
 */
export function parseOutlookResult(raw: unknown): OutlookResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, erreur: 'réponse illisible de la passerelle Outlook' }
  }
  const candidate = raw as Record<string, unknown>
  if (candidate.ok !== true) {
    const erreur = typeof candidate.erreur === 'string' ? candidate.erreur : 'cause inconnue'
    return { ok: false, erreur }
  }
  if (!Array.isArray(candidate.mails) || !Array.isArray(candidate.evenements)) {
    return { ok: false, erreur: 'réponse incomplète de la passerelle Outlook' }
  }
  return {
    ok: true,
    luLe: typeof candidate.luLe === 'string' ? candidate.luLe : '',
    boite: typeof candidate.boite === 'string' ? candidate.boite : '',
    mailsNonLus: typeof candidate.mailsNonLus === 'number' ? candidate.mailsNonLus : 0,
    mails: candidate.mails as OutlookRawMail[],
    evenements: candidate.evenements as OutlookRawEvent[]
  }
}
