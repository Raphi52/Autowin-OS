/**
 * LE CANAL DE LA CARTE DES BESOINS (conv-1089, 2026-10-22) — lecture seule, aucun appel de modèle.
 *
 * La vue demande la carte ; le processus principal la calcule à partir des fils qu'il a déjà en
 * mémoire et des runs du scan borné de `get_state` (`runsWithGate`), puis ne renvoie que la
 * projection (~1,5 Mo mesurés pour 4 795 demandes), jamais l'historique.
 *
 * Lot 2 : il relit aussi `besoins.jsonl` (qui a prompté, ligne de besoin) et, pour les demandes
 * antérieures au journal, l'identité git actuelle du dossier de chaque fil.
 *
 * Work items (conv-1127, 2026-10-23) : trois canaux de plus, pour lier un prompt à une task.
 * `os:carte:lierWorkItem` et `os:carte:delierWorkItem` écrivent dans `liens-work-items.jsonl`, sur ce
 * poste ; `os:carte:verifierMentions` lit les fiches que des prompts nomment (`#1234`). Les trois ne
 * reçoivent du fournisseur de tickets que sa LECTURE (`get`) : aucune écriture chez lui n'est
 * possible d'ici. Le calcul de la carte, lui, ne lit que le fichier — jamais le réseau.
 *
 * Dossier du Board (conv-1206, 2026-10-28) : `os:carteDesBesoins` reçoit en plus les états posés à
 * la main (rangés dans la vue) et, si un dossier est choisi sur ce poste, y recopie le Board SANS
 * attendre (`board-dossier.ts`). Trois canaux le règlent : `os:board-dossier` (lecture),
 * `…:choisir` (sélecteur natif, aucun chemin reçu de la vue) et `…:effacer`.
 *
 * Collègues et fin de tour (conv-1210, 2026-10-28) : `os:board-collegues` rend les Boards que les
 * AUTRES postes ont écrits dans le même dossier (`board-collegues.ts`), et `recopierLeBoard`,
 * rendu à `index.ts`, recopie le Board à chaque fin de tour, vue fermée.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { creerCalculateurDeCarte, type ConversationPourLaCarte } from '../carte-des-besoins'
import { creerIdentitesEnCache, type EntreeDuJournal } from '../journal-des-besoins'
import {
  creerLiensWorkItems,
  detacher,
  etatVide,
  rattacherALaMain,
  verifierLesMentions,
  type EtatDesLiens
} from '../liens-work-items'
import type { BilanDesMentions, ResultatDuRattachement } from '../../shared/carte-des-besoins'
import { etatManuelLisible, type EtatManuelDuBoard } from '../../shared/board-dossier'
import type { DossierDuBoard } from '../board-dossier'
import { creerLecteurDesCollegues } from '../board-collegues'
import { creerCopieDeFinDeTour } from '../board-copie-fin-de-tour'
import { projetsPartagesLisibles } from '../../shared/board-projets-partages'
import {
  carteDesDossiersDuChat,
  dossiersDuBoard,
  dossiersDuChatLisibles
} from '../../shared/board-dossiers-du-chat'
import { creerDossiersDuChat } from '../board-dossiers-du-chat'
import type { CarteDesBesoins } from '../../shared/carte-des-besoins'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import type { BoardsDesCollegues } from '../../shared/board-collegues'
import type { TicketItem, TicketSourceProfile } from '../../shared/tickets'
import type { TicketGetRequest } from '../ticket-providers/provider-contract'
import type { AutowinOS } from '../os'

/** La lecture des fiches, et elle seule : le type n'offre aucune écriture chez le fournisseur. */
export interface LectureDesTickets {
  listSources: () => readonly TicketSourceProfile[]
  get: (request: TicketGetRequest) => Promise<TicketItem>
}

const BILAN_VIDE: BilanDesMentions = {
  lues: 0,
  liees: 0,
  introuvables: 0,
  injoignable: false,
  restantes: 0
}

/** La demande nommée par la vue existe-t-elle vraiment dans ce fil ? (id de message, ou `rang:N`) */
function demandeExiste(
  conversations: readonly ConversationPourLaCarte[],
  conversationId: unknown,
  demande: unknown
): boolean {
  if (typeof conversationId !== 'string' || typeof demande !== 'string') return false
  const fil = conversations.find((c) => c.id === conversationId)
  if (!fil) return false
  const rang = /^rang:(\d+)$/.exec(demande)
  if (rang) return fil.messages[Number(rang[1])]?.role === 'user'
  return fil.messages.some((m) => m.role === 'user' && m.messageId === demande)
}

const objet = (valeur: unknown): Record<string, unknown> =>
  valeur && typeof valeur === 'object' && !Array.isArray(valeur)
    ? (valeur as Record<string, unknown>)
    : {}

/** Plafond des états manuels relus : un par fil, bien au-delà du nombre de fils d'un poste. */
const ETATS_MANUELS_MAX = 20_000

/** Les états posés à la main que la vue joint au calcul : seuls les bien formés passent. */
function etatsManuelsLisibles(valeur: unknown): Record<string, EtatManuelDuBoard> {
  const lus: Record<string, EtatManuelDuBoard> = {}
  let n = 0
  for (const [id, brut] of Object.entries(objet(valeur))) {
    if (n >= ETATS_MANUELS_MAX) break
    if (!/^[\w.-]{1,80}$/.test(id)) continue
    const etat = etatManuelLisible(brut)
    if (etat) {
      lus[id] = etat
      n += 1
    }
  }
  return lus
}

export function registerCarteDesBesoinsIpc({
  os,
  journal,
  racineDesLiens,
  tickets,
  dossierDuBoard,
  choisirDossier,
  racineDuPoste
}: {
  os: Pick<AutowinOS, 'conversations' | 'runsWithGate' | 'executionWorkspace'>
  journal?: { lire: () => ReadonlyMap<string, EntreeDuJournal> }
  /** Dossier de `liens-work-items.jsonl` (conv-1127) ; absent = aucun lien gardé. */
  racineDesLiens?: string
  tickets?: LectureDesTickets
  /** Le dossier où le Board est recopié (conv-1206) ; absent = aucune copie. */
  dossierDuBoard?: DossierDuBoard
  /** Le sélecteur de dossier natif (`pickDirectory` de `index.ts`). */
  choisirDossier?: (sender: Electron.WebContents) => Promise<string | null>
  /** Dossier de données du poste, où la copie de fin de tour garde les états posés à la main
   *  (`board-etats-manuels.json`, conv-1210) ; absent = aucune copie de fin de tour. */
  racineDuPoste?: string
}): {
  /** Recopie le Board vers le dossier sans la vue (conv-1210) : appelée à chaque fin de tour. */
  recopierLeBoard: () => void
} {
  const identiteDuDossier = creerIdentitesEnCache()
  const liens = racineDesLiens ? creerLiensWorkItems({ racine: racineDesLiens }) : null
  // Le type du store et celui de la carte décrivent le même JSON ; seul le typage des parts diffère.
  const lireConversations = (): readonly (ConversationPourLaCarte & { updatedAt?: number })[] =>
    os.conversations.list() as unknown as readonly (ConversationPourLaCarte & {
      updatedAt?: number
    })[]
  const lireLiens = (): EtatDesLiens => {
    try {
      return liens ? liens.lire() : etatVide()
    } catch (erreur) {
      // Un fichier de liens illisible prive la carte de ses tasks, pas de la carte.
      console.warn('[besoins] liens des work items illisibles :', erreur)
      return etatVide()
    }
  }
  const calculateur = creerCalculateurDeCarte({
    lireConversations,
    lireRuns: () => os.runsWithGate(),
    dossierParDefaut: () => os.executionWorkspace,
    ...(journal
      ? {
          lireJournal: () => {
            try {
              return journal.lire()
            } catch (erreur) {
              // Un journal illisible prive la carte des demandeurs relevés, pas de la carte.
              console.warn('[besoins] journal illisible :', erreur)
              return new Map<string, EntreeDuJournal>()
            }
          }
        }
      : {}),
    lireLiens,
    identiteDuDossier
  })
  // Le Board ne montre que les dossiers du Chat (conv-1212), plus ceux que le Chat propose toujours
  // — le dépôt par défaut et « This computer » —, sauf si une croix les a retirés. Même réduction
  // pour l'affichage et pour la copie vers le dossier du Board : ce qui part est ce que la vue montre.
  const dossiersDuChat = creerDossiersDuChat(racineDuPoste ? { racine: racineDuPoste } : {})
  const calculerLeBoard = async (): Promise<CarteDesBesoins> => {
    const carte = await calculateur.calculer()
    const liste = dossiersDuChat.lire()
    return carteDesDossiersDuChat(
      carte,
      liste === null
        ? null
        : dossiersDuBoard(liste.dossiers, [os.executionWorkspace, homedir()], liste.retires)
    )
  }
  const lecture = tickets
    ? {
        sources: () => tickets.listSources(),
        lireFiche: (source: TicketSourceProfile, id: string) => tickets.get({ source, id })
      }
    : null
  // Les collègues (conv-1210) : les AUTRES sous-dossiers du dossier choisi, le nôtre étant la cible.
  const collegues = dossierDuBoard
    ? creerLecteurDesCollegues({
        ou: () => {
          const { dossier, cible } = dossierDuBoard.etat()
          return dossier && cible ? { dossier, poste: basename(cible) } : null
        }
      })
    : null
  // La copie de fin de tour (conv-1210) : même calcul que la vue, lancé sans elle.
  const copieDeFinDeTour =
    dossierDuBoard && racineDuPoste
      ? creerCopieDeFinDeTour({
          racine: racineDuPoste,
          dossierDuBoard,
          calculer: calculerLeBoard
        })
      : null

  ipcMain.handle('os:carteDesBesoins', async (event, options: unknown) => {
    assertTrustedRendererSender(event, 'CarteDesBesoins')
    const carte = await calculerLeBoard()
    // Copie vers le dossier du Board (conv-1206), sans attendre : un partage lent ou injoignable ne
    // retarde jamais l'affichage. Les états posés à la main vivent dans la vue, qui les joint ici.
    const manuels = etatsManuelsLisibles(objet(options).etatsManuels)
    // Gardés pour la copie de fin de tour, qui part sans la vue (conv-1210).
    copieDeFinDeTour?.retenirManuels(manuels)
    dossierDuBoard?.enregistrer(carte, manuels)
    return carte
  })

  // Le dossier du Board (conv-1206). Le chemin vient du sélecteur natif, jamais d'un texte de la vue.
  ipcMain.handle('os:board-dossier', (event) => {
    assertTrustedRendererSender(event, 'Dossier du Board')
    return dossierDuBoard?.etat() ?? { dossier: null, cible: null, enCours: false }
  })

  ipcMain.handle('os:board-dossier:choisir', async (event) => {
    assertTrustedRendererSender(event, 'Dossier du Board')
    if (!dossierDuBoard || !choisirDossier) return { dossier: null, cible: null, enCours: false }
    const choisi = await choisirDossier(event.sender)
    return choisi ? dossierDuBoard.choisir(choisi) : dossierDuBoard.etat()
  })

  ipcMain.handle('os:board-dossier:effacer', async (event) => {
    assertTrustedRendererSender(event, 'Dossier du Board')
    return dossierDuBoard
      ? dossierDuBoard.effacer()
      : { dossier: null, cible: null, enCours: false }
  })

  // Les projets recopiés dans le dossier (conv-1211) : `null` = tous ; la liste reçue de la vue est
  // relue par `projetsPartagesLisibles` avant d'être gardée, illisible = rien ne change.
  ipcMain.handle('os:board-dossier:projets', (event, brute: unknown) => {
    assertTrustedRendererSender(event, 'Dossier du Board')
    if (!dossierDuBoard) return { dossier: null, cible: null, enCours: false }
    const projets = projetsPartagesLisibles(brute)
    if (projets === undefined)
      return {
        ...dossierDuBoard.etat(),
        erreur: 'Choix des projets illisible : rien n’a changé.'
      }
    return dossierDuBoard.choisirProjets(projets)
  })

  // La liste des dossiers du Chat et ses retraits (conv-1212), transmis par la vue à chaque
  // changement : relus par `dossiersDuChatLisibles` avant d'être gardés, illisible = rien ne change.
  // Retraits absents = vue d'avant leur ajout : aucun retrait.
  ipcMain.handle(
    'os:board-dossiers-du-chat',
    (event, brute: unknown, retiresBruts: unknown = []): boolean => {
      assertTrustedRendererSender(event, 'Dossiers du Chat')
      const liste = dossiersDuChatLisibles(brute)
      const retires = dossiersDuChatLisibles(retiresBruts)
      if (liste === undefined || retires === undefined) return false
      dossiersDuChat.retenir(liste, retires)
      return true
    }
  )

  // Les Boards des collègues (conv-1210) : les AUTRES sous-dossiers du dossier du Board, relus à
  // part de la carte pour qu'un partage lent ne retarde jamais notre Board. Aucun argument : le
  // dossier est celui réglé sur ce poste, jamais un chemin reçu de la vue.
  ipcMain.handle('os:board-collegues', (event): Promise<BoardsDesCollegues> => {
    assertTrustedRendererSender(event, 'Dossier du Board')
    return collegues ? collegues.lire() : Promise.resolve({ collegues: [] })
  })

  ipcMain.handle(
    'os:carte:lierWorkItem',
    async (event, brute: unknown): Promise<ResultatDuRattachement> => {
      assertTrustedRendererSender(event, 'CarteDesBesoins')
      const cible = objet(brute)
      if (!liens || !lecture)
        return {
          ok: false,
          raison: 'Rattachement indisponible : la source de tickets n’est pas câblée.'
        }
      if (!demandeExiste(lireConversations(), cible.conversationId, cible.demande))
        return { ok: false, raison: 'Cette demande n’existe plus dans son fil.' }
      return rattacherALaMain(
        { ...lecture, etat: lireLiens(), ajouter: liens.ajouter },
        {
          conversationId: cible.conversationId,
          demande: cible.demande,
          saisie: cible.saisie,
          sourceId: cible.sourceId
        }
      )
    }
  )

  ipcMain.handle('os:carte:delierWorkItem', (event, brute: unknown) => {
    assertTrustedRendererSender(event, 'CarteDesBesoins')
    const cible = objet(brute)
    if (!liens) return { ok: false, raison: 'Liens indisponibles sur ce poste.' }
    if (!demandeExiste(lireConversations(), cible.conversationId, cible.demande))
      return { ok: false, raison: 'Cette demande n’existe plus dans son fil.' }
    return detacher(
      { ajouter: liens.ajouter },
      {
        conversationId: cible.conversationId,
        demande: cible.demande,
        sourceId: cible.sourceId,
        id: cible.id
      }
    )
  })

  // Aucun argument : les numéros à lire viennent des fils, jamais de la vue.
  ipcMain.handle('os:carte:verifierMentions', async (event): Promise<BilanDesMentions> => {
    assertTrustedRendererSender(event, 'CarteDesBesoins')
    if (!liens || !lecture) return BILAN_VIDE
    const carte = await calculateur.calculer()
    return verifierLesMentions(
      { ...lecture, etat: lireLiens(), ajouter: liens.ajouter },
      carte.projets.flatMap((p) => p.demandes)
    )
  })

  return {
    // Le calcul n'est lancé qu'au moment d'écrire, et jamais sans dossier choisi (conv-1210).
    recopierLeBoard: () => copieDeFinDeTour?.recopier()
  }
}
