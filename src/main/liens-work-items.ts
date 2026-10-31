/**
 * LIER UN PROMPT À UN WORK ITEM — option E du cadrage conv-1127 (2026-10-23).
 *
 * Demande : « la vue carte du projet j'aimerais rattacher les prompts a des work-items […] pour
 * qu'un prompt soit lié a une task », puis « construis l'option E : lien automatique quand il est sûr
 * (vue Tickets, #1234 vérifié à la source) et rattachement à la main depuis la fiche de la Carte du
 * projet ».
 *
 * TROIS ORIGINES, une seule règle : un numéro n'est montré comme lien que s'il vient d'une fiche
 * réellement lue chez le fournisseur.
 * - `tickets` : la vue Tickets écrit dans le prompt du fil qu'elle ouvre « `ticket_get` avec sourceId
 *   `…`, id `…` » (`formatTicketReferencePrompt`) ; la fiche venait d'être lue pour l'écrire. C'est
 *   le texte du prompt qui fait foi : l'ancienne trace de la vue Tickets vit dans SON `localStorage`,
 *   invisible du processus principal, et le texte couvre aussi les fils plus anciens.
 * - `mention` : `#1234` (au moins 3 chiffres, contre « la #2 ») ou `AB#1234` (convention Azure
 *   Boards). Ce n'est qu'un CANDIDAT : `verifierLesMentions` lit la fiche avant de poser le lien.
 * - `manuel` : tapé dans la fiche de la carte ; lu à la source avant d'être posé.
 *
 * Le calcul de la carte reste SANS RÉSEAU : il ne lit que ce fichier (`lierLesDemandesDuFil`). Les
 * lectures de fiches n'ont lieu que dans un rattachement ou une passe de vérification, bornée.
 * AUCUNE écriture chez le fournisseur : ce module ne reçoit qu'une fonction de lecture.
 *
 * Journal en AJOUT SEUL, `liens-work-items.jsonl`, comme `besoins.jsonl` : la dernière ligne pour
 * une (demande, fiche) gagne ; un « détacher » y est une ligne, jamais une suppression.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  cleDeLaDemande,
  type BilanDesMentions,
  type DemandeDeLaCarte,
  type OrigineDuLienWorkItem,
  type ReferenceDeLaDemande,
  type ResultatDuRattachement,
  type WorkItemDeLaDemande
} from '../shared/carte-des-besoins'
import type { TicketItem, TicketSourceProfile } from '../shared/tickets'

export { cleDeLaDemande }

export const FICHIER_LIENS_WORK_ITEMS = 'liens-work-items.jsonl'

/** Plus grand identifiant accepté : Azure DevOps numérote ses work items en entiers 32 bits. */
const ID_MAX = 2_147_483_647
const TEXTE_MAX = 300
const TYPE_MAX = 60
/** Fiches lues au plus par passe de vérification : une ouverture de carte ne lance pas 200 requêtes. */
const PLAFOND_PAR_PASSE = 20
/** Un numéro inconnu de la source n'est pas relu avant ce délai (il a pu être créé depuis). */
const OUBLI_INTROUVABLE_MS = 24 * 3_600_000

type SansHorodatage<T> = T extends unknown ? Omit<T, 'v' | 'ts'> : never

export type EvenementDeLien = { v: 1; ts: number } & (
  | {
      action: 'lier'
      conversationId: string
      demande: string
      sourceId: string
      id: string
      origine: 'manuel' | 'mention'
    }
  | { action: 'delier'; conversationId: string; demande: string; sourceId: string; id: string }
  | { action: 'fiche'; sourceId: string; id: string; titre: string; type?: string }
  | { action: 'introuvable'; sourceId: string; id: string }
)

export type EvenementANoter = SansHorodatage<EvenementDeLien>

interface GestePose {
  sourceId: string
  id: string
  /** `delie` : détaché à la main — un lien automatique ne revient pas. */
  etat: 'manuel' | 'mention' | 'delie'
}

export interface EtatDesLiens {
  /** clé de demande (`cleDeDemandeDuFil`) → clé de fiche → dernier geste sur ce couple. */
  parDemande: Map<string, Map<string, GestePose>>
  /** Titre et type recopiés de la source, par clé de fiche. */
  fiches: Map<string, { titre: string; type?: string }>
  /** Clé de fiche → heure où la source a dit ne pas la connaître. */
  introuvables: Map<string, number>
}

/** La lecture d'une fiche chez le fournisseur — la SEULE capacité reçue : pas d'écriture possible. */
export interface SourceDesFiches {
  sources: () => readonly TicketSourceProfile[]
  lireFiche: (source: TicketSourceProfile, id: string) => Promise<TicketItem>
}

export function etatVide(): EtatDesLiens {
  return { parDemande: new Map(), fiches: new Map(), introuvables: new Map() }
}

const cleDeDemandeDuFil = (conversationId: string, demande: string): string =>
  `${conversationId}\u0000${demande}`

const cleDeFiche = (sourceId: string, id: string): string => `${sourceId}::${id}`

function texteBorne(valeur: unknown, max = TEXTE_MAX): string | null {
  if (typeof valeur !== 'string') return null
  const t = valeur.trim()
  return t && t.length <= max ? t : null
}

const estId = (valeur: unknown): valeur is string =>
  typeof valeur === 'string' && /^[1-9]\d{0,9}$/.test(valeur) && Number(valeur) <= ID_MAX

// ── Ce que le prompt nomme ──────────────────────────────────────────────────────────────────────

/** La ligne que `formatTicketReferencePrompt` écrit pour chaque fiche du fil qu'elle ouvre. */
const REFERENCE_VUE_TICKETS = /`ticket_get` avec sourceId `([^`\n]{1,300})`, id `([1-9]\d{0,9})`/g
/**
 * `#1234` ou `AB#1234`, ni collé à une lettre ou un chiffre (`page#12`, `#12ab`), ni dans une
 * entité HTML (`&#1234;`), ni précédé de `/` (ancre d'URL).
 */
const MENTION = /(?<![\p{L}\p{N}_&#/])(AB)?#([1-9]\d{0,9})(?![\p{L}\p{N}_])/gu
/** Une mention nue doit avoir au moins 3 chiffres : « prends la #2 » n'est pas un work item. */
const CHIFFRES_MIN_MENTION_NUE = 3

/** Le code (bloc ou en ligne) ne porte pas de mentions : `color: #333` n'est pas une task. */
function sansCode(texte: string): string {
  return texte.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

export function referencesDuPrompt(texte: string): ReferenceDeLaDemande[] {
  if (typeof texte !== 'string' || !texte) return []
  const references: ReferenceDeLaDemande[] = []
  const vus = new Set<string>()
  for (const [, sourceId, id] of texte.matchAll(REFERENCE_VUE_TICKETS)) {
    if (!estId(id) || vus.has(id)) continue
    vus.add(id)
    references.push({ id, sourceId, origine: 'tickets' })
  }
  for (const [, ab, id] of sansCode(texte).matchAll(MENTION)) {
    if (!estId(id) || vus.has(id)) continue
    if (!ab && id.length < CHIFFRES_MIN_MENTION_NUE) continue
    vus.add(id)
    references.push({ id, origine: 'mention', ...(ab ? { azure: true as const } : {}) })
  }
  return references
}

/** Ce que l'utilisateur tape dans la fiche : `1234`, `#1234`, `AB#1234`, `WI 1234`. */
export function lireSaisieDeWorkItem(
  saisie: unknown
): { ok: true; id: string } | { ok: false; raison: string } {
  if (typeof saisie !== 'string')
    return { ok: false, raison: 'Numéro de work item attendu (ex. 1234).' }
  const brut = saisie.trim()
  if (!brut) return { ok: false, raison: 'Saisie vide : tape le numéro de la task (ex. 1234).' }
  const nettoye = brut.replace(/^(?:AB#|#|wi[\s:_-]*)/i, '').trim()
  if (!/^\d+$/.test(nettoye))
    return {
      ok: false,
      raison: `Pas un numéro de work item : « ${brut.slice(0, 80)} ». Attendu : 1234, #1234 ou AB#1234.`
    }
  if (/^0/.test(nettoye))
    return { ok: false, raison: `Un numéro de work item est un entier positif : « ${brut} ».` }
  if (nettoye.length > 10 || Number(nettoye) > ID_MAX)
    return { ok: false, raison: `Numéro trop grand : « ${brut.slice(0, 20)} ».` }
  return { ok: true, id: nettoye }
}

// ── Le journal relu ─────────────────────────────────────────────────────────────────────────────

function appliquer(etat: EtatDesLiens, e: Record<string, unknown>): void {
  const sourceId = texteBorne(e.sourceId)
  const id = e.id
  if (!sourceId || !estId(id)) return
  const fiche = cleDeFiche(sourceId, id)
  if (e.action === 'fiche') {
    const titre = texteBorne(e.titre)
    if (!titre) return
    const type = texteBorne(e.type, TYPE_MAX)
    etat.fiches.set(fiche, { titre, ...(type ? { type } : {}) })
    etat.introuvables.delete(fiche)
    return
  }
  if (e.action === 'introuvable') {
    if (typeof e.ts === 'number') etat.introuvables.set(fiche, e.ts)
    return
  }
  const conversationId = texteBorne(e.conversationId)
  const demande = texteBorne(e.demande)
  if (!conversationId || !demande) return
  const geste: GestePose['etat'] | null =
    e.action === 'delier'
      ? 'delie'
      : e.action === 'lier' && (e.origine === 'manuel' || e.origine === 'mention')
        ? e.origine
        : null
  if (!geste) return
  const cle = cleDeDemandeDuFil(conversationId, demande)
  const poses = etat.parDemande.get(cle) ?? new Map<string, GestePose>()
  poses.set(fiche, { sourceId, id, etat: geste })
  etat.parDemande.set(cle, poses)
}

/** Relit le journal ; une ligne illisible est sautée, jamais la carte entière. */
export function lireLesLiens(texte: string): EtatDesLiens {
  const etat = etatVide()
  for (const ligne of texte.split('\n')) {
    if (!ligne.trim()) continue
    try {
      const e: unknown = JSON.parse(ligne)
      if (e && typeof e === 'object' && !Array.isArray(e))
        appliquer(etat, e as Record<string, unknown>)
    } catch {
      /* ligne tronquée (arrêt pendant l'écriture) : les autres restent lisibles */
    }
  }
  return etat
}

// ── Les liens de chaque demande (calcul de la carte : aucun réseau) ─────────────────────────────

function workItemsPropres(
  conversationId: string,
  d: DemandeDeLaCarte,
  etat: EtatDesLiens
): WorkItemDeLaDemande[] {
  const poses = etat.parDemande.get(cleDeDemandeDuFil(conversationId, cleDeLaDemande(d)))
  const liens = new Map<string, { sourceId: string; id: string; origine: OrigineDuLienWorkItem }>()
  for (const ref of d.references ?? []) {
    if (ref.origine !== 'tickets' || !ref.sourceId) continue
    const cle = cleDeFiche(ref.sourceId, ref.id)
    if (poses?.get(cle)?.etat === 'delie') continue
    liens.set(cle, { sourceId: ref.sourceId, id: ref.id, origine: 'tickets' })
  }
  for (const [cle, geste] of poses ?? []) {
    if (geste.etat === 'delie' || liens.has(cle)) continue
    liens.set(cle, { sourceId: geste.sourceId, id: geste.id, origine: geste.etat })
  }
  return [...liens.entries()].map(([cle, lien]) => {
    const fiche = etat.fiches.get(cle)
    return {
      ...lien,
      ...(fiche ? { titre: fiche.titre, ...(fiche.type ? { type: fiche.type } : {}) } : {})
    }
  })
}

/**
 * Pose `workItems` sur les demandes d'UN fil. Une demande `suite` (ligne de besoin de l'agent) sans
 * lien à elle reprend ceux de la demande précédente du même fil, marqués `herite` — hypothèse du
 * cadrage conv-1127. Copie, jamais mutation : les demandes viennent de la mémoire du calculateur.
 */
export function lierLesDemandesDuFil(
  conversationId: string,
  demandes: readonly DemandeDeLaCarte[],
  etat: EtatDesLiens
): DemandeDeLaCarte[] {
  const parRang = [...demandes].sort((a, b) => a.rang - b.rang)
  const liees = new Map<DemandeDeLaCarte, WorkItemDeLaDemande[]>()
  let precedents: WorkItemDeLaDemande[] = []
  for (const d of parRang) {
    let workItems = workItemsPropres(conversationId, d, etat)
    const poursuit =
      d.besoin?.nature === 'suite' && (!d.besoin.de || d.besoin.de === conversationId)
    if (!workItems.length && poursuit && precedents.length)
      workItems = precedents.map((w) => ({ ...w, herite: true as const }))
    liees.set(d, workItems)
    precedents = workItems
  }
  return demandes.map((d) => {
    const workItems = liees.get(d) ?? []
    return workItems.length ? { ...d, workItems } : d
  })
}

// ── Gestes : rattacher, détacher, vérifier (lecture seule chez le fournisseur) ──────────────────

/**
 * La source a-t-elle dit « cette fiche n'existe pas » ? Les adaptateurs le disent par
 * « … introuvable. » (`ticket-providers/azure.ts`) ou par un statut 404 (`provider-contract.ts`).
 * Tout autre échec (réseau, droits, délai) est une source injoignable : on ne conclut rien.
 */
function ficheIntrouvable(erreur: unknown): boolean {
  const message = erreur instanceof Error ? erreur.message : String(erreur)
  return /introuvable|statut 404\b|not found/i.test(message)
}

function messageDe(erreur: unknown): string {
  return (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 200)
}

function sourcePour(
  sources: readonly TicketSourceProfile[],
  sourceId: unknown
): { ok: true; source: TicketSourceProfile } | { ok: false; raison: string } {
  if (!sources.length)
    return {
      ok: false,
      // L'écran Tickets est devenu l'onglet « Tickets » du Board (conv-1397).
      raison: 'Aucune source de tickets configurée : ajoute-la dans l’onglet Tickets du Board.'
    }
  if (typeof sourceId === 'string' && sourceId.trim()) {
    const source = sources.find((s) => s.id === sourceId.trim())
    return source ? { ok: true, source } : { ok: false, raison: 'Source de tickets inconnue.' }
  }
  if (sources.length === 1) return { ok: true, source: sources[0] }
  return {
    ok: false,
    raison:
      'Plusieurs sources de tickets sont configurées : précise laquelle, je ne devine pas le projet.'
  }
}

/** La source d'une mention : la seule configurée, ou la seule Azure pour `AB#`. Sinon aucune. */
function sourceDeLaMention(
  sources: readonly TicketSourceProfile[],
  ref: ReferenceDeLaDemande
): TicketSourceProfile | undefined {
  const candidates = ref.azure ? sources.filter((s) => s.provider === 'azure') : sources
  return candidates.length === 1 ? candidates[0] : undefined
}

function ficheANoter(source: TicketSourceProfile, item: TicketItem, id: string): EvenementANoter {
  const titre = (texteBorne(item.title) ?? `Work item ${id}`).slice(0, TEXTE_MAX)
  const type = texteBorne(item.type, TYPE_MAX)
  return { action: 'fiche', sourceId: source.id, id, titre, ...(type ? { type } : {}) }
}

export async function rattacherALaMain(
  deps: SourceDesFiches & { etat: EtatDesLiens; ajouter: (e: EvenementANoter) => void },
  cible: { conversationId: unknown; demande: unknown; saisie: unknown; sourceId?: unknown }
): Promise<ResultatDuRattachement> {
  const conversationId = texteBorne(cible.conversationId)
  const demande = texteBorne(cible.demande)
  if (!conversationId || !demande) return { ok: false, raison: 'Demande introuvable sur la carte.' }
  const lu = lireSaisieDeWorkItem(cible.saisie)
  if (!lu.ok) return lu
  const choisie = sourcePour(deps.sources(), cible.sourceId)
  if (!choisie.ok) return choisie
  const { source } = choisie
  const cle = cleDeFiche(source.id, lu.id)
  const deja = deps.etat.parDemande.get(cleDeDemandeDuFil(conversationId, demande))?.get(cle)
  const connue = deps.etat.fiches.get(cle)
  // Déjà lié et déjà lu : rien à relire ni à réécrire (« répétée → un seul lien »).
  if (deja && deja.etat !== 'delie' && connue)
    return {
      ok: true,
      workItem: {
        sourceId: source.id,
        id: lu.id,
        titre: connue.titre,
        ...(connue.type ? { type: connue.type } : {}),
        origine: deja.etat
      }
    }
  let item: TicketItem
  try {
    item = await deps.lireFiche(source, lu.id)
  } catch (erreur) {
    return ficheIntrouvable(erreur)
      ? { ok: false, raison: `La fiche ${lu.id} n’existe pas dans ${source.label}.` }
      : {
          ok: false,
          raison: `Source ${source.label} injoignable (${messageDe(erreur)}) : aucun lien posé, réessaie plus tard.`
        }
  }
  const fiche = ficheANoter(source, item, lu.id) as Extract<EvenementANoter, { action: 'fiche' }>
  deps.ajouter(fiche)
  if (!deja || deja.etat === 'delie')
    deps.ajouter({
      action: 'lier',
      conversationId,
      demande,
      sourceId: source.id,
      id: lu.id,
      origine: 'manuel'
    })
  return {
    ok: true,
    workItem: {
      sourceId: source.id,
      id: lu.id,
      titre: fiche.titre,
      ...(fiche.type ? { type: fiche.type } : {}),
      origine: 'manuel'
    }
  }
}

export function detacher(
  deps: { ajouter: (e: EvenementANoter) => void },
  cible: { conversationId: unknown; demande: unknown; sourceId: unknown; id: unknown }
): { ok: true } | { ok: false; raison: string } {
  const conversationId = texteBorne(cible.conversationId)
  const demande = texteBorne(cible.demande)
  const sourceId = texteBorne(cible.sourceId)
  if (!conversationId || !demande || !sourceId || !estId(cible.id))
    return { ok: false, raison: 'Lien à détacher illisible.' }
  deps.ajouter({ action: 'delier', conversationId, demande, sourceId, id: cible.id })
  return { ok: true }
}

/**
 * Passe de vérification : lit à la source les fiches que des prompts nomment et que la carte ne
 * connaît pas encore — les mentions `#1234` (lien posé seulement si la fiche existe) et les fiches
 * de la vue Tickets dont le titre manque. Bornée à `plafond` lectures ; une source injoignable
 * arrête la passe sans rien poser.
 */
export async function verifierLesMentions(
  deps: SourceDesFiches & {
    etat: EtatDesLiens
    ajouter: (e: EvenementANoter) => void
    maintenant?: () => number
    plafond?: number
  },
  demandes: Iterable<DemandeDeLaCarte>
): Promise<BilanDesMentions> {
  const maintenant = deps.maintenant ?? Date.now
  const plafond = deps.plafond ?? PLAFOND_PAR_PASSE
  const sources = deps.sources()
  const oubliee = (cle: string): boolean => {
    const le = deps.etat.introuvables.get(cle)
    return le === undefined || maintenant() - le > OUBLI_INTROUVABLE_MS
  }
  interface FicheALire {
    source: TicketSourceProfile
    id: string
    /** Les demandes dont la mention sera posée si la fiche existe. */
    mentions: { conversationId: string; demande: string }[]
  }
  const aLire = new Map<string, FicheALire>()
  const aLireDe = (source: TicketSourceProfile, id: string): FicheALire => {
    const cle = cleDeFiche(source.id, id)
    const entree = aLire.get(cle) ?? { source, id, mentions: [] }
    aLire.set(cle, entree)
    return entree
  }
  let liees = 0
  for (const d of demandes) {
    if (!d.references?.length) continue
    const demande = cleDeLaDemande(d)
    const poses = deps.etat.parDemande.get(cleDeDemandeDuFil(d.conversationId, demande))
    for (const ref of d.references) {
      if (ref.origine === 'tickets') {
        const source = sources.find((s) => s.id === ref.sourceId)
        const cle = source ? cleDeFiche(source.id, ref.id) : ''
        if (source && !deps.etat.fiches.has(cle) && oubliee(cle)) aLireDe(source, ref.id)
        continue
      }
      const source = sourceDeLaMention(sources, ref)
      if (!source) continue
      const cle = cleDeFiche(source.id, ref.id)
      // Déjà lié, ou détaché à la main : la décision est prise, on ne la refait pas.
      if (poses?.has(cle) || !oubliee(cle)) continue
      if (deps.etat.fiches.has(cle)) {
        // Fiche déjà lue pour une autre demande : son existence est établie, pas de relecture.
        deps.ajouter({
          action: 'lier',
          conversationId: d.conversationId,
          demande,
          sourceId: source.id,
          id: ref.id,
          origine: 'mention'
        })
        liees += 1
        continue
      }
      aLireDe(source, ref.id).mentions.push({ conversationId: d.conversationId, demande })
    }
  }

  let lues = 0
  let introuvables = 0
  let injoignable = false
  let traitees = 0
  for (const entree of aLire.values()) {
    if (lues >= plafond) break
    let item: TicketItem
    try {
      item = await deps.lireFiche(entree.source, entree.id)
    } catch (erreur) {
      if (!ficheIntrouvable(erreur)) {
        // Pas de réponse de la source : rien n'est « lu », et la vue ne recalcule pas pour rien.
        injoignable = true
        break
      }
      lues += 1
      deps.ajouter({ action: 'introuvable', sourceId: entree.source.id, id: entree.id })
      introuvables += 1
      traitees += 1
      continue
    }
    lues += 1
    deps.ajouter(ficheANoter(entree.source, item, entree.id))
    for (const m of entree.mentions) {
      deps.ajouter({
        action: 'lier',
        conversationId: m.conversationId,
        demande: m.demande,
        sourceId: entree.source.id,
        id: entree.id,
        origine: 'mention'
      })
      liees += 1
    }
    traitees += 1
  }
  return { lues, liees, introuvables, injoignable, restantes: aLire.size - traitees }
}

// ── Le fichier ──────────────────────────────────────────────────────────────────────────────────

export function creerLiensWorkItems(deps: { racine: string; maintenant?: () => number }): {
  chemin: string
  lire: () => EtatDesLiens
  ajouter: (e: EvenementANoter) => void
} {
  const chemin = join(deps.racine, FICHIER_LIENS_WORK_ITEMS)
  const maintenant = deps.maintenant ?? Date.now
  let memoire: { empreinte: string; etat: EtatDesLiens } | null = null
  return {
    chemin,
    lire() {
      let empreinte: string
      try {
        const etat = statSync(chemin)
        empreinte = `${etat.size}:${etat.mtimeMs}`
      } catch {
        return etatVide()
      }
      if (memoire?.empreinte === empreinte) return memoire.etat
      const etat = lireLesLiens(readFileSync(chemin, 'utf8'))
      memoire = { empreinte, etat }
      return etat
    },
    ajouter(e) {
      mkdirSync(dirname(chemin), { recursive: true })
      appendFileSync(chemin, `${JSON.stringify({ v: 1, ts: maintenant(), ...e })}\n`, 'utf8')
      memoire = null
    }
  }
}
