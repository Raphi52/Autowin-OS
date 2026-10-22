import { readFileSync, writeFileSync } from 'node:fs'
import type { OrchestrationStep } from '../orchestrator'

/**
 * LE PLAN DU BUILD, RELISIBLE DANS LE RUN.md (conv-1083, 2026-10-22).
 *
 * Le décomposeur (`greedy-decompose.ts`) rend un graphe de sous-tâches et leurs dépendances, et le
 * build les exécute dès que leurs dépendances ont rendu (`greedy-scheduler.ts`). Seul « plan de N
 * sous-tâches » arrivait pourtant à l'écran : impossible de relire le découpage avant le code, ni de
 * voir où en est chaque sous-tâche. Cette section le pose dans le RUN.md AVANT le build, rangé par
 * vagues, et la met à jour à chaque étape.
 */

export interface SousTachePlan {
  id: string
  /** Première ligne de la consigne, bornée : le RUN.md se relit, il ne recopie pas les prompts. */
  consigne: string
  deps: string[]
}

export type EtatSousTache = 'à faire' | 'faite' | 'échouée' | 'sautée'

const LONGUEUR_CONSIGNE = 160

/** Première ligne non vide de la consigne remise au sous-agent, bornée. */
export function resumeConsigne(prompt: string): string {
  const ligne = prompt.split(/\r?\n/).find((l) => l.trim()) ?? ''
  const nette = ligne.trim().replace(/\s+/g, ' ')
  return nette.length > LONGUEUR_CONSIGNE ? `${nette.slice(0, LONGUEUR_CONSIGNE - 1)}…` : nette
}

/**
 * Vagues = ordre AU PLUS TÔT : une sous-tâche est dans la vague qui suit la plus tardive de ses
 * dépendances. Le build n'attend pas la vague entière (une sous-tâche part dès que SES dépendances
 * ont rendu) ; la vague dit seulement ce qui peut tourner ensemble.
 * Une dépendance inconnue ou un cycle ne reçoit aucune vague : le planificateur refuserait ce plan.
 */
export function vaguesDuPlan(plan: readonly SousTachePlan[]): {
  vagues: SousTachePlan[][]
  nonOrdonnables: SousTachePlan[]
} {
  const vagues: SousTachePlan[][] = []
  const places = new Set<string>()
  let restants = [...plan]
  while (restants.length > 0) {
    const prets = restants.filter((n) => n.deps.every((d) => places.has(d)))
    if (prets.length === 0) break
    vagues.push(prets)
    for (const n of prets) places.add(n.id)
    restants = restants.filter((n) => !places.has(n.id))
  }
  return { vagues, nonOrdonnables: restants }
}

/** La dernière issue de chaque sous-tâche, lue sur les étapes du build découpé. */
export function etatsDesSousTaches(
  plan: readonly SousTachePlan[],
  steps: readonly OrchestrationStep[]
): Map<string, EtatSousTache> {
  const etats = new Map<string, EtatSousTache>(plan.map((n) => [n.id, 'à faire']))
  for (const step of steps) {
    const taskId = step.execution?.taskId
    if (step.step !== 'exec' || !taskId || !etats.has(taskId)) continue
    if (!step.execution?.groupId?.endsWith(':greedy')) continue
    if (step.status === 'completed') etats.set(taskId, 'faite')
    // Le planificateur saute l'aval d'un échec : ce n'est pas un échec de plus (orchestrator.ts).
    else if (/sautée/.test(step.error ?? '')) etats.set(taskId, 'sautée')
    else if (step.status) etats.set(taskId, 'échouée')
  }
  return etats
}

function ligne(n: SousTachePlan, etat: EtatSousTache): string {
  const apres = n.deps.length ? ` (après ${n.deps.join(', ')})` : ''
  return `- [${etat === 'faite' ? 'x' : ' '}] ${n.id} · ${n.consigne}${apres} — ${etat}`
}

export function sectionPlan(
  plan: readonly SousTachePlan[],
  etats: ReadonlyMap<string, EtatSousTache>
): string {
  const { vagues, nonOrdonnables } = vaguesDuPlan(plan)
  const etat = (n: SousTachePlan): EtatSousTache => etats.get(n.id) ?? 'à faire'
  const blocs = vagues.map(
    (vague, i) => `### Vague ${i + 1}\n${vague.map((n) => ligne(n, etat(n))).join('\n')}`
  )
  if (nonOrdonnables.length) {
    blocs.push(
      `### Non ordonnables (dépendance inconnue ou circulaire)\n${nonOrdonnables
        .map((n) => ligne(n, etat(n)))
        .join('\n')}`
    )
  }
  return `## Plan
Découpage du build en ${plan.length} sous-tâches. Chacune part dès que ses dépendances ont rendu ; une vague regroupe ce qui peut tourner ensemble. État mis à jour à chaque étape.

${blocs.join('\n\n')}
`
}

/** Remplace la section `## Plan` si elle existe, sinon la pose juste avant `## Journal`. */
export function placerSectionPlan(md: string, section: string): string {
  const existante = /(^|\n)## Plan\n[\s\S]*?(?=\n## |$)/
  if (existante.test(md))
    return md.replace(existante, (_m, debut: string) => `${debut}${section.trimEnd()}\n`)
  const journal = md.search(/(^|\n)## Journal\b/)
  if (journal < 0) return `${md.trimEnd()}\n\n${section}`
  const coupe = md[journal] === '\n' ? journal + 1 : journal
  return `${md.slice(0, coupe)}${section}\n${md.slice(coupe)}`
}

/**
 * Pose ou rafraîchit la section du plan à partir des étapes du run. Sans découpage (tâche atomique,
 * plan de moins de 2 sous-tâches), rien n'est écrit. Au mieux : un RUN.md illisible ne casse pas le run.
 */
export function mettreAJourPlanDuRun(runPath: string, steps: readonly OrchestrationStep[]): void {
  const plan = [...steps]
    .reverse()
    .find((s) => s.role === 'decompose' && (s.plan?.length ?? 0) >= 2)?.plan
  if (!plan) return
  try {
    const md = readFileSync(runPath, 'utf8')
    const suivant = placerSectionPlan(md, sectionPlan(plan, etatsDesSousTaches(plan, steps)))
    if (suivant !== md) writeFileSync(runPath, suivant, 'utf8')
  } catch {
    /* au mieux, comme populateConvRunSections : le plan manque, le run continue */
  }
}
