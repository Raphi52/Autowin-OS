/**
 * COMPOSITION DU PROMPT, agrégée sur PLUSIEURS appels.
 *
 * Pourquoi (2026-09-12) : la taille de chaque bloc injecté est écrite à chaque appel
 * (`PromptCallRecord.systemBlocks` / `contextBlocks`), mais elle n'était exploitée que PAR APPEL —
 * en étiquette texte dans le journal d'activité, et par `observatory-injection-inventory.ts` pour
 * un seul appel. Personne ne l'ADDITIONNAIT. Or c'est à l'échelle d'une conversation que le
 * gaspillage devient lisible : un bloc qui pèse la moitié du prompt à chaque appel est le seul
 * levier mesurable sur la facture, et il était invisible.
 *
 * Même parti pris que l'inventaire par appel : HONNÊTETÉ SUR LE RESTE. Les caractères du `system`
 * envoyé que AUCUN bloc nommé ne couvre sont comptés dans un poste « non attribué » explicite,
 * jamais fondus dans le total ni devinés à partir du texte.
 */

export interface CompositionCallInput {
  system?: string
  systemBlocks?: ReadonlyArray<{ name?: unknown; chars?: unknown }>
  contextBlocks?: ReadonlyArray<{ name?: unknown; chars?: unknown }>
}

export interface CompositionRow {
  /** Nom du bloc, ou `non attribué` pour le reste anonyme du `system`. */
  name: string
  /** `system` = canal système du provider ; `context` = contexte poussé dans le message user. */
  channel: 'system' | 'context' | 'unattributed'
  /** Total de caractères injectés par ce bloc sur tous les appels. */
  chars: number
  /** Nombre d'appels où ce bloc était présent (≠ nombre total d'appels). */
  calls: number
  /** Moyenne en milliers de caractères par appel où le bloc est présent, 1 décimale. */
  kcharsPerCall: number
  /** Part du total injecté, en pourcentage entier. */
  share: number
}

export interface PromptComposition {
  rows: CompositionRow[]
  /** Nombre d'appels réellement pris en compte (ceux qui portent au moins un caractère injecté). */
  calls: number
  /** Somme de tous les caractères injectés, poste non attribué compris. */
  totalChars: number
  /** Vrai quand chaque caractère de chaque `system` est couvert par un bloc nommé. */
  exhaustive: boolean
}

function positiveInt(valeur: unknown): number {
  const nombre = typeof valeur === 'number' && Number.isFinite(valeur) ? Math.trunc(valeur) : 0
  return nombre > 0 ? nombre : 0
}

const UNATTRIBUTED = 'non attribué'

/**
 * Additionne les blocs par nom sur une série d'appels. Fonction PURE : aucune lecture disque,
 * aucun prix — le coût en dollars dépend du cache et ne se déduit pas d'un nombre de caractères.
 */
export function aggregatePromptComposition(
  calls: ReadonlyArray<CompositionCallInput>
): PromptComposition {
  const cumul = new Map<string, { row: CompositionRow }>()
  let totalChars = 0
  let callsComptes = 0

  const ajoute = (name: string, channel: CompositionRow['channel'], chars: number): void => {
    if (chars <= 0) return
    const cle = `${channel}:${name}`
    const existant = cumul.get(cle)
    if (existant) {
      existant.row.chars += chars
      existant.row.calls += 1
    } else {
      cumul.set(cle, {
        row: { name, channel, chars, calls: 1, kcharsPerCall: 0, share: 0 }
      })
    }
    totalChars += chars
  }

  for (const call of calls) {
    if (!call) continue
    const systemChars = typeof call.system === 'string' ? call.system.length : 0
    let attribues = 0
    for (const bloc of call.systemBlocks ?? []) {
      if (typeof bloc?.name !== 'string') continue
      const chars = positiveInt(bloc.chars)
      attribues += chars
      ajoute(bloc.name, 'system', chars)
    }
    for (const bloc of call.contextBlocks ?? []) {
      if (typeof bloc?.name !== 'string') continue
      ajoute(bloc.name, 'context', positiveInt(bloc.chars))
    }
    // Un bloc peut être déclaré plus GRAND que le `system` final (troncature en aval) : le reste
    // non attribué ne peut pas être négatif.
    ajoute(UNATTRIBUTED, 'unattributed', Math.max(0, systemChars - attribues))
    const aInjecte =
      systemChars > 0 || (call.contextBlocks ?? []).some((bloc) => positiveInt(bloc?.chars) > 0)
    if (aInjecte) callsComptes += 1
  }

  const rows = [...cumul.values()]
    .map(({ row }) => ({
      ...row,
      kcharsPerCall: Math.round((row.chars / row.calls / 1000) * 10) / 10,
      share: totalChars > 0 ? Math.round((row.chars / totalChars) * 100) : 0
    }))
    .sort((a, b) => b.chars - a.chars || a.name.localeCompare(b.name))

  return {
    rows,
    calls: callsComptes,
    totalChars,
    exhaustive: rows.every((row) => row.channel !== 'unattributed')
  }
}
