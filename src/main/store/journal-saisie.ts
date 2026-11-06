import { appendFileSync, closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs'
import { appendFile, open, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app/app-data'

/**
 * JOURNAL DES SAISIES — le filet de sécurité du texte tapé par l'utilisateur.
 *
 * Mesure du 2026-09-01 : l'utilisateur a écrit deux messages qui ont disparu de l'écran
 * sans laisser la moindre trace. Les quatre sources de persistance (conversations.json, son journal,
 * causal-trace, prompt-observability) étaient vides. La cause : tant qu'un texte n'a pas produit un
 * TOUR, il ne vit que dans la mémoire volatile du renderer — brouillon du composer
 * (`composerDraftsRef`), file d'attente (`queueRef`) et reçus d'orientation (`directiveReceipts`)
 * sont tous des refs ou des états React, jamais écrits sur disque. Un rechargement de fenêtre, un
 * changement de conversation ou une injection refusée effaçait donc le texte définitivement.
 *
 * Ce journal casse cette classe entière de pertes : le texte est écrit AU MOMENT où il quitte le
 * composer, quelle que soit la voie qu'il emprunte ensuite et quel que soit son sort. Il ne remplace
 * aucune persistance existante — c'est une trace de dernier recours, pas une source de vérité.
 *
 * INVARIANT NON NÉGOCIABLE : écrire ici ne doit JAMAIS empêcher un message de partir. Un disque
 * plein ou un dossier en lecture seule ferait perdre la trace, pas le message — l'inverse serait
 * pire que le défaut qu'on corrige.
 */

/**
 * Par où le texte est parti — deux voies, et deux seulement, parce qu'un texte ne peut quitter le
 * composer que par l'une d'elles. Le distinguer explique POURQUOI une trace n'a pas de tour.
 *
 * La mise en file n'est PAS une troisième voie : elle n'existe que comme repli d'une orientation
 * refusée, déjà journalisée. Lui donner sa propre ligne écrirait deux entrées pour un seul texte —
 * exactement le bruit qui fait douter au moment où l'on cherche à récupérer quelque chose.
 */
export type VoieDeSaisie =
  /** Envoi ordinaire : un tour va être créé, le texte finira dans la conversation. */
  | 'message'
  /** Tapé pendant un tour en cours : ne créera JAMAIS de tour à lui, donc invisible dans l'historique. */
  | 'orientation'

/**
 * QUI a fait partir le texte, quand ce n'est pas l'utilisateur. Absent = tapé (ou cliqué) par lui.
 *
 * Mesure (2026-10-06) : la saisie ts 1791317725882, envoyée SEULE par le mode auto, et la
 * saisie TAPÉE ts 1791317691042 étaient deux lignes `voie: "message"` identiques. L'utilisateur
 * affirmait « il était pas coché » : ce journal ne permettait pas de trancher.
 */
export type OrigineDeSaisie = 'mode-auto'

export interface SaisieUtilisateur {
  conversationId: string
  texte: string
  voie: VoieDeSaisie
  origine?: OrigineDeSaisie
}

export interface SaisieJournalisee extends SaisieUtilisateur {
  schema: 'autowin.saisie/v1'
  ts: number
}

/**
 * RATTACHEMENT D'UNE SAISIE A SON TOUR.
 *
 * La saisie est ecrite AVANT que le tour existe — c'est tout l'interet du filet (un texte qui ne
 * produit jamais de tour reste retrouvable). Elle ne peut donc PAS porter `turnId` a l'ecriture.
 * Le lien est pose APRES, quand le controleur de chat cree le tour, par une ligne SUPPLEMENTAIRE :
 * le journal reste strictement en ajout (aucune reecriture, aucun risque de perdre une ligne sur
 * une ecriture concurrente) et la forme des lignes deja ecrites ne bouge pas.
 */
export interface RattachementDeSaisie {
  schema: 'autowin.saisie-tour/v1'
  ts: number
  conversationId: string
  turnId: string
  /** Horodatage de la saisie rattachee — la cle de jointure, exacte et non approximative. */
  saisieTs: number
}

export function journalSaisiePath(racine?: string): string {
  return join(racine ?? ensureAutowinAppData(), 'saisies-utilisateur.jsonl')
}

/**
 * Écrit la saisie et rend `true` si la trace est bien sur le disque.
 *
 * Rend `false` au lieu de lever : l'appelant est sur le chemin d'envoi d'un message, et aucune
 * défaillance d'écriture ne doit y remonter comme une erreur d'envoi (voir l'invariant ci-dessus).
 */
export function journaliserSaisie(saisie: SaisieUtilisateur, racine?: string): boolean {
  const texte = saisie.texte
  // Un texte vide n'a jamais été perdu : ne pas polluer le journal avec des lignes sans contenu.
  if (!texte.trim()) return false
  const enregistrement: SaisieJournalisee = {
    schema: 'autowin.saisie/v1',
    ts: Date.now(),
    conversationId: saisie.conversationId,
    texte,
    voie: saisie.voie,
    ...(saisie.origine === 'mode-auto' ? { origine: saisie.origine } : {})
  }
  try {
    appendFileSync(journalSaisiePath(racine), `${JSON.stringify(enregistrement)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Relit les saisies d'UNE conversation. Aucun lecteur n'existait : le texte tapé pendant un tour
 * (voie `orientation`) était écrit puis jamais consulté, alors que c'est là que vit la correction
 * donnée en cours de route — la matière même d'une rétrospective.
 *
 * Rend une liste vide sur toute défaillance : ce journal est une trace de dernier recours, le lire
 * ne doit jamais faire échouer l'appelant.
 */
const SEPARATEUR_LIGNE = /\r?\n/

type EntreeJournal = SaisieJournalisee | RattachementDeSaisie

/**
 * LECTURE INCRÉMENTALE (2026-10-22). Le journal (2,64 Mo le 22/10) était relu EN ENTIER,
 * de façon synchrone sur le fil principal, à chaque message (`rattacherSaisieAuTour`), à chaque
 * ouverture de fil (`lireOrientationsRattachees`) et par le dossier kaizen. Disque lent : 7 gels pour
 * 56,2 s, plus 4 lectures pour 26,7 s côté orientations (gels.jsonl). Le fichier n'est QU'EN AJOUT :
 * on garde ses lignes en mémoire par conversation et on ne lit que les octets ajoutés depuis.
 * Un fichier plus court, ou dont l'en-tête a changé, a été réécrit : il est relu depuis le début.
 * fix-ok: cause mesurée 2026-10-22 — relecture complète : 310 864 octets relus pour une ligne de 371, 932 845 pour les trois lecteurs (test rouge).
 */
interface IndexJournal {
  /** Octets déjà lus, jusqu'à la dernière fin de ligne : une ligne en cours d'écriture attend. */
  octets: number
  /** Premiers octets du fichier : s'ils changent, le fichier a été réécrit. */
  entete: string
  parConversation: Map<string, EntreeJournal[]>
}
const TAILLE_ENTETE = 256
const indexParChemin = new Map<string, IndexJournal>()

function lireOctets(fd: number, debut: number, longueur: number): Buffer {
  const tampon = Buffer.alloc(longueur)
  let lus = 0
  while (lus < longueur) {
    const n = readSync(fd, tampon, lus, longueur - lus, debut + lus)
    if (n === 0) break
    lus += n
  }
  return tampon.subarray(0, lus)
}

/** Range des octets neufs dans l'index. Aucune lecture ici : les deux chemins la partagent. */
function integrer(index: IndexJournal, neuf: Buffer): void {
  const fin = neuf.lastIndexOf(0x0a)
  if (fin < 0) return
  for (const ligne of neuf.subarray(0, fin).toString('utf8').split(SEPARATEUR_LIGNE)) {
    if (!ligne.trim()) continue
    try {
      const entree = JSON.parse(ligne) as EntreeJournal
      if (typeof entree?.conversationId !== 'string') continue
      const liste = index.parConversation.get(entree.conversationId)
      if (liste) liste.push(entree)
      else index.parConversation.set(entree.conversationId, [entree])
    } catch {
      /* ligne illisible : ignoree, comme partout dans ce journal */
    }
  }
  if (index.octets === 0)
    index.entete = neuf.subarray(0, Math.min(TAILLE_ENTETE, fin + 1)).toString('latin1')
  index.octets += fin + 1
}

/**
 * Lignes de CETTE conversation, dans l'ordre du fichier. Lève sur une erreur disque.
 *
 * Chemin BLOQUANT, gardé pour le seul dossier /kaizen, qui se construit d'un bloc et à la demande.
 * Tout ce qui sert l'interface passe par `entreesDuJournalAsync`.
 */
function entreesDuJournal(conversationId: string, racine?: string): readonly EntreeJournal[] {
  const chemin = journalSaisiePath(racine)
  if (!existsSync(chemin)) {
    indexParChemin.delete(chemin)
    return []
  }
  const fd = openSync(chemin, 'r')
  try {
    const taille = fstatSync(fd).size
    let index = indexParChemin.get(chemin)
    if (
      index &&
      (taille < index.octets ||
        lireOctets(fd, 0, index.entete.length).toString('latin1') !== index.entete)
    )
      index = undefined
    if (!index) {
      index = { octets: 0, entete: '', parConversation: new Map() }
      indexParChemin.set(chemin, index)
    }
    if (taille > index.octets) integrer(index, lireOctets(fd, index.octets, taille - index.octets))
    return index.parConversation.get(conversationId) ?? []
  } finally {
    closeSync(fd)
  }
}

async function lireOctetsAsync(
  fichier: FileHandle,
  debut: number,
  longueur: number
): Promise<Buffer> {
  const tampon = Buffer.alloc(longueur)
  let lus = 0
  while (lus < longueur) {
    const { bytesRead } = await fichier.read(tampon, lus, longueur - lus, debut + lus)
    if (bytesRead === 0) break
    lus += bytesRead
  }
  return tampon.subarray(0, lus)
}

/**
 * LE MÊME INDEX, SANS TENIR LE FIL PRINCIPAL (2026-10-31). La lecture incrémentale
 * avait réduit le VOLUME, pas le risque : `openSync` seul a encore figé la fenêtre 45,6 s
 * en 7 jours (`gels.jsonl`), dont 9,9 s d'un coup sur 3 Mo, parce que l'appel attendait au-dessus du
 * disque (SSD à 420 ms au pire sur 675 relevés Windows). Seule la sortie du fil protège la fenêtre.
 *
 * Des lectures peuvent désormais se croiser : l'intégration, elle, reste d'un seul tenant (aucun
 * `await` dedans). Celle qui arrive après une autre ne relit que ce qu'il reste, sinon ses lignes
 * seraient comptées deux fois.
 */
async function entreesDuJournalAsync(
  conversationId: string,
  racine?: string
): Promise<readonly EntreeJournal[]> {
  const chemin = journalSaisiePath(racine)
  let fichier: FileHandle
  try {
    fichier = await open(chemin, 'r')
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code !== 'ENOENT') throw erreur
    indexParChemin.delete(chemin)
    return []
  }
  try {
    const taille = (await fichier.stat()).size
    let index = indexParChemin.get(chemin)
    if (
      index &&
      (taille < index.octets ||
        (await lireOctetsAsync(fichier, 0, index.entete.length)).toString('latin1') !== index.entete)
    )
      index = undefined
    if (!index) {
      index = { octets: 0, entete: '', parConversation: new Map() }
      indexParChemin.set(chemin, index)
    }
    let debut = index.octets
    while (taille > debut) {
      const neuf = await lireOctetsAsync(fichier, debut, taille - debut)
      if (index.octets === debut) {
        integrer(index, neuf)
        break
      }
      debut = index.octets
    }
    return index.parConversation.get(conversationId) ?? []
  } finally {
    await fichier.close()
  }
}

const estSaisie = (entree: EntreeJournal): entree is SaisieJournalisee =>
  entree.schema === 'autowin.saisie/v1'

export function lireSaisies(
  conversationId: string,
  racine?: string,
  limite = 30
): SaisieJournalisee[] {
  try {
    // Filtre STRICT sur la conversation ciblée (fait par l'index) : un dossier de preuve ne doit
    // jamais emporter le texte tapé dans une autre conversation.
    // Filtre STRICT sur le schéma : les lignes de RATTACHEMENT partagent le fichier et la
    // conversation, mais ne portent aucun texte — les rendre ici polluerait tout lecteur.
    return entreesDuJournal(conversationId, racine).filter(estSaisie).slice(-limite)
  } catch {
    return []
  }
}

/**
 * Pose le lien saisie → tour. Rend `false` si aucune saisie de cette conversation ne porte
 * EXACTEMENT ce texte : sans correspondance, un lien serait un alibi, pas une preuve.
 *
 * Best-effort comme le reste du journal : jamais d'exception vers le chemin d'un tour.
 */
export async function rattacherSaisieAuTour(
  conversationId: string,
  turnId: string,
  texte: string,
  racine?: string
): Promise<boolean> {
  try {
    const attendu = texte.trim()
    if (!attendu) return false
    const candidates = (await entreesDuJournalAsync(conversationId, racine))
      .filter(estSaisie)
      .slice(-200)
    let cible: SaisieJournalisee | undefined
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (candidates[i]?.texte.trim() === attendu) {
        cible = candidates[i]
        break
      }
    }
    if (!cible) return false
    const lien: RattachementDeSaisie = {
      schema: 'autowin.saisie-tour/v1',
      ts: Date.now(),
      conversationId,
      turnId,
      saisieTs: cible.ts
    }
    await appendFile(journalSaisiePath(racine), `${JSON.stringify(lien)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/** Rend le texte qui a produit CE tour, ou `undefined` si aucun lien n'a ete pose. */
export function saisieDuTour(
  conversationId: string,
  turnId: string,
  racine?: string
): SaisieJournalisee | undefined {
  try {
    let saisieTs: number | undefined
    const saisies: SaisieJournalisee[] = []
    for (const entree of entreesDuJournal(conversationId, racine)) {
      if (entree.schema === 'autowin.saisie-tour/v1' && entree.turnId === turnId)
        saisieTs = entree.saisieTs
      else if (entree.schema === 'autowin.saisie/v1') saisies.push(entree)
    }
    if (saisieTs === undefined) return undefined
    return saisies.find((saisie) => saisie.ts === saisieTs)
  } catch {
    return undefined
  }
}

/** Une consigne donnee PENDANT un tour, rendue avec le tour qu'elle a inflechi. */
export interface OrientationRattachee {
  /** Horodatage de la saisie : la cle de jointure, exacte et non approximative. */
  ts: number
  texte: string
  /** Le tour infléchi. `undefined` = aucun lien n'a été posé (le tour n'a jamais démarré). */
  turnId?: string
}

/**
 * LES CONSIGNES DONNEES PENDANT UN TOUR, RELUES POUR LE FIL.
 *
 * Mesure du 2026-09-12 sur `saisies-utilisateur.jsonl` : 101 saisies de voie `orientation` et 1 563
 * rattachements saisie -> tour. La donnee est complete et datee, mais cote ecran ces consignes ne
 * vivaient que dans un etat React : changer de conversation ou recharger les effaçait, alors
 * qu'elles portent la correction donnee en cours de route. Seul le contexte kaizen les relisait.
 *
 * Rend une liste vide sur toute defaillance : ce journal est une trace de dernier recours, le lire
 * ne doit jamais faire echouer l'appelant.
 */
export async function lireOrientationsRattachees(
  conversationId: string,
  racine?: string,
  limite = 50
): Promise<OrientationRattachee[]> {
  try {
    const orientations: OrientationRattachee[] = []
    // Le rattachement est ecrit APRES la saisie, dans une ligne SUPPLEMENTAIRE : on collecte donc
    // les deux formes en un seul passage, puis on joint par `saisieTs`.
    const tourParSaisie = new Map<number, string>()
    for (const entree of await entreesDuJournalAsync(conversationId, racine)) {
      if (entree.schema === 'autowin.saisie-tour/v1')
        tourParSaisie.set(entree.saisieTs, entree.turnId)
      else if (entree.schema === 'autowin.saisie/v1' && entree.voie === 'orientation')
        orientations.push({ ts: entree.ts, texte: entree.texte })
    }
    return orientations.slice(-limite).map((orientation) => {
      const turnId = tourParSaisie.get(orientation.ts)
      return turnId ? { ...orientation, turnId } : orientation
    })
  } catch {
    return []
  }
}
