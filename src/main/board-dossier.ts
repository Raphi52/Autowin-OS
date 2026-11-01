/**
 * LE DOSSIER DU BOARD — réglage du poste et écriture (demande utilisateur du 2026-10-28, conv-1206).
 *
 * Demande : « dans le board il faut qu'on puisse définir un dossier [sur le partage réseau de
 * l'équipe] pour pouvoir y stocker les éléments affichés sur le board et faire le pont vers les
 * conv ». Le Board n'existait que dans la fenêtre de l'app, recalculé à chaque ouverture.
 *
 * Ce module :
 *  - retient le dossier choisi SUR CE POSTE (`board-dossier.json` dans le dossier de données de
 *    l'app, à côté de `liens-work-items.jsonl`) — jamais un chemin écrit dans le code ;
 *  - à chaque calcul du Board, y écrit ce que le Board affiche : un post-it par fil, à l'étage
 *    affiché (état posé à la main compris), avec ses demandes, et l'identifiant de sa conversation —
 *    le pont vers le fil (`board.json` pour les outils, `board.md` pour les yeux) ;
 *  - écrit dans un sous-dossier PAR COMPTE WINDOWS : sur un partage d'équipe, deux postes qui
 *    écriraient le même `board.json` s'écraseraient l'un l'autre.
 *
 * Un partage réseau peut être lent ou injoignable (hors VPN) : l'écriture ne bloque JAMAIS le calcul
 * du Board, un échec est gardé et affiché, et deux écritures sont espacées d'au moins
 * `DELAI_ENTRE_ECRITURES_MS` — pendant une vérification, la vue recalcule le Board toutes les
 * quelques secondes (`verification-du-board.ts`), soit ~2,5 Mo réécrits à chaque fois sans ce délai.
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  RunBloqueDeLaCarte,
  StatutDemande,
  WorkItemDeLaDemande
} from '../shared/carte-des-besoins'
import type { EtageDuBoard, EtatDuDossierDuBoard, EtatManuelDuBoard } from '../shared/board-dossier'
import { carteDesProjetsPartages, projetsPartagesLisibles } from '../shared/board-projets-partages'
import { nomDuPosteLisible } from '../shared/board-nom-du-poste'

export const FICHIER_DU_REGLAGE = 'board-dossier.json'
export const FORMAT_DU_BOARD = 'autowin-board/1'
export const DELAI_ENTRE_ECRITURES_MS = 30_000

// ———————————————————————————————————————————————————————————————— ce qui est écrit

export interface DemandeEnregistree {
  rang: number
  messageId?: string
  titre: string
  /** Le message entier, pour la fiche du Board des collègues (conv-1278) ; absent si `titre` suffit. */
  texte?: string
  statut: StatutDemande
  constat: string
  date?: string
  demandeur?: { nom: string; email?: string }
  workItems?: { sourceId: string; id: string; titre?: string }[]
}

export interface PostItEnregistre {
  /** Le pont vers le fil : l'identifiant de la conversation dans Autowin (`conv-1206`). */
  conversationId: string
  titre: string
  projet: { cle: string; libelle: string }
  /** L'étage affiché sur le Board : l'état posé à la main s'il tient encore, sinon `etatPreuve`. */
  etage: EtageDuBoard
  /** L'état de la dernière demande du fil, tel que les preuves le donnent. */
  etatPreuve: StatutDemande
  manuel?: { etage: EtageDuBoard; a: string }
  derniereDemande: string
  demandeur?: { nom: string; email?: string }
  demandes: DemandeEnregistree[]
}

export interface BoardEnregistre {
  format: typeof FORMAT_DU_BOARD
  /** Le compte Windows du poste qui a écrit ce fichier. */
  poste: string
  /**
   * Le nom à écrire sur ses post-it chez les collègues : choisi dans les réglages, sinon le compte
   * Windows (conv-1230). Absent dans les fichiers écrits avant : le lecteur prend alors `poste`.
   */
  nom?: string
  enregistreA?: string
  demandes: number
  comptes: Record<StatutDemande, number>
  /** Le plus récent d'abord. */
  postIts: PostItEnregistre[]
  /** Fils dont aucune demande n'est datée : le Board ne les pose pas, ils sont seulement comptés. */
  filsSansDate: number
  runsBloques: RunEnregistre[]
  /** Runs validés qui attendent une réponse de l'utilisateur. Absent = aucun (conv-1346). */
  runsEnAttenteDeDecision?: RunEnregistre[]
}

interface RunEnregistre {
  sujet: string
  statut: string
  chemin: string
  date: string
  conversationId?: string
}

const iso = (ms: number): string => new Date(ms).toISOString()

function runEnregistre(r: RunBloqueDeLaCarte): RunEnregistre {
  return {
    sujet: r.sujet,
    statut: r.statut,
    chemin: r.chemin,
    date: iso(r.mtime),
    ...(r.conversationId ? { conversationId: r.conversationId } : {})
  }
}

/**
 * L'état manuel qui tient encore : posé APRÈS la dernière demande du fil, et différent de la preuve.
 * Même règle que la rivière (`manuelValable`, `carte-riviere.ts`), pour écrire ce que l'écran montre.
 */
function manuelValable(
  manuel: EtatManuelDuBoard | undefined,
  instant: number,
  etatPreuve: StatutDemande
): EtatManuelDuBoard | undefined {
  if (!manuel || manuel.a < instant || manuel.etage === etatPreuve) return undefined
  return manuel
}

function personne(d: DemandeDeLaCarte['demandeur']): { nom: string; email?: string } | undefined {
  return d ? { nom: d.nom, ...(d.email ? { email: d.email } : {}) } : undefined
}

function tache(w: WorkItemDeLaDemande): { sourceId: string; id: string; titre?: string } {
  return { sourceId: w.sourceId, id: w.id, ...(w.titre ? { titre: w.titre } : {}) }
}

function demandeEnregistree(d: DemandeDeLaCarte): DemandeEnregistree {
  const demandeur = personne(d.demandeur)
  return {
    rang: d.rang,
    ...(d.messageId ? { messageId: d.messageId } : {}),
    titre: d.titre,
    ...(d.texte ? { texte: d.texte } : {}),
    statut: d.statut,
    constat: d.constat,
    ...(d.debut !== undefined ? { date: iso(d.debut) } : {}),
    ...(demandeur ? { demandeur } : {}),
    ...(d.workItems?.length ? { workItems: d.workItems.map(tache) } : {})
  }
}

/**
 * Les post-it du Board : un par fil, posé au moment de sa dernière demande, à l'étage de l'état de
 * cette dernière demande — ou de l'état posé à la main s'il tient encore. Même regroupement que
 * `filsDuProjet` et `riviereDe` côté vue (qu'on ne peut pas importer d'ici : la vue tire ses textes
 * de l'interface).
 */
export function postItsDuBoard(
  carte: CarteDesBesoins,
  manuels: Readonly<Record<string, EtatManuelDuBoard>> = {}
): { postIts: PostItEnregistre[]; filsSansDate: number } {
  const avecInstant: { instant: number; postIt: PostItEnregistre }[] = []
  let filsSansDate = 0
  for (const projet of carte.projets) {
    const parFil = new Map<string, DemandeDeLaCarte[]>()
    for (const d of projet.demandes) {
      const liste = parFil.get(d.conversationId)
      if (liste) liste.push(d)
      else parFil.set(d.conversationId, [d])
    }
    for (const [conversationId, liste] of parFil) {
      const ordonnees = [...liste].sort((a, b) => a.rang - b.rang)
      const derniere = ordonnees[ordonnees.length - 1]
      let instant: number | undefined
      for (const d of ordonnees)
        if (d.debut !== undefined && (instant === undefined || d.debut > instant)) instant = d.debut
      if (instant === undefined) {
        filsSansDate += 1
        continue
      }
      const etatPreuve = derniere.statut
      const manuel = manuelValable(manuels[conversationId], instant, etatPreuve)
      const demandeur = personne(
        derniere.demandeur ?? ordonnees.find((d) => d.demandeur)?.demandeur
      )
      avecInstant.push({
        instant,
        postIt: {
          conversationId,
          titre: derniere.conversationTitre || conversationId,
          projet: { cle: projet.cle, libelle: projet.libelle },
          etage: manuel?.etage ?? etatPreuve,
          etatPreuve,
          ...(manuel ? { manuel: { etage: manuel.etage, a: iso(manuel.a) } } : {}),
          derniereDemande: iso(instant),
          ...(demandeur ? { demandeur } : {}),
          demandes: ordonnees.map(demandeEnregistree)
        }
      })
    }
  }
  avecInstant.sort((a, b) => b.instant - a.instant)
  return { postIts: avecInstant.map((p) => p.postIt), filsSansDate }
}

export function boardAEnregistrer(
  carte: CarteDesBesoins,
  manuels: Readonly<Record<string, EtatManuelDuBoard>>,
  poste: string,
  nom?: string
): BoardEnregistre {
  const { postIts, filsSansDate } = postItsDuBoard(carte, manuels)
  const enAttente = carte.projets.flatMap((p) => p.runsEnAttenteDeDecision ?? []).map(runEnregistre)
  return {
    format: FORMAT_DU_BOARD,
    poste,
    ...(nom ? { nom } : {}),
    demandes: carte.demandes,
    comptes: carte.comptes,
    postIts,
    filsSansDate,
    runsBloques: carte.projets.flatMap((p) => p.runsBloques.map(runEnregistre)),
    ...(enAttente.length ? { runsEnAttenteDeDecision: enAttente } : {})
  }
}

const NOM_DE_L_ETAGE: Record<EtageDuBoard, string> = {
  'a-faire': 'À faire',
  refuse: 'Refusé',
  'en-cours': 'En cours',
  'sans-preuve': 'Sans preuve',
  prouve: 'Prouvé'
}

/** `2026-10-28 14:05`, à l'heure du poste : le fichier est lu par des gens, pas par une horloge. */
function dateLisible(isoDate: string): string {
  const d = new Date(isoDate)
  const n = (v: number): string => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())} ${n(d.getHours())}:${n(d.getMinutes())}`
}

/** Un titre de fil sur plusieurs lignes casserait la liste Markdown : tout tient sur une ligne. */
function ligne(texte: string): string {
  return texte.replace(/\s+/g, ' ').trim()
}

/** La version à lire de `board.json` : un titre par projet, un post-it par fil, ses demandes dessous. */
export function boardEnMarkdown(board: BoardEnregistre): string {
  const sortie: string[] = [
    `# Board — ${ligne(board.nom ?? board.poste)}`,
    '',
    `Enregistré le ${board.enregistreA ? dateLisible(board.enregistreA) : '—'} · ${board.postIts.length} post-it · ${board.demandes} demandes · ${board.comptes.prouve} prouvées · ${board.comptes.refuse} refusées`,
    '',
    'Chaque post-it est un fil d’Autowin : son identifiant (`conv-…`) est celui à rouvrir dans l’app.',
    ''
  ]
  const parProjet = new Map<string, PostItEnregistre[]>()
  for (const p of board.postIts) {
    const liste = parProjet.get(p.projet.libelle)
    if (liste) liste.push(p)
    else parProjet.set(p.projet.libelle, [p])
  }
  for (const [projet, postIts] of parProjet) {
    sortie.push(`## ${ligne(projet)}`, '')
    for (const p of postIts) {
      const manuel = p.manuel ? ' (posé à la main)' : ''
      const qui = p.demandeur ? ` · ${ligne(p.demandeur.nom)}` : ''
      sortie.push(
        `### ${p.conversationId} — ${ligne(p.titre)}`,
        '',
        `**${NOM_DE_L_ETAGE[p.etage]}**${manuel} · dernière demande ${dateLisible(p.derniereDemande)}${qui}`,
        ''
      )
      for (const d of p.demandes) {
        const quand = d.date ? `${dateLisible(d.date)} · ` : ''
        const taches = d.workItems?.length
          ? ` · tasks ${d.workItems.map((w) => `#${w.id}`).join(', ')}`
          : ''
        sortie.push(
          `- ${quand}**${NOM_DE_L_ETAGE[d.statut]}** — ${ligne(d.titre)} _(${ligne(d.constat)})_${taches}`
        )
      }
      sortie.push('')
    }
  }
  const listeDeRuns = (titre: string, runs: readonly RunEnregistre[]): void => {
    if (!runs.length) return
    sortie.push(`## ${titre}`, '')
    for (const r of runs)
      sortie.push(
        `- ${dateLisible(r.date)} · ${r.statut} · ${ligne(r.sujet)}${r.conversationId ? ` · ${r.conversationId}` : ''}`
      )
    sortie.push('')
  }
  listeDeRuns('Runs bloqués', board.runsBloques)
  listeDeRuns('En attente de votre décision', board.runsEnAttenteDeDecision ?? [])
  return sortie.join('\n')
}

// ———————————————————————————————————————————————————————————————— le réglage du poste

/**
 * Le réglage du poste : le dossier (ou `null`), les projets partagés (`null` = tous, conv-1211) et
 * le nom choisi pour le Board (`null` = le compte Windows, conv-1230).
 * Fichier illisible = aucun dossier, tous les projets, le compte Windows : le Board marche sans.
 */
export function lireReglageDuBoard(racine: string): {
  dossier: string | null
  projets: string[] | null
  nom: string | null
} {
  try {
    const lu = JSON.parse(readFileSync(join(racine, FICHIER_DU_REGLAGE), 'utf8')) as {
      dossier?: unknown
      projets?: unknown
      nom?: unknown
    }
    const dossier =
      typeof lu.dossier === 'string' && isAbsolute(lu.dossier.trim()) ? lu.dossier.trim() : null
    // Un choix illisible ne se lit PAS comme « tous » : ce serait partager ce qu'on avait retiré.
    const projets = projetsPartagesLisibles(lu.projets)
    return {
      dossier,
      projets: projets === undefined ? [] : projets,
      nom: nomDuPosteLisible(lu.nom) ?? null
    }
  } catch {
    return { dossier: null, projets: null, nom: null }
  }
}

/** Le dossier enregistré, ou `null`. Illisible = aucun dossier : le Board marche sans. */
export function lireDossierDuBoard(racine: string): string | null {
  return lireReglageDuBoard(racine).dossier
}

/** Le nom du sous-dossier du poste : le compte Windows, sans caractère interdit dans un nom. */
export function sousDossierDuPoste(utilisateur: string): string {
  const propre = [...utilisateur]
    .map((c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? '_' : c))
    .join('')
    .replace(/^\.+|\.+$/g, '')
  return propre.trim() || 'poste'
}

async function estUnDossier(chemin: string): Promise<boolean> {
  try {
    return (await stat(chemin)).isDirectory()
  } catch {
    return false
  }
}

/** Écrit en entier ou pas du tout : un lecteur du partage ne voit jamais un fichier à moitié écrit. */
async function ecrireEntier(fichier: string, contenu: string): Promise<void> {
  const provisoire = `${fichier}.${process.pid}.tmp`
  await writeFile(provisoire, contenu, 'utf8')
  try {
    await rename(provisoire, fichier)
  } catch (erreur) {
    await rm(provisoire, { force: true })
    throw erreur
  }
}

export interface DossierDuBoard {
  etat: () => EtatDuDossierDuBoard
  /** Enregistre le dossier choisi ; refuse un chemin incomplet ou un dossier introuvable. */
  choisir: (dossier: string) => Promise<EtatDuDossierDuBoard>
  effacer: () => Promise<EtatDuDossierDuBoard>
  /** Retient les projets recopiés (`null` = tous) ; appliqué à la prochaine écriture (conv-1211). */
  choisirProjets: (projets: readonly string[] | null) => Promise<EtatDuDossierDuBoard>
  /** Retient le nom affiché sur le Board (`null` = le compte Windows, conv-1230). */
  choisirNom: (nom: string | null) => Promise<EtatDuDossierDuBoard>
  /** Le compte Windows du poste et le nom écrit sur ses post-it (le choisi, sinon le compte). */
  nomDuPoste: () => { compte: string; nom: string }
  /** Envoie le Board vers le dossier, sans attendre ; ne fait rien sans dossier choisi. */
  enregistrer: (
    carte: CarteDesBesoins,
    manuels: Readonly<Record<string, EtatManuelDuBoard>>
  ) => void
  /** Pour les tests et l'arrêt : attend la fin de l'écriture en cours et de celle qui attend. */
  attendre: () => Promise<void>
}

export function creerDossierDuBoard(deps: {
  /** Dossier de données de l'app, où vit `board-dossier.json`. */
  racine: string
  /** Le compte Windows du poste (`nomUtilisateurCourant`). */
  utilisateur: string
  maintenant?: () => number
  delaiMs?: number
  planifier?: (fn: () => void, ms: number) => { annuler: () => void }
}): DossierDuBoard {
  const maintenant = deps.maintenant ?? Date.now
  const delaiMs = deps.delaiMs ?? DELAI_ENTRE_ECRITURES_MS
  const planifier =
    deps.planifier ??
    ((fn: () => void, ms: number): { annuler: () => void } => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return { annuler: () => clearTimeout(t) }
    })
  const poste = sousDossierDuPoste(deps.utilisateur)
  // Le compte tel que Windows le donne ; un compte illisible prend le nom du sous-dossier.
  const compte = deps.utilisateur.trim() || poste
  const reglage = lireReglageDuBoard(deps.racine)
  let dossier = reglage.dossier
  let projets = reglage.projets
  let nomChoisi = reglage.nom
  const nomDuPoste = (): { compte: string; nom: string } => ({ compte, nom: nomChoisi ?? compte })
  let dernier: EtatDuDossierDuBoard['dernier']
  let erreur: string | undefined
  let enAttente: {
    carte: CarteDesBesoins
    manuels: Readonly<Record<string, EtatManuelDuBoard>>
  } | null = null
  let ecriture: Promise<void> | null = null
  let minuteur: { annuler: () => void } | null = null
  let derniereEcriture = Number.NEGATIVE_INFINITY
  /** Ce qui a été écrit en dernier, et où : un Board inchangé ne se réécrit pas. */
  let empreinte: { cible: string; corps: string } | null = null

  const cible = (): string | null => (dossier ? join(dossier, poste) : null)

  const etat = (): EtatDuDossierDuBoard => ({
    dossier,
    cible: cible(),
    ...(projets ? { projets: [...projets] } : {}),
    ...(dernier ? { dernier } : {}),
    ...(erreur ? { erreur } : {}),
    enCours: Boolean(ecriture || minuteur || enAttente),
    nom: nomDuPoste().nom,
    compte,
    ...(nomChoisi ? { nomChoisi } : {})
  })

  async function ecrire(travail: NonNullable<typeof enAttente>): Promise<void> {
    const ici = cible()
    if (!ici) return
    // Seuls les projets choisis partent sur le partage (conv-1211), lus AU MOMENT d'écrire : un
    // choix changé pendant le délai entre deux écritures s'applique à celle qui attend.
    const board = boardAEnregistrer(
      carteDesProjetsPartages(travail.carte, projets),
      travail.manuels,
      poste,
      nomDuPoste().nom
    )
    const corps = JSON.stringify(board)
    if (empreinte && empreinte.cible === ici && empreinte.corps === corps) return
    derniereEcriture = maintenant()
    try {
      if (!(await estUnDossier(dossier as string)))
        throw new Error(`Dossier introuvable ou injoignable : ${dossier}`)
      await mkdir(ici, { recursive: true })
      const date = new Date(maintenant()).toISOString()
      const complet: BoardEnregistre = { ...board, enregistreA: date }
      await ecrireEntier(join(ici, 'board.json'), `${JSON.stringify(complet, null, 2)}\n`)
      await ecrireEntier(join(ici, 'board.md'), boardEnMarkdown(complet))
      empreinte = { cible: ici, corps }
      dernier = { a: maintenant(), postIts: board.postIts.length, fichier: join(ici, 'board.json') }
      erreur = undefined
    } catch (e) {
      erreur = e instanceof Error ? e.message : String(e)
      console.warn('[board] dossier non écrit :', erreur)
    }
  }

  function pousser(): void {
    if (ecriture || minuteur || !enAttente) return
    const reste = derniereEcriture + delaiMs - maintenant()
    if (reste > 0) {
      minuteur = planifier(() => {
        minuteur = null
        pousser()
      }, reste)
      return
    }
    const travail = enAttente
    enAttente = null
    ecriture = ecrire(travail).finally(() => {
      ecriture = null
      pousser()
    })
  }

  /**
   * Le dossier, le choix des projets et le nom : changer l'un ne doit jamais effacer les autres
   * (conv-1211, conv-1230).
   */
  async function ecrireLeReglage(
    nouveauDossier: string | null,
    nouveauxProjets: readonly string[] | null,
    nouveauNom: string | null = nomChoisi
  ): Promise<void> {
    await mkdir(deps.racine, { recursive: true })
    await writeFile(
      join(deps.racine, FICHIER_DU_REGLAGE),
      `${JSON.stringify(
        {
          dossier: nouveauDossier,
          ...(nouveauxProjets ? { projets: nouveauxProjets } : {}),
          ...(nouveauNom ? { nom: nouveauNom } : {})
        },
        null,
        2
      )}\n`,
      'utf8'
    )
  }

  return {
    etat,
    nomDuPoste,
    async choisirNom(nom) {
      await ecrireLeReglage(dossier, projets, nom)
      nomChoisi = nom
      // Le nom est écrit dans board.json : la prochaine copie part même si le Board n'a pas bougé.
      empreinte = null
      return etat()
    },
    async choisirProjets(choix) {
      const retenus = choix === null ? null : [...new Set(choix)]
      await ecrireLeReglage(dossier, retenus)
      projets = retenus
      return etat()
    },
    async choisir(saisie) {
      const brut = saisie.trim()
      if (!isAbsolute(brut)) {
        erreur = `Chemin incomplet : « ${brut} ». Donne le chemin entier, par exemple \\\\serveur\\partage\\Board.`
        return etat()
      }
      const choisi = resolve(brut)
      if (!(await estUnDossier(choisi))) {
        erreur = `Dossier introuvable ou injoignable : ${choisi}`
        return etat()
      }
      await ecrireLeReglage(choisi, projets)
      dossier = choisi
      empreinte = null
      dernier = undefined
      erreur = undefined
      return etat()
    },
    async effacer() {
      // Le choix des projets survit à l'oubli du dossier (conv-1211) : en rechoisir un ne doit pas
      // repartager d'un coup ce qu'on avait décoché. Le nom choisi survit aussi (conv-1230).
      if (projets || nomChoisi) await ecrireLeReglage(null, projets)
      else await rm(join(deps.racine, FICHIER_DU_REGLAGE), { force: true })
      dossier = null
      enAttente = null
      minuteur?.annuler()
      minuteur = null
      empreinte = null
      dernier = undefined
      erreur = undefined
      return etat()
    },
    enregistrer(carte, manuels) {
      if (!dossier) return
      enAttente = { carte, manuels }
      pousser()
    },
    async attendre() {
      while (ecriture) await ecriture
    }
  }
}
