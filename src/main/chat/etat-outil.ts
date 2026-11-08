/*
 * Vue COURTE de l'état de l'app pour l'outil `get_state`.
 *
 * Origine (2026-10-31) : `get_state` rendait tout `snapshot()`, 187 000 caractères sur
 * 1 190 conversations, coupé à 120 000 — 6 appels sur 6 tronqués, alors que l'avis de troncature
 * disait de relancer « plus étroit » sans aucun argument pour le faire. Ce module est PUR (aucun
 * import d'electron ni de commands.ts à l'exécution) : le branchement est fait par commands.ts.
 */
import type { AppSnapshot } from '../commands/commands'
import { LEGENDE_RUNS_NON_EXAMINES } from '../dashboards/runs-scan'

export interface ArgsEtat {
  sections?: string | string[]
  conversation?: string
  limite?: string | number
}

export const LIMITE_DEFAUT = 20
export const LIMITE_MAX = 200

/** Clés valides de `sections`, hors `tout`. */
export const SECTIONS_ETAT = [
  'tab',
  'activeConversationId',
  'providers',
  'roles',
  'conversations',
  'runs',
  'runsNonExamines',
  'worktrees',
  'travauxNonPublies',
  'budgetUsd',
  'budgetUnpricedTurns',
  'budgetIsPartial'
] as const

export const AIDE_ARGS_ETAT = {
  sections:
    'facultatif — clés de l’état à rendre, séparées par des virgules (ex. « runs,worktrees »), ou « tout » pour l’état ENTIER (très long : plus de 100 000 caractères). Valeurs : ' +
    SECTIONS_ETAT.join(', ') +
    '. Absent = vue courte (onglet, conversation active, compteurs, runs bloqués, travauxNonPublies, conversations récentes).',
  conversation:
    'facultatif — texte cherché (sans tenir compte des majuscules ni des accents) dans le titre ou l’identifiant des conversations ; ne garde que celles qui correspondent',
  limite: `facultatif — nombre de conversations rendues, les plus récentes d’abord (défaut ${LIMITE_DEFAUT}, maximum ${LIMITE_MAX})`
}

function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function lireLimite(brute: string | number | undefined): number {
  if (brute === undefined || brute === null || (typeof brute === 'string' && brute.trim() === ''))
    return LIMITE_DEFAUT
  const n = typeof brute === 'number' ? brute : Number(String(brute).trim())
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(
      `limite invalide : « ${String(brute)} ». Attendu : un entier de 1 à ${LIMITE_MAX} (défaut ${LIMITE_DEFAUT}).`
    )
  }
  return Math.min(LIMITE_MAX, Math.floor(n))
}

function lireSections(brutes: string | string[] | undefined): string[] | 'tout' | undefined {
  if (brutes === undefined || brutes === null) return undefined
  const liste = (Array.isArray(brutes) ? brutes : String(brutes).split(','))
    .map((s) => String(s).trim())
    .filter((s) => s !== '')
  if (liste.length === 0) return undefined
  const valides = new Set<string>([...SECTIONS_ETAT, 'tout'])
  const inconnues = liste.filter((s) => !valides.has(s))
  if (inconnues.length > 0) {
    throw new Error(
      `section inconnue : ${inconnues.map((s) => `« ${s} »`).join(', ')}. Valeurs valides : tout, ${SECTIONS_ETAT.join(', ')}.`
    )
  }
  return liste.includes('tout') ? 'tout' : liste
}

type Conv = AppSnapshot['conversations'][number]

/** Plus récente d'abord, sur la dernière écriture de l'utilisateur ; `updatedAt` départage. */
function trierRecents(convs: Conv[]): Conv[] {
  return [...convs].sort(
    (a, b) =>
      (b.lastUserMessageAt ?? 0) - (a.lastUserMessageAt ?? 0) || b.updatedAt - a.updatedAt
  )
}

export function etatPourOutil(etat: AppSnapshot, args: ArgsEtat = {}): Record<string, unknown> {
  const sections = lireSections(args.sections)
  const limiteDonnee = args.limite !== undefined && String(args.limite).trim() !== ''
  const limite = lireLimite(args.limite)
  const filtre = typeof args.conversation === 'string' ? args.conversation.trim() : ''

  const total = etat.conversations.length
  const correspondantes = filtre
    ? etat.conversations.filter((c) =>
        normaliser(`${c.id} ${c.title}`).includes(normaliser(filtre))
      )
    : etat.conversations
  const recentes = trierRecents(correspondantes)

  const notes: string[] = []
  const omises = (rendues: number): void => {
    if (rendues >= recentes.length) return
    notes.push(
      `${recentes.length - rendues} conversation(s) omise(s) sur ${recentes.length}` +
        `${filtre ? ` correspondant à « ${filtre} »` : ''} : relance avec limite (jusqu’à ${LIMITE_MAX}) ou conversation: "<texte du titre ou id>" pour les voir.`
    )
  }

  // Section(s) explicite(s) ou « tout » : on rend les clés demandées telles quelles.
  if (sections !== undefined) {
    const cles = sections === 'tout' ? [...SECTIONS_ETAT] : sections
    const sortie: Record<string, unknown> = {}
    for (const cle of cles) {
      if (cle === 'conversations') {
        // « tout » = l'état entier : pas de coupe, sauf si l'appelant a demandé `limite` ou un filtre.
        const rendues =
          sections === 'tout' && !limiteDonnee ? recentes : recentes.slice(0, limite)
        sortie.conversations = rendues
        omises(rendues.length)
      } else if (cle in etat) {
        sortie[cle] = (etat as unknown as Record<string, unknown>)[cle]
      }
    }
    if (notes.length > 0) sortie.note = notes.join(' ')
    return sortie
  }

  // Vue courte par défaut.
  const runsBloques = etat.runs.filter((r) => r.blocked)
  const rendues = recentes.slice(0, limite)
  omises(rendues.length)
  return {
    tab: etat.tab,
    activeConversationId: etat.activeConversationId,
    compteurs: {
      conversations: total,
      ...(filtre ? { conversationsCorrespondantes: correspondantes.length } : {}),
      runsListes: etat.runs.length,
      runsBloques: runsBloques.length,
      // fix-ok: cause mesurée — le compteur partait sans légende (test rouge « expected 'undefined' to contain 'rien à regarder' ») : un 0 nu ne disait pas « rien à regarder » à l'agent.
      ...(etat.runsNonExamines !== undefined
        ? {
            runsNonExamines: etat.runsNonExamines,
            runsNonExaminesLegende: LEGENDE_RUNS_NON_EXAMINES
          }
        : {}),
      worktrees: etat.worktrees.length,
      travauxNonPublies: etat.travauxNonPublies.length,
      providers: etat.providers.length
    },
    runsBloques,
    travauxNonPublies: etat.travauxNonPublies,
    budgetUsd: etat.budgetUsd,
    budgetIsPartial: etat.budgetIsPartial,
    conversations: rendues.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      ...(c.lastUserMessageAt !== undefined ? { lastUserMessageAt: c.lastUserMessageAt } : {})
    })),
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
    aide: 'Autres clés (roles, runs, worktrees…) : sections: "runs,worktrees" ; état entier : sections: "tout".'
  }
}
