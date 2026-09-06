import {
  assertTraceEvent,
  decisionDAutorite,
  type TraceAuthorityReceipt,
  type TraceEventV1
} from './trace-event'

/**
 * LE RECU D'AUTORITE D'UNE COMMANDE — enfin EMIS.
 *
 * DEFAUT VECU, mesure le 2026-09-06 : l'enveloppe `authority` etait entierement definie et
 * VALIDEE par `trace-event.ts`, la piste « Ancienne autorite & mutations » etait rendue par
 * `ObservatoryView.tsx`, et deux fichiers de test la fabriquaient a la main — mais AUCUN code de
 * production ne l'ecrivait jamais. La piste ne s'affichait donc dans aucune conversation reelle,
 * et la sonde du chemin critique echouait sur `authority: null` en croyant a un defaut d'affichage.
 * Un contrat verifie de bout en bout dont personne n'emet la donnee est un contrat mort.
 *
 * D'OU VIENT LE RISQUE : des annotations DECLAREES par la commande (`CommandSpec.annotations`),
 * jamais d'une devinette sur son nom. Une commande sans annotation est traitee comme MUTANTE :
 * le defaut prudent est de sur-declarer le risque, jamais de le sous-declarer.
 */
export function receiptFromAnnotations(
  annotations: { readOnlyHint: boolean; destructiveHint: boolean } | undefined,
  mode: TraceAuthorityReceipt['mode']
): TraceAuthorityReceipt {
  const mutates = annotations ? !annotations.readOnlyHint : true
  const commandAuthority: TraceAuthorityReceipt['commandAuthority'] = annotations?.destructiveHint
    ? 'destructive'
    : mutates
      ? 'sensitive'
      : 'automatic'
  return {
    mode,
    commandAuthority,
    mutates,
    decision: decisionDAutorite({ mode, mutates, authority: commandAuthority })
  }
}

export function authorityReceiptToTraceEvent(input: {
  id: string
  conversationId: string
  turnId: string
  parentId?: string
  timestamp: string
  sequence: number
  command: string
  annotations?: { readOnlyHint: boolean; destructiveHint: boolean }
  mode: TraceAuthorityReceipt['mode']
}): TraceEventV1 {
  const base = receiptFromAnnotations(input.annotations, input.mode)
  /*
   * LE CAS DESTRUCTIF, sans lequel le recu manquait la ou il compte le plus.
   *
   * Mesure du 2026-09-06 : pour une commande a la fois MUTANTE et DESTRUCTIVE (`remove_conversation`,
   * `remove_conversations`, `edit_file`, `desktop_act`), la politique impose la decision « confirm ».
   * Le contrat exige alors un identifiant de decision ET son issue ; sans eux `assertTraceEvent`
   * REFUSE l'evenement. L'appelant avalant l'erreur dans un `catch`, le recu n'etait tout simplement
   * jamais ecrit pour les quatre commandes les plus a risque — un trou muet, exactement a l'endroit
   * ou la piste d'autorite existe.
   *
   * L'issue est renseignee, pas inventee : dans Autowin l'autorisation vient des messages de
   * L'UTILISATEUR (cf. `autorisation-commande.ts`), et une action destructive s'execute directement
   * sous cette autorite — c'est donc une approbation de l'utilisateur, jamais un defaut de delai.
   * Aucune regle n'est desserree : la decision reste « confirm », on cesse seulement de perdre le recu.
   */
  const authority: TraceAuthorityReceipt =
    base.decision === 'confirm'
      ? {
          ...base,
          decisionId: `${input.id}:decision`,
          resolution: 'approve',
          resolvedBy: 'user'
        }
      : base
  return assertTraceEvent({
    schema: 'autowin.trace/v1',
    id: input.id,
    conversationId: input.conversationId,
    turnId: input.turnId,
    parentId: input.parentId,
    timestamp: input.timestamp,
    sequence: input.sequence,
    // Les quatre valeurs ci-dessous ne sont PAS libres : `assertTraceEvent` refuse l'enveloppe
    // `authority` en dehors de cette combinaison exacte.
    type: 'decision',
    status: 'completed',
    actor: { id: 'autowin-authority', kind: 'system', label: 'Autorite Autowin' },
    recipient: { id: input.command, kind: 'tool', label: input.command },
    channel: 'internal',
    payloads: [
      {
        kind: 'reasoning',
        content: `${input.command} — mutation ${authority.mutates ? 'oui' : 'non'}, risque ${authority.commandAuthority}, decision ${authority.decision}`
      }
    ],
    observation: { boundary: 'app-command-bus', fidelity: 'exact' },
    authority
  })
}
