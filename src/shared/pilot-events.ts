/**
 * Le vocabulaire des évènements du pilote — SOURCE UNIQUE, partagée par le main et le renderer.
 *
 * Pourquoi ce fichier existe : la liste des `kind` était écrite DEUX FOIS à la main, dans
 * `src/main/agent-pilot.ts` et dans `src/renderer/src/components/ChatView.tsx`, et elle avait déjà
 * DÉRIVÉ — le main émettait `reasoning` et `prompt-call`, absents de la liste du renderer. Comme la
 * frontière IPC fait un cast non vérifié (`raw as PilotEvent`), rien ne signalait l'écart : le
 * renderer se contentait de ne jamais reconnaître ces deux évènements.
 *
 * Ce qui est mis en commun est le VOCABULAIRE, pas la forme complète. Les deux côtés lisent
 * légitimement des champs différents (le renderer n'a que faire de `prompt`/`callUsage`), et le type
 * large du main dépend de `PromptEnvelope`/`Usage` qui vivent dans `src/main/providers` : les faire
 * descendre ici pour unifier la forme entière échangerait une dérive contre une inversion de couches.
 */
export type PilotEventKind =
  | 'delta'
  | 'stream-reset'
  | 'think'
  /** Raisonnement LIVE du modèle pendant qu'il réfléchit — affiché, jamais persisté. */
  | 'reasoning'
  | 'command'
  | 'result'
  | 'done'
  | 'error'
  | 'retry'
  | 'cancellation'
  | 'prompt-call'
  | 'artifact'
