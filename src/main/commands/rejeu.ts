/**
 * Empreinte d'un appel, registre des rejeux du tour et arguments caviardés pour la trace.
 *
 * Code libre sorti de `commands.ts` tel quel (lot 5) ; `commands.ts` ré-exporte ce qu'il
 * exportait déjà, ses importeurs ne changent pas. Dans `commands/`, une VALEUR s'importe d'ici,
 * jamais par `'../commands'` (cycle d'import) : `commands/code-libre.test.ts` le garde.
 */

import { createHash } from 'node:crypto'
import { redactTrace } from '../../shared/trace-redact'

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)])
  )
}

export function actionFingerprint(
  name: string,
  args: Record<string, unknown>,
  scope?: { conversationId?: string }
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue({ name, args, scope })), 'utf8')
    .digest('hex')
}

/** Ce que le registre du tour retient d'un appel déjà émis. */
export interface RejeuConnu {
  /** Nombre de fois que cette empreinte exacte a été émise dans le tour, rejeu compris. */
  occurrences: number
  /** L'appel précédent s'est-il soldé par un refus ? Seul ce cas fait refuser une ré-émission. */
  refuse: boolean
}

/**
 * Outils dont un rejeu APRÈS REFUS est refusé sèchement : réémettre la même écriture qui vient
 * d'être rejetée ne peut produire que le même rejet. Les lectures et les observations, elles, ne
 * sont jamais bloquées — voir `registreDuTour`.
 */
export const OUTILS_REFUSES_SI_REJEU_APRES_ECHEC = new Set(['edit_file'])

/**
 * Attache au résultat la note qui dit au modèle qu'il vient de REJOUER un appel identique.
 *
 * On ne remplace ni n'enveloppe le résultat : on AJOUTE une clé. Envelopper aurait changé la forme
 * de `data` pour tous les consommateurs existants — un correctif d'observabilité n'a pas à casser
 * les lecteurs de champs. Conséquence assumée : un résultat qui n'est pas un objet simple (chaîne,
 * tableau, nombre) ne peut pas porter la note et repart tel quel.
 */
export function avecNoteDeRejeu(data: unknown, dejaVu: RejeuConnu | undefined, name: string): unknown {
  if (!dejaVu || !data || typeof data !== 'object' || Array.isArray(data)) return data
  return {
    ...(data as Record<string, unknown>),
    avertissementRejeu:
      `Tu as déjà émis ce même \`${name}\` avec des arguments identiques dans ce tour ` +
      `(${dejaVu.occurrences}e fois). Si tu attendais un résultat différent, c'est que rien ne l'a ` +
      'fait changer entre-temps : agis sur la cause au lieu de relire.'
  }
}

export function redactedArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === 'orchestrate') return { task: '[redacted]' }
  if (name === 'attach_run') return { path: '[redacted]', conversationId: '[redacted]' }
  if (name === 'chat_send')
    return { message: '[redacted]', provider: args.provider, role: args.role }
  if (name === 'edit_file') {
    return {
      path: args.path,
      oldText: '[REDACTED]',
      newText: '[REDACTED]'
    }
  }
  // Un mot de passe peut passer par la frappe — seul son nombre de caractères est gardé.
  // Même règle pour la saisie dans le navigateur intégré (lot 4/5).
  if (
    (name === 'bureau_cache_agir' || name === 'navigateur_agir') &&
    typeof args.texte === 'string'
  )
    return redactTrace({ ...args, texte: `[${args.texte.length} caractères]` }) as Record<
      string,
      unknown
    >
  return redactTrace(args) as Record<string, unknown>
}
