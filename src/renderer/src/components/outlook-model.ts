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
  /**
   * L'objet de la DISCUSSION selon Outlook (`ConversationTopic`) : l'objet sans ses « RE: »/« TR: ».
   *
   * Mesuré le 2026-09-03 sur la boîte réelle : `conversation` (l'identifiant) est VIDE pour les 40
   * messages lus, alors que celui-ci est renseigné pour les 40. C'est donc lui qui porte le fil sur
   * ce profil ; l'identifiant reste prioritaire quand il existe, parce qu'il survit à un changement
   * d'objet en cours de discussion.
   */
  sujetConversation?: string
  /**
   * Le texte du message, tronque par le script de lecture.
   *
   * Optionnel : un instantane produit par une version anterieure du script n'en a pas, et l'absence
   * doit rester lisible comme « pas de corps lu » et non provoquer un ecran vide.
   */
  corps?: string
  /** `true` pour un message que l'utilisateur a ENVOYE. Sans lui, un fil n'a qu'un seul cote. */
  deMoi?: boolean
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
  /** Adresses auxquelles l'utilisateur a ecrit. `null` = information indisponible, pas « aucune ». */
  adressesEchangees: string[] | null
}

export interface OutlookFailure {
  ok: false
  erreur: string
}

export type OutlookResult = OutlookSnapshot | OutlookFailure

/**
 * UN message d'un fil, tel que l'affichage en a besoin.
 *
 * `auteur` est calcule ici et pas dans le rendu : c'est la meme regle pour la liste des fils et pour
 * la conversation deroulee, et deux copies de cette regle divergeraient.
 */
export interface MessageInterlocuteur {
  id: string
  sujet: string
  corps: string
  recuLe: number | null
  nonLu: boolean
  /** `true` quand c'est l'utilisateur qui a ecrit. */
  deMoi: boolean
  /** Qui parle, tel qu'on l'affiche : « moi » ou le nom du contact. */
  auteur: string
  /**
   * La clé du FIL auquel ce message appartient, déjà résolue.
   *
   * Calculée une fois ici, à l'endroit où l'on a encore les trois sources (identifiant, objet de
   * discussion, objet du message) : l'identifiant d'Outlook s'il existe, sinon l'objet de discussion
   * nettoyé, sinon l'objet du message nettoyé.
   */
  fil: string
}

export interface Interlocuteur {
  /**
   * `true` quand l'utilisateur a DEJA ECRIT a cette adresse.
   *
   * C'est ce qui distingue une personne d'un automate, et le critere n'est pas une liste noire de
   * domaines — elle serait fausse le jour ou un collegue ecrit depuis un domaine inattendu. Un
   * echange va dans les deux sens ; une notification, non. Releve du 2026-08-21 sur une vraie boite :
   * 23 emetteurs, 3 personnes.
   *
   * `null` = on n'a pas pu savoir (dossier Elements envoyes inaccessible). Ce n'est PAS « non ».
   */
  echange: boolean | null
  /** Clé stable : l'adresse en minuscules, ou le nom affiché à défaut. */
  cle: string
  nom: string
  adresse: string
  /**
   * Instant du message REÇU qui a donné le nom affiché. `-1` quand aucun message reçu ne l'a encore
   * fourni : le premier qui arrive prend alors la main sur le nom d'un envoi.
   */
  dernierNomRecu: number
  /** Messages du fil, du plus récent au plus ancien. */
  messages: MessageInterlocuteur[]
  nonLus: number
  /** Instant du message le plus récent, pour le classement. */
  dernierEchange: number
}

/**
 * Le nom d'un contact, débarrassé des apostrophes qu'Outlook ajoute autour d'une adresse.
 *
 * Mesuré le 2026-09-03 : un destinataire d'un message envoyé arrive sous la forme
 * `'raphael.vilain@amitel.fr'`. Ces apostrophes sont un artefact d'affichage d'Outlook, pas une
 * partie du nom, et elles se lisent comme une coquille dans la liste.
 */
function nettoyerNom(nom: string): string {
  const propre = nom.trim()
  if (propre.length >= 2 && propre.startsWith("'") && propre.endsWith("'")) {
    return propre.slice(1, -1).trim()
  }
  return propre
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
export function groupByInterlocutor(
  mails: readonly OutlookRawMail[],
  adressesEchangees?: readonly string[] | null
): Interlocuteur[] {
  // `undefined` ou `null` : on ne sait pas qui est une personne. On n'invente pas de reponse — tous
  // les fils restent au meme rang, ce qui est le comportement d'avant cette distinction.
  const connues =
    adressesEchangees === null || adressesEchangees === undefined
      ? null
      : new Set(adressesEchangees.map((adresse) => adresse.trim().toLowerCase()).filter(Boolean))
  const fils = new Map<string, Interlocuteur>()

  for (const mail of mails) {
    const adresse = (mail.adresse ?? '').trim()
    const nom = (mail.nom ?? '').trim()
    const cle = (adresse || nom).toLowerCase()
    if (cle === '') continue
    const recu = mail.recuLe === null ? null : Date.parse(mail.recuLe)
    const instant = recu !== null && Number.isFinite(recu) ? recu : null

    const existant = fils.get(cle)
    const deMoi = Boolean(mail.deMoi)
    const message: MessageInterlocuteur = {
      id: mail.id,
      sujet: mail.sujet || '(sans objet)',
      corps: (mail.corps ?? '').trim(),
      recuLe: instant,
      // Un message que l'utilisateur a lui-meme envoye n'est jamais « a lire » : le compter
      // gonflerait la pastille de non-lus avec ses propres envois.
      nonLu: !deMoi && Boolean(mail.nonLu),
      deMoi,
      auteur: deMoi ? 'moi' : nom || adresse || cle,
      fil: cleDeFil(mail)
    }
    if (existant) {
      existant.messages.push(message)
      if (message.nonLu) existant.nonLus += 1
      if (instant !== null && instant > existant.dernierEchange) {
        existant.dernierEchange = instant
      }
      // Le nom suit le message REÇU le plus récent : c'est la graphie la plus à jour du contact.
      //
      // Et JAMAIS un message envoyé. Mesuré le 2026-09-03 : côté Éléments envoyés, Outlook rend le
      // destinataire sous la forme « 'raphael.vilain@amitel.fr' », entre apostrophes. Laisser cette
      // graphie gagner parce qu'elle est la plus récente remplaçait « Raphaël VILAIN » par une
      // adresse entre guillemets dans la liste des interlocuteurs.
      if (!deMoi && nom !== '' && instant !== null && instant >= existant.dernierNomRecu) {
        existant.nom = nettoyerNom(nom)
        existant.dernierNomRecu = instant
      }
    } else {
      fils.set(cle, {
        cle,
        nom: nettoyerNom(nom) || adresse || cle,
        dernierNomRecu: deMoi ? -1 : (instant ?? 0),
        adresse,
        echange: connues === null ? null : connues.has(cle),
        messages: [message],
        nonLus: message.nonLu ? 1 : 0,
        dernierEchange: instant ?? 0
      })
    }
  }

  for (const fil of fils.values()) {
    fil.messages.sort((a, b) => (b.recuLe ?? 0) - (a.recuLe ?? 0))
  }

  // L'ordre, du plus fort au plus faible :
  //  1. une PERSONNE avant un automate — c'est la promesse du widget, « mes echanges » ;
  //  2. du NON LU avant du deja lu, quelle que soit la date : trier par date seule enterrerait un
  //     message jamais lu sous une pile de fils deja traites ;
  //  3. le plus recent.
  return [...fils.values()].sort((a, b) => {
    if (a.echange !== b.echange) {
      if (a.echange === true) return -1
      if (b.echange === true) return 1
    }
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
    evenements: candidate.evenements as OutlookRawEvent[],
    adressesEchangees: Array.isArray(candidate.adressesEchangees)
      ? (candidate.adressesEchangees as string[])
      : null
  }
}

/** Les vrais interlocuteurs, et le reste. Sert a separer les deux dans l'affichage. */
export function splitByExchange(fils: readonly Interlocuteur[]): {
  personnes: Interlocuteur[]
  automates: Interlocuteur[]
  /** `true` quand la distinction n'a pas pu etre faite : l'affichage ne doit alors pas la pretendre. */
  indistinct: boolean
} {
  const indistinct = fils.length > 0 && fils.every((fil) => fil.echange === null)
  if (indistinct) return { personnes: [...fils], automates: [], indistinct: true }
  return {
    personnes: fils.filter((fil) => fil.echange === true),
    automates: fils.filter((fil) => fil.echange !== true),
    indistinct: false
  }
}

/**
 * Les préfixes qu'une messagerie empile devant un objet : « RE: », « TR: », « Fwd: »…
 *
 * Ils s'accumulent (« RE: RE: TR: Devis ») et ils sont localisés — la même discussion porte donc
 * plusieurs objets différents. Sans ce nettoyage, un fil se scinderait à chaque réponse le jour où
 * Outlook ne donne pas d'identifiant de conversation.
 */
const PREFIXES_REPONSE = /^\s*(re|r[eé]f?|tr|fw|fwd|rép|rep|antw|aw|vs)\s*(\[\d+\])?\s*:\s*/i

/**
 * À quel FIL un message brut appartient.
 *
 * Trois sources, dans cet ordre : l'identifiant de conversation d'Outlook (le plus solide, il survit
 * à un changement d'objet), puis l'objet de discussion nettoyé, puis l'objet du message nettoyé.
 * Aucune n'est garantie : sur la boîte mesurée le 2026-09-03, la première est vide partout.
 */
export function cleDeFil(mail: OutlookRawMail): string {
  const id = (mail.conversation ?? '').trim()
  if (id !== '') return id
  const topic = normaliserSujet(mail.sujetConversation ?? '')
  if (topic !== '') return topic
  return normaliserSujet(mail.sujet ?? '')
}

/** L'objet d'un message, sans ses préfixes de réponse, en minuscules. Sert de clé de repli. */
export function normaliserSujet(sujet: string): string {
  let reste = (sujet ?? '').trim()
  // En boucle : les préfixes s'empilent, retirer le premier seulement laisserait « RE: Devis ».
  for (let garde = 0; garde < 10; garde++) {
    const court = reste.replace(PREFIXES_REPONSE, '')
    if (court === reste) break
    reste = court.trim()
  }
  return reste.toLowerCase()
}

/** Un fil de discussion avec UN interlocuteur : les messages d'une même conversation. */
export interface FilConversation {
  /** Clé stable : l'identifiant de conversation d'Outlook, ou l'objet normalisé à défaut. */
  cle: string
  /** L'objet du message le plus ANCIEN : c'est celui qui a nommé la discussion. */
  sujet: string
  /** Les messages, du plus ANCIEN au plus récent — on lit une discussion de haut en bas. */
  messages: MessageInterlocuteur[]
  nonLus: number
  /** Instant du message le plus récent, pour classer les fils entre eux. */
  dernierEchange: number
}

/**
 * Découpe les messages d'un interlocuteur en FILS de discussion.
 *
 * L'identité d'un fil est l'identifiant de conversation d'Outlook, parce que c'est lui qui survit à
 * un changement d'objet en cours de route. Quand il manque (message importé, notification), l'objet
 * nettoyé de ses « RE: » sert de repli : jeter ces messages ferait disparaître de vrais échanges.
 *
 * Le tri est INVERSE de celui de la liste des contacts, à dessein : entre les fils on cherche le plus
 * récent, mais DANS un fil on lit la discussion dans l'ordre où elle s'est tenue.
 */
export function groupThreads(fil: Interlocuteur): FilConversation[] {
  const fils = new Map<string, FilConversation>()
  for (const message of fil.messages) {
    const cle = message.fil
    const existant = fils.get(cle)
    if (existant) {
      existant.messages.push(message)
      if (message.nonLu) existant.nonLus += 1
      if ((message.recuLe ?? 0) > existant.dernierEchange) {
        existant.dernierEchange = message.recuLe ?? 0
      }
    } else {
      fils.set(cle, {
        cle,
        sujet: message.sujet,
        messages: [message],
        nonLus: message.nonLu ? 1 : 0,
        dernierEchange: message.recuLe ?? 0
      })
    }
  }
  for (const conversation of fils.values()) {
    conversation.messages.sort((a, b) => (a.recuLe ?? 0) - (b.recuLe ?? 0))
    // L'objet affiché est celui du premier message : « RE: RE: Devis » ne nomme pas une discussion.
    conversation.sujet = conversation.messages[0]?.sujet ?? conversation.sujet
  }
  return [...fils.values()].sort((a, b) => {
    if ((a.nonLus > 0) !== (b.nonLus > 0)) return a.nonLus > 0 ? -1 : 1
    return b.dernierEchange - a.dernierEchange
  })
}

/**
 * Les interlocuteurs classés PAR NOM.
 *
 * Un tri distinct de celui de `groupByInterlocutor`, qui classe par activité. La demande est ici une
 * liste « par nom » : on cherche quelqu'un qu'on connaît, on ne regarde pas ce qui vient d'arriver —
 * et une liste dont l'ordre change à chaque nouveau message ne se parcourt pas.
 */
export function sortByName(fils: readonly Interlocuteur[]): Interlocuteur[] {
  return [...fils].sort((a, b) =>
    a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base', numeric: true })
  )
}
