/**
 * LE JOURNAL DES BESOINS — `besoins.jsonl` (carte des besoins, lot 2, conv-1089, 2026-10-22).
 *
 * Une ligne par TOUR DE CHAT, écrite à sa fin : qui a demandé, quand, dans quel fil, et ce que
 * l'agent a déclaré (`AUTOWIN_BESOIN_V1` : nouveau besoin, suite, ou pas un besoin).
 *
 * QUI A DEMANDÉ = QUI A PROMPTÉ, LU DANS GIT. Correction de l'utilisateur du 2026-10-22 : « le
 * requester, la source, c'est qui a prompté, et base-toi sur le git plutôt : les collaborateurs ne
 * sont pas tous sur Outlook ». L'identité est donc celle que git donne dans le dossier de travail du
 * fil (`user.name` / `user.email`, config locale du dépôt d'abord, globale sinon) AU MOMENT du tour :
 * c'est la même identité qui signera les commits de ce travail. Pas de Teams, pas d'Outlook.
 *
 * Journal en AJOUT SEUL : un tour repris après redémarrage ou une continuation réécrit une ligne pour
 * le MÊME message ; la lecture fusionne (le premier demandeur relevé, la dernière ligne de besoin).
 * Tout est FAIL-OPEN : un journal illisible ou un git absent ne touchent jamais la réponse.
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { lireLigneBesoin, type LigneBesoin } from '../shared/ligne-besoin'

export const FICHIER_JOURNAL_DES_BESOINS = 'besoins.jsonl'

export interface IdentiteGit {
  nom: string
  email?: string
}

/** Une ligne du journal. `v` permet de faire évoluer le format sans casser la relecture. */
export interface EvenementDuJournal {
  v: 1
  /** Heure d'écriture de la ligne. */
  ts: number
  conversationId: string
  /** Le message de l'utilisateur qui a lancé le tour. */
  messageId: string
  /** Heure de ce message (ms epoch). */
  demandeLe?: number
  turnId?: string
  /** `null` = git n'a rien rendu (pas de git, aucune identité configurée). */
  demandeur: (IdentiteGit & { dossier: string }) | null
  /** `null` = la réponse ne portait pas de ligne lisible. */
  besoin: LigneBesoin | null
}

/** Ce que la carte retient d'un message, toutes lignes fusionnées. */
export interface EntreeDuJournal {
  demandeur: (IdentiteGit & { dossier: string }) | null
  besoin: LigneBesoin | null
  demandeLe?: number
}

export function cleDuJournal(conversationId: string, messageId: string): string {
  return `${conversationId}\u0000${messageId}`
}

export type ExecGit = (args: readonly string[], dossier: string) => Promise<string>

const execGitParDefaut: ExecGit = (args, dossier) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      { cwd: dossier, timeout: 3_000, windowsHide: true, encoding: 'utf8' },
      (erreur, stdout) => (erreur ? reject(erreur) : resolve(String(stdout)))
    )
  })

/**
 * L'identité git d'un dossier, en UN seul appel. `git config` lit la config locale du dépôt puis la
 * globale : un dépôt où le collaborateur a posé son identité propre l'emporte sur son profil.
 * Un dossier disparu tombe sur la config globale (celle de la personne au poste).
 */
export async function identiteGitDuDossier(
  dossier: string | undefined,
  exec: ExecGit = execGitParDefaut,
  dossierExiste: (chemin: string) => boolean = existsSync
): Promise<IdentiteGit | null> {
  const cwd = dossier && dossierExiste(dossier) ? dossier : undefined
  let sortie: string
  try {
    sortie = await exec(
      cwd
        ? ['config', '--get-regexp', '^user\\.(name|email)$']
        : ['config', '--global', '--get-regexp', '^user\\.(name|email)$'],
      cwd ?? process.cwd()
    )
  } catch {
    // Code 1 = aucune clé : pas d'identité. Git absent : pareil. Jamais une exception vers le tour.
    return null
  }
  let nom: string | undefined
  let email: string | undefined
  for (const ligne of sortie.split(/\r?\n/u)) {
    const m = /^user\.(name|email)\s+(.+)$/iu.exec(ligne.trim())
    if (!m) continue
    // Plusieurs valeurs (globale puis locale) : git les liste dans cet ordre, la DERNIÈRE l'emporte.
    if (m[1].toLowerCase() === 'name') nom = m[2].trim()
    else email = m[2].trim()
  }
  if (!nom && !email) return null
  return { nom: nom ?? email ?? '', ...(email ? { email } : {}) }
}

/**
 * Identités gardées en mémoire quelques minutes : un tour ne doit pas payer un `git` à chaque fois.
 *
 * `servirLaPerimee` (le Board, conv-1248) : une valeur expirée est rendue tout de suite pendant que
 * la relecture tourne, pour la fois suivante. Sans cela, toute ouverture du Board plus de 5 min après
 * la précédente attendait ~30 `git config` (0,36 à 0,54 s mesurés). Le journal des tours ne s'en sert
 * pas : il relève l'identité DU tour, pas celle d'il y a 5 minutes.
 */
export function creerIdentitesEnCache(
  lire: (dossier: string | undefined) => Promise<IdentiteGit | null> = (dossier) =>
    identiteGitDuDossier(dossier),
  maintenant: () => number = Date.now,
  dureeMs = 5 * 60_000,
  servirLaPerimee = false
): (dossier: string | undefined) => Promise<IdentiteGit | null> {
  const cache = new Map<string, { a: number; identite: Promise<IdentiteGit | null> }>()
  return (dossier) => {
    const cle = dossier ?? ''
    const connue = cache.get(cle)
    if (connue && maintenant() - connue.a < dureeMs) return connue.identite
    if (connue && servirLaPerimee) {
      // Une relecture en échec garde l'ancienne valeur, au lieu de la remplacer par un rejet.
      cache.set(cle, { a: maintenant(), identite: lire(dossier).catch(() => connue.identite) })
      return connue.identite
    }
    const identite = lire(dossier)
    cache.set(cle, { a: maintenant(), identite })
    return identite
  }
}

interface MessageDuFil {
  role: string
  messageId?: string
  parentMessageId?: string
  turnId?: string
  ts?: number
  orientation?: boolean
}

/**
 * Le message de l'utilisateur qui porte un tour : on remonte la chaîne des parents depuis la réponse
 * du tour. Une continuation ou une reprise retombent ainsi sur la demande d'origine, pas sur rien.
 */
export function demandeDuTour(
  messages: readonly MessageDuFil[],
  turnId: string
): { messageId: string; ts?: number } | null {
  const parId = new Map<string, MessageDuFil>()
  for (const message of messages) if (message.messageId) parId.set(message.messageId, message)
  let courant = messages.find((message) => message.turnId === turnId)
  const vus = new Set<string>()
  while (courant?.parentMessageId && !vus.has(courant.parentMessageId)) {
    vus.add(courant.parentMessageId)
    const parent = parId.get(courant.parentMessageId)
    if (!parent) return null
    // Une consigne glissée PENDANT un tour n'est pas la demande : on continue de remonter.
    if (parent.role === 'user' && !parent.orientation && parent.messageId)
      return {
        messageId: parent.messageId,
        ...(typeof parent.ts === 'number' ? { ts: parent.ts } : {})
      }
    courant = parent
  }
  return null
}

export function ajouterAuJournal(chemin: string, evenement: EvenementDuJournal): void {
  mkdirSync(dirname(chemin), { recursive: true })
  appendFileSync(chemin, `${JSON.stringify(evenement)}\n`, 'utf8')
}

function estEvenement(valeur: unknown): valeur is EvenementDuJournal {
  if (!valeur || typeof valeur !== 'object') return false
  const e = valeur as Partial<EvenementDuJournal>
  return e.v === 1 && typeof e.conversationId === 'string' && typeof e.messageId === 'string'
}

/** Relit le journal ligne à ligne ; une ligne abîmée (écriture coupée) est sautée, pas fatale. */
export function lireLeJournal(texte: string): Map<string, EntreeDuJournal> {
  const entrees = new Map<string, EntreeDuJournal>()
  for (const ligne of texte.split('\n')) {
    if (!ligne.trim()) continue
    let valeur: unknown
    try {
      valeur = JSON.parse(ligne)
    } catch {
      continue
    }
    if (!estEvenement(valeur)) continue
    const cle = cleDuJournal(valeur.conversationId, valeur.messageId)
    const avant = entrees.get(cle)
    entrees.set(cle, {
      // Le demandeur relevé le PREMIER est celui du moment de la demande.
      demandeur: avant?.demandeur ?? valeur.demandeur ?? null,
      // Une reprise sans ligne de besoin n'efface pas celle qu'un tour précédent avait posée.
      besoin: valeur.besoin ?? avant?.besoin ?? null,
      ...((avant?.demandeLe ?? valeur.demandeLe) !== undefined
        ? { demandeLe: avant?.demandeLe ?? valeur.demandeLe }
        : {})
    })
  }
  return entrees
}

/**
 * Le journal d'un dossier de données : écrire un tour, relire tout (avec mémoire tant que le fichier
 * ne change ni de taille ni de date — la carte le relit à chaque ouverture).
 */
export function creerJournalDesBesoins(deps: {
  racine: string
  identite: (dossier: string | undefined) => Promise<IdentiteGit | null>
  maintenant?: () => number
}): {
  chemin: string
  noterTour: (tour: {
    conversationId: string
    turnId: string
    messages: readonly MessageDuFil[]
    dossier: string | undefined
    texteReponse: string | undefined
  }) => Promise<EvenementDuJournal | null>
  lire: () => Map<string, EntreeDuJournal>
} {
  const chemin = join(deps.racine, FICHIER_JOURNAL_DES_BESOINS)
  const maintenant = deps.maintenant ?? Date.now
  let memoire: { empreinte: string; entrees: Map<string, EntreeDuJournal> } | null = null

  return {
    chemin,
    async noterTour(tour) {
      const demande = demandeDuTour(tour.messages, tour.turnId)
      // Un tour sans message d'utilisateur retrouvable (fixture, fil supprimé) n'a rien à ranger.
      if (!demande) return null
      const identite = await deps.identite(tour.dossier)
      const evenement: EvenementDuJournal = {
        v: 1,
        ts: maintenant(),
        conversationId: tour.conversationId,
        messageId: demande.messageId,
        ...(demande.ts !== undefined ? { demandeLe: demande.ts } : {}),
        turnId: tour.turnId,
        demandeur: identite ? { ...identite, dossier: tour.dossier ?? '' } : null,
        besoin: lireLigneBesoin(tour.texteReponse)
      }
      ajouterAuJournal(chemin, evenement)
      return evenement
    },
    lire() {
      let empreinte: string
      try {
        const etat = statSync(chemin)
        empreinte = `${etat.size}:${etat.mtimeMs}`
      } catch {
        return new Map()
      }
      if (memoire?.empreinte === empreinte) return memoire.entrees
      const entrees = lireLeJournal(readFileSync(chemin, 'utf8'))
      memoire = { empreinte, entrees }
      return entrees
    }
  }
}
