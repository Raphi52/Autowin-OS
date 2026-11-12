/**
 * Projections de l'état de l'OS vers les instantanés (`AppSnapshot`, `PromptSnapshot`).
 *
 * Code libre sorti de `commands.ts` tel quel (lot 5) ; `commands.ts` ré-exporte ce qu'il
 * exportait déjà, ses importeurs ne changent pas. Dans `commands/`, une VALEUR s'importe d'ici,
 * jamais par `'../commands'` (cycle d'import) : `commands/code-libre.test.ts` le garde.
 *
 * Les fonctions qui prennent le bus (`snapshot`, `snapshotForPrompt` et leurs aides) sont des méthodes de
 * `AppCommandBus` sorties telles quelles (lot 6) ; la classe garde une méthode mince du même nom.
 */

import { tachesDeFondEnCours } from '../providers/taches-de-fond-suivies'
import type { AppSnapshot, PromptSnapshot } from './types'
import type { AppCommandBus } from './commands'
import { pendantOperation } from '../gel/gel-main'
import { skillsInvocables } from './skills'
import { listerCles } from '../app/coffre-cles'
import { LEGENDE_RUNS_NON_EXAMINES } from '../dashboards/runs-scan'

/** Projette le statut budget de l'OS sur les trois champs honnêtes du snapshot. */
export function budgetSnapshot(status: {
  pricedSpendUsd: number
  unpricedTurns?: number
  spentIsPartial?: boolean
}): Pick<AppSnapshot, 'budgetUsd' | 'budgetUnpricedTurns' | 'budgetIsPartial'> {
  const unpriced = status.unpricedTurns ?? 0
  return {
    budgetUsd: status.pricedSpendUsd,
    budgetUnpricedTurns: unpriced,
    budgetIsPartial: status.spentIsPartial ?? unpriced > 0
  }
}

/**
 * Le champ `clesDuCoffre` : les NOMS triés, rien d'autre. `listerCles` ne rend déjà ni valeur ni
 * morceau de valeur ; on n'en garde que le nom pour que la longueur ne voyage pas non plus.
 */
export function clesDuCoffrePourLePrompt(): Pick<PromptSnapshot, 'clesDuCoffre'> {
  const noms = listerCles()
    .map((cle) => cle.nom)
    .sort()
  return noms.length > 0 ? { clesDuCoffre: noms } : {}
}

/** Le champ `tachesDeFondSuiviesParAutowin`, ou rien quand aucune tâche relancée ne tourne. */
export function tachesDeFondPourLePrompt(): Pick<PromptSnapshot, 'tachesDeFondSuiviesParAutowin'> {
  const taches = tachesDeFondEnCours()
  if (taches.length === 0) return {}
  return {
    tachesDeFondSuiviesParAutowin: {
      consigne:
        'Ces commandes de fond ont été relancées par Autowin et TOURNENT encore. Si le CLI te dit ' +
        'qu’une tâche s’est arrêtée « before the previous session ended », c’est sa copie à lui. ' +
        'Le résultat de celle d’Autowin reviendra dans ce fil par un tour de reprise automatique : ' +
        'ne la relance pas, n’en lance pas une seconde pour surveiller la même chose.',
      taches: taches.map((t) => ({
        conversationId: t.conversationId,
        tache: t.tache,
        commande: t.commande.length > 300 ? `${t.commande.slice(0, 300)}…` : t.commande,
        depuis: new Date(t.depuis).toISOString()
      }))
    }
  }
}

/**
 * Marqueur de sous-jalons du snapshot. Optionnel : absent, le snapshot se comporte exactement
 * comme avant. Présent (chemin chaud du chat), il IMPUTE le temps à la lecture responsable —
 * `snapshot` seul disait « c'est lent » sans jamais dire OÙ.
 */
export async function snapshot(bus: AppCommandBus, jalon?: (nom: string) => void): Promise<AppSnapshot> {
  const runs = await bus.os.runsWithGate()
  jalon?.('snapshot:runs')
  return {
    tab: bus.tab,
    activeConversationId: bus.activeConversationId,
    providers: bus.os.registry.ids(),
    roles: bus.os.roles.all(),
    // Les 12 plus récents pour l'affichage, mais un run BLOQUÉ lu plus loin dans la fenêtre n'est
    // jamais coupé : `runsBlocked` filtre CETTE liste, et la coupe à 12 le faisait disparaître.
    runs: runs
      .filter((r, i) => i < 12 || r.blocked)
      .map((r) => ({
        subject: r.subject,
        status: r.summary.status,
        blocked: r.blocked,
        ...(r.summary.decisionAttendue ? { decisionAttendue: true as const } : {})
      })),
    // Seulement les RUN.md qui demandent encore un regard ; le total reste au Board (`runsNonOuverts`).
    // Absent tant que le premier calcul n'est pas fini ; un compte nul (0) est servi tel quel.
    // fix-ok: cause mesurée — un test de vérité (`? :`) jetait le 0 : « rien à regarder » devenait « pas encore calculé ».
    ...(runs.horsFenetreARegarder !== undefined
      ? { runsNonExamines: runs.horsFenetreARegarder }
      : {}),
    // Worktrees encore vivants côté Autowin : ce qui n'y figure plus a été nettoyé/fermé. C'est LA
    // sonde qui manquait pour répondre « le workspace s'est fermé ? » sans hausser les épaules.
    worktrees: bus.jalonne(jalon, 'snapshot:worktrees', () =>
      (bus.os.getWorktreeActivity?.() ?? []).map((w) => ({
        workspacePath: w.workspacePath ?? w.worktreePath ?? '',
        state: String(w.state),
        ...(w.conversationId ? { conversationId: w.conversationId } : {})
      }))
    ),
    // La variante BORNEE (cache 60 s, six entrees) — jamais celle sans borne, reservee au geste
    // explicite de l'utilisateur : `snapshotForPrompt()` passe ici a CHAQUE tour d'agent, et le
    // recensement complet coute 76 processus git / 10,4 s sur ce depot (mesure du 2026-08-26).
    // Absent = rien n'attend : un tableau vide, jamais `undefined`.
    travauxNonPublies: bus.jalonne(
      jalon,
      'snapshot:travauxNonPublies',
      () => bus.os.travauxNonPubliesBornes?.() ?? []
    ),
    ...budgetSnapshot(bus.os.budget()),
    // EN DERNIER, toujours : c'est la seule liste sans borne (908 fils le 2026-10-22). Placee en
    // tete, elle faisait depasser les 120 000 caracteres de `resultat-de-commande-borne.ts` et la
    // coupe emportait `travauxNonPublies`, jamais lu. Ici, la coupe ne retire que les
    // fils les plus anciens.
    // La date du dernier message utilisateur vient du résumé, pas des messages : un fil archivé n'aura
    // plus ses messages en mémoire, et son résumé doit suffire à la photo.
    conversations: bus.os.conversations
      .listResumes()
      // Le nom `category` de CETTE sortie est un contrat d'agent : il reste, sa source devient
      // `provider` (les deux valeurs etaient toujours egales).
      .map((c) => ({
        id: c.id,
        title: c.title,
        category: c.provider,
        updatedAt: c.updatedAt,
        ...(c.lastUserMessageAt !== undefined ? { lastUserMessageAt: c.lastUserMessageAt } : {}),
        ...(bus.tourDeChatActif?.(c.id) ? { tourEnCours: true } : {})
      }))
  }
}

/** Exécute `lecture` puis pose le jalon : le temps mesuré est celui de CETTE lecture. */
export function jalonne<T>(jalon: ((nom: string) => void) | undefined, nom: string, lecture: () => T): T {
  /*
   * L'operation est DECLAREE au detecteur de gel avant d'etre jouee. C'est ce qui permet a un
   * « ce programme ne repond pas » d'etre ATTRIBUE a une lecture nommee plutot que deduit : si la
   * boucle d'evenements se fige ici, le battement du main journalise CE nom.
   */
  return pendantOperation(nom, () => {
    const valeur = lecture()
    jalon?.(nom)
    return valeur
  })
}

export function travauxNonAnnonces(
  bus: AppCommandBus,
  travaux: Array<{ agentId: string; date: string; fichiers: string[] }>
): Array<{ agentId: string; date: string; fichiers: string[] }> {
  const nouveaux = travaux.filter((travail) => !bus.travauxDejaAnnonces.has(travail.agentId))
  for (const travail of nouveaux) bus.travauxDejaAnnonces.add(travail.agentId)
  return nouveaux
}

/** Version réduite pour l'injection prompt — voir {@link PromptSnapshot}. */
export async function snapshotForPrompt(bus: AppCommandBus, jalon?: (nom: string) => void): Promise<PromptSnapshot> {
  const full = await bus.snapshot(jalon)
  return {
    tab: full.tab,
    activeConversationId: full.activeConversationId,
    providers: full.providers,
    runsBlocked: full.runs
      .filter((r) => r.blocked)
      .map((r) => ({
        subject: r.subject,
        status: r.status,
        ...(r.decisionAttendue ? { decisionAttendue: true as const } : {})
      })),
    // Le nombre voyage avec sa légende : seul, `runsNonExamines: 128` se lit « 128 non examinés ».
    ...(full.runsNonExamines !== undefined
      ? { runsNonExamines: full.runsNonExamines, runsNonExaminesLegende: LEGENDE_RUNS_NON_EXAMINES }
      : {}),
    conversationsCount: full.conversations.length,
    ...(skillsInvocables().length > 0 ? { skillsDisponibles: skillsInvocables() } : {}),
    ...clesDuCoffrePourLePrompt(),
    ...(bus.travauxNonAnnonces(full.travauxNonPublies).length > 0
      ? {
          travauxNonFusionnes: {
            compte: full.travauxNonPublies.length,
            consigne:
              `${full.travauxNonPublies.length} travail(aux) terminé(s) ne sont PAS dans la base. ` +
              'Invoque le skill `git` pour les trier un par un (fusionner / jeter / laisser) : ' +
              'il juge sur le CONTENU, car le plus souvent le travail est déjà présent sous une ' +
              'autre implémentation. Ne conclus JAMAIS « rien à fusionner » sans l’avoir fait — un ' +
              '`git status` dans l’arbre principal ne voit pas ces copies isolées. ' +
              // Cette liste a déjà été prise pour le périmètre entier : quatre `/salvage` de suite
              // le 2026-09-02, parce que deux remises de côté vieilles d'un jour — dont une portant
              // un vrai bug — n'étaient citées nulle part ici. Un compte de N cadre le balayage à N
              // si on ne dit pas le contraire.
              'Cette liste est un POINT DE DÉPART, pas le périmètre : le skill balaye AUSSI les ' +
              'remises de côté (`git stash`), les copies orphelines et les branches jamais ' +
              'fusionnées. Termine le balayage entier dans la MÊME passe — ne rends pas la main ' +
              'sur une cachette repérée mais non triée.',
            apercu: full.travauxNonPublies
          }
        }
      : {}),
    ...tachesDeFondPourLePrompt()
  }
}
