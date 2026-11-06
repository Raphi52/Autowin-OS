// Exécution des commandes d'un tour de chat sur le bus, et sa variante qui rend un échec au lieu
// de jeter. Sortie telle quelle de AgentPilot.chat() (lot 2).
import type { AppCommandBus, CommandResult } from '../commands/commands'
import type { RoleBinding } from '../profil/roles'

export type ExecutionDeCommande = (
  name: string,
  args: Record<string, unknown>,
  onProgress?: (text: string) => void
) => Promise<CommandResult>

export function commandesDuTour(entree: {
  bus: Pick<AppCommandBus, 'exec'>
  conversationId: string | undefined
  bindingOverride: RoleBinding | undefined
  turnId: string | undefined
  signal: AbortSignal | undefined
}): { execCommand: ExecutionDeCommande; execCommandTolerante: ExecutionDeCommande } {
  const { bus, conversationId, bindingOverride, turnId, signal } = entree
  const execCommand = (
    name: string,
    args: Record<string, unknown>,
    onProgress?: (text: string) => void
  ): Promise<CommandResult> => {
    /*
     * NE PAS BOURRER LA FIN D'ARGUMENTS `undefined`.
     *
     * L'ajout d'`onProgress` avait rendu l'appel TOUJOURS a six arguments, la queue comblee par
     * des `undefined`. Or `bus.exec` est espionne par onze tests qui asservissent l'appel EXACT --
     * un appel a trois arguments cessait d'en etre un, et la suite du pilote est passee au rouge
     * sur la branche partagee (mesure le 2026-08-25 : 11 echecs, tous des decalages d'arite, aucune
     * regression fonctionnelle).
     *
     * On ne touche donc ni aux assertions ni au comportement : on rend simplement a l'appel sa
     * forme MINIMALE quand il n'y a rien de plus a passer. Un argument optionnel absent ne doit
     * pas s'ecrire.
     */
    const binding = bindingOverride
    if (onProgress) {
      return binding
        ? bus.exec(name, args, conversationId, binding, turnId, onProgress)
        : bus.exec(name, args, conversationId, undefined, turnId, onProgress)
    }
    if (binding) {
      return turnId
        ? bus.exec(name, args, conversationId, binding, turnId)
        : bus.exec(name, args, conversationId, binding)
    }
    return turnId
      ? bus.exec(name, args, conversationId, undefined, turnId)
      : bus.exec(name, args, conversationId)
  }
  /**
   * Une commande qui JETTE est un echec comme un autre — sauf l'annulation.
   *
   * Trouve par l'audit du 2026-08-21 : `execCommand` n'avait aucun try/catch. Un timeout, un gate
   * implemente par un `throw` plutot que par un `{ok:false}`, ou n'importe quelle exception d'un
   * outil faisait remonter l'erreur HORS du tour — sans reprise, sans aveu, sans enregistrement du
   * mur. C'est exactement la classe de cas que ce chantier devait couvrir, et elle passait
   * entierement a cote du mecanisme parce que celui-ci ne regarde que `commandResultSucceeded`.
   *
   * L'ANNULATION, elle, doit continuer a remonter. C'est le piege de ce correctif : elle voyage
   * elle aussi par exception (`signal.throwIfAborted`), et l'avaler ferait repartir l'agent —
   * « corrige la cause et reprends la tache » — sur un travail que l'utilisateur vient d'arreter.
   */
  const estUneAnnulation = (erreur: unknown): boolean =>
    signal?.aborted === true ||
    (typeof erreur === 'object' &&
      erreur !== null &&
      (erreur as { name?: string }).name === 'AbortError')
  const execCommandTolerante = async (
    name: string,
    args: Record<string, unknown>,
    onProgress?: (text: string) => void
  ): Promise<CommandResult> => {
    try {
      return await execCommand(name, args, onProgress)
    } catch (erreur) {
      if (estUneAnnulation(erreur)) throw erreur
      return { ok: false, error: erreur instanceof Error ? erreur.message : String(erreur) }
    }
  }
  return { execCommand, execCommandTolerante }
}
