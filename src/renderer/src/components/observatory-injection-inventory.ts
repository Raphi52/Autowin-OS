import type { PromptCall } from './observatory-view-types'

/**
 * INVENTAIRE DES INJECTIONS d'un appel — ce qu'Autowin a ajouté au prompt, nommé, et ce qui
 * reste NON attribué.
 *
 * Pourquoi (2026-08-31) : l'Observatory affichait le `system` en un seul bloc et le contexte poussé
 * fondu dans le message utilisateur. La décomposition existait pourtant côté main
 * (`PromptCallRecord.systemBlocks`), calculée à chaque appel puis jetée deux fois : par le type
 * `PromptCall` du renderer qui ne la recopiait pas, et par `promptCallToTraceEvents` qui n'en fait
 * pas d'événement. Résultat : une vue qui promet « ce qui part au provider » sans pouvoir dire CE
 * QUI a été injecté ni COMBIEN chaque morceau pèse.
 *
 * Le parti pris de ce module est l'HONNÊTETÉ SUR LE RESTE. Une liste de blocs n'est exhaustive que
 * si la somme de ses tailles couvre le `system` réellement envoyé ; sinon il existe des caractères
 * injectés que personne ne nomme. On les compte et on les affiche comme tels (`unattributed`)
 * plutôt que de présenter une liste partielle comme complète — c'est exactement le défaut que ce
 * module corrige, le reproduire à l'étage du dessus n'aurait aucun sens.
 */

export interface InjectionBlock {
  name: string
  chars: number
  /** `system` = canal système du provider ; `context` = contexte poussé dans le message user. */
  channel: 'system' | 'context'
  /** Part du canal, en pourcentage entier — 0 quand le canal est vide. */
  share: number
}

export interface InjectionInventory {
  blocks: InjectionBlock[]
  systemChars: number
  /** Caractères présents dans le `system` envoyé mais couverts par AUCUN bloc nommé. */
  unattributedChars: number
  /**
   * Vrai seulement si chaque caractère du `system` est attribué à un bloc nommé. Faux dès qu'il
   * reste un octet anonyme — et faux aussi quand un `system` non vide n'a aucun bloc du tout
   * (le cas des sites d'appel qui ne déclarent pas leur décomposition).
   */
  exhaustive: boolean
  /** Aucune injection du tout : ni système, ni contexte. */
  empty: boolean
}

function withShares(
  blocks: Array<{ name: string; chars: number }>,
  channel: 'system' | 'context',
  total: number
): InjectionBlock[] {
  return blocks
    .filter((block) => block && typeof block.name === 'string')
    .map((block) => ({
      name: block.name,
      chars: Math.max(0, Math.trunc(block.chars) || 0),
      channel,
      share: total > 0 ? Math.round((Math.max(0, block.chars || 0) / total) * 100) : 0
    }))
}

/**
 * Compose l'inventaire d'un appel. Ne DÉDUIT rien : ce qui n'est pas déclaré par le site d'appel
 * apparaît en « non attribué », jamais deviné à partir du texte.
 */
export function injectionInventory(call: PromptCall): InjectionInventory {
  const systemChars = call.system?.length ?? 0
  const systemBlocks = withShares(call.systemBlocks ?? [], 'system', systemChars)
  const contextTotal = (call.contextBlocks ?? []).reduce(
    (sum, block) => sum + Math.max(0, block.chars || 0),
    0
  )
  const contextBlocks = withShares(call.contextBlocks ?? [], 'context', contextTotal)
  const attributed = systemBlocks.reduce((sum, block) => sum + block.chars, 0)
  // Un bloc peut être déclaré plus GRAND que le `system` final (troncature en aval) : le reste
  // non attribué ne peut pas être négatif, et un dépassement n'est pas une preuve d'exhaustivité.
  const unattributedChars = Math.max(0, systemChars - attributed)
  return {
    blocks: [...systemBlocks, ...contextBlocks],
    systemChars,
    unattributedChars,
    exhaustive: systemChars === 0 ? contextBlocks.length > 0 : unattributedChars === 0,
    empty: systemChars === 0 && contextBlocks.length === 0
  }
}
