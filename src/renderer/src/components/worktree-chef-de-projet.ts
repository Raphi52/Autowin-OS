import {
  requiresAttention,
  type WorktreeAgentActivity
} from '../../../shared/worktree-activity-model'

/**
 * Ce qu'un chef de projet doit lire en trois secondes : ce qui l'attend, et si ça avance.
 *
 * La vue Worktrees montre le DÉPÔT ; elle portait 215 runs, ce qu'aucun humain ne lit. Ici on regroupe
 * ces runs par CHANTIER — une branche de départ — et on ne garde qu'un verdict par chantier : le plus
 * urgent de ses runs. Un chantier dont un run attend une décision attend une décision, point.
 *
 * Deux règles d'honnêteté, et elles ne sont pas décoratives :
 *
 *  1. « Attend un humain » vient de `requiresAttention`, la source unique du modèle, JAMAIS d'une règle
 *     réécrite ici. Mesuré le 2026-08-12 dans ce dépôt : la vue annonçait 146 bureaux bloqués pour SEPT
 *     qui retenaient réellement du travail, parce que 118 runs coupés par un arrêt de l'application
 *     étaient étiquetés `blocked` avec `merge-failed` par défaut. Un tableau de bord qui répète cette
 *     inflation est pire qu'aucun tableau de bord : il apprend à ignorer ses propres alertes.
 *
 *  2. Un verdict absent ou `unknown` donne `a-verifier`, jamais `termine`. Sur les 215 runs actuels,
 *     beaucoup sont des runs récupérés au verdict inconnu ; les peindre en vert serait un mensonge.
 */

/** Le verdict d'un chantier, du plus urgent au plus inerte. L'ordre EST la priorité d'affichage. */
export const VERDICTS_CHANTIER = [
  /** Une décision humaine est attendue : conflit, retries épuisés, changement après publication. */
  'a-toi',
  /** Le travail est fini et attend d'être intégré. Actionnable aussi, mais sans arbitrage. */
  'pret',
  /** Des agents travaillent dessus maintenant. */
  'en-cours',
  /** Ni fini ni en cours, et son verdict n'est pas connu. À regarder, pas à croire. */
  'a-verifier',
  /** Coupé par un arrêt de l'application. N'attend personne : à relancer ou à oublier. */
  'interrompu',
  /** Intégré. */
  'termine'
] as const

export type VerdictChantier = (typeof VERDICTS_CHANTIER)[number]

export const LIBELLES_VERDICT: Record<VerdictChantier, string> = {
  'a-toi': 'à toi',
  pret: 'prêt à fusionner',
  'en-cours': 'en cours',
  'a-verifier': 'inconnu — à vérifier',
  interrompu: 'interrompu',
  termine: 'terminé'
}

export interface Chantier {
  /** La branche de départ. C'est l'unité qu'un chef de projet nomme, pas l'identifiant d'un run. */
  branche: string
  verdict: VerdictChantier
  /** Combien de runs de ce chantier attendent une décision humaine. */
  aToi: number
  runs: number
  fichiers: number
  /** Âge du run le plus ancien qui attend une décision. Absent si aucun n'attend. */
  attenteDepuisMs?: number
  /** La tâche du run le plus urgent, pour dire DE QUOI il s'agit sans ouvrir le chantier. */
  sujet?: string
}

export interface FluxProjet {
  chantiers: number
  aToi: number
  pret: number
  enCours: number
  aVerifier: number
  interrompus: number
  /**
   * Les RUNS coupés, pas les chantiers — et c'est une unité différente à dessein.
   *
   * Tous les autres nombres de ce bandeau comptent des chantiers, chacun réduit à son verdict le PLUS
   * urgent. Un chantier qui porte 40 runs coupés et un seul run bloqué compte donc comme « à toi », et
   * `interrompus` reste à zéro. MESURÉ sur ce dépôt : le bandeau affichait « 0 interrompus » alors que
   * 119 runs l'étaient. Ce n'était pas faux au sens strict — c'était un zéro qui se lisait comme
   * « aucun », soit un mensonge par omission. L'unité est donc écrite dans le libellé.
   */
  runsInterrompus: number
  /** Le plus vieux blocage, toutes branches confondues : c'est lui qui dit si ça stagne. */
  plusVieilleAttenteMs?: number
}

function verdictDuRun(agent: WorktreeAgentActivity): VerdictChantier {
  // `requiresAttention` d'abord, et sans exception : c'est la seule règle qui décide qu'un humain est
  // attendu, et la dupliquer ici rouvrirait l'inflation mesurée (146 annoncés pour 7 réels).
  if (requiresAttention(agent)) return 'a-toi'
  if (agent.state === 'interrupted') return 'interrompu'
  if (agent.state === 'merged') return 'termine'
  if (agent.publication === 'published' || agent.publication === 'complete') return 'termine'
  if (agent.state === 'ready' || agent.publication === 'pending' || agent.publication === 'held') {
    return 'pret'
  }
  if (agent.state === 'working' || agent.state === 'isolated') return 'en-cours'
  // Reste : un état sans verdict lisible. On le NOMME au lieu de le supposer fini.
  return 'a-verifier'
}

const rang = (verdict: VerdictChantier): number => VERDICTS_CHANTIER.indexOf(verdict)

function ageAttenteMs(agent: WorktreeAgentActivity, nowMs: number): number | undefined {
  // On mesure depuis le DÉBUT du run : ce qui intéresse un chef de projet est depuis combien de temps
  // ce chantier attend, pas depuis quand son dernier événement a été écrit.
  if (!Number.isFinite(agent.startedAtMs)) return undefined
  const age = nowMs - agent.startedAtMs
  return age >= 0 ? age : undefined
}

/** Une ligne par branche, la plus urgente en premier, puis la plus vieille attente. */
export function regrouperParChantier(
  agents: readonly WorktreeAgentActivity[],
  nowMs: number
): Chantier[] {
  const parBranche = new Map<string, WorktreeAgentActivity[]>()
  for (const agent of agents) {
    // Une branche absente n'est pas fondue dans les autres : un chantier anonyme reste UN chantier,
    // et le fondre inventerait un regroupement que les données ne portent pas.
    const cle = agent.baseBranch?.trim() || 'branche inconnue'
    const lot = parBranche.get(cle)
    if (lot) lot.push(agent)
    else parBranche.set(cle, [agent])
  }

  const chantiers: Chantier[] = []
  for (const [branche, lot] of parBranche) {
    const verdicts = lot.map(verdictDuRun)
    const verdict = verdicts.reduce((pire, actuel) => (rang(actuel) < rang(pire) ? actuel : pire))
    const enAttente = lot.filter((agent) => requiresAttention(agent))
    const ages = enAttente
      .map((agent) => ageAttenteMs(agent, nowMs))
      .filter((age): age is number => age !== undefined)
    const plusUrgent = lot[verdicts.indexOf(verdict)]
    chantiers.push({
      branche,
      verdict,
      aToi: enAttente.length,
      runs: lot.length,
      fichiers: new Set(lot.flatMap((agent) => agent.files.map((file) => file.path))).size,
      ...(ages.length ? { attenteDepuisMs: Math.max(...ages) } : {}),
      ...(plusUrgent?.task ? { sujet: plusUrgent.task } : {})
    })
  }

  return chantiers.sort(
    (a, b) =>
      rang(a.verdict) - rang(b.verdict) ||
      (b.attenteDepuisMs ?? 0) - (a.attenteDepuisMs ?? 0) ||
      a.branche.localeCompare(b.branche, 'fr')
  )
}

/** Les cinq nombres du bandeau : ils répondent « est-ce que ça avance », pas « que dois-je faire ». */
export function resumerFlux(agents: readonly WorktreeAgentActivity[], nowMs: number): FluxProjet {
  const chantiers = regrouperParChantier(agents, nowMs)
  const compte = (verdict: VerdictChantier): number =>
    chantiers.filter((chantier) => chantier.verdict === verdict).length
  const attentes = chantiers
    .map((chantier) => chantier.attenteDepuisMs)
    .filter((age): age is number => age !== undefined)
  return {
    chantiers: chantiers.length,
    // `aToi` compte les CHANTIERS, pas les runs : c'est le nombre de décisions à prendre.
    aToi: compte('a-toi'),
    pret: compte('pret'),
    enCours: compte('en-cours'),
    aVerifier: compte('a-verifier'),
    interrompus: compte('interrompu'),
    // Compté sur les runs BRUTS et non sur les chantiers : c'est le seul nombre du bandeau qui le fait.
    runsInterrompus: agents.filter((agent) => agent.state === 'interrupted').length,
    ...(attentes.length ? { plusVieilleAttenteMs: Math.max(...attentes) } : {})
  }
}

/** Une durée d'attente lisible sans jargon, arrondie vers le bas : jamais d'attente exagérée. */
export function formatAttente(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${Math.max(minutes, 1)} min`
  const heures = Math.floor(minutes / 60)
  if (heures < 48) return `${heures} h`
  return `${Math.floor(heures / 24)} j`
}
