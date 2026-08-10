import type { HarnessTimelineEvent } from './harness-timeline-model'
import { extractHumanMessage } from './human-message'

/**
 * Apercus et parsing d'evenements de la vue Observatory — extraits d'`ObservatoryView.tsx` le
 * 2026-08-07.
 *
 * Aucune de ces fonctions ne dependait de React : elles vivaient pourtant dans un composant de
 * ~1500 lignes ou elles n'etaient verifiables qu'en montant le DOM entier. Ce sont pourtant elles qui
 * decident de ce que l'utilisateur LIT d'un evenement — la logique la plus visible de la vue etait
 * la moins testable.
 */

export function eventTurnId(event: HarnessTimelineEvent): string {
  if (!event.raw || typeof event.raw !== 'object') return ''
  const turnId = (event.raw as { turnId?: unknown }).turnId
  return typeof turnId === 'string' ? turnId : ''
}

/** Sépare un préfixe libellé ("ÉTAT DE L'APP: {…}") du JSON qui suit, si le JSON parse. */
export function splitLabeledJson(content: string): { prefix: string; json: string } | null {
  const start = content.search(/[{[]/)
  if (start < 0) return null
  const json = content.slice(start).trim()
  try {
    JSON.parse(json)
  } catch {
    return null
  }
  return { prefix: content.slice(0, start).trim(), json }
}

// `extractHumanMessage` vit désormais dans `human-message.ts` : la vue Sous-agents affrontait le même
// contenu composé et affichait le JSON d'état en titre. Deux copies auraient divergé à la première
// évolution du format de tour.

/** Tente de parser le contenu JSON d'un événement ; null si ce n'est pas du JSON objet. */
export function parseEventJson(content: string): Record<string, unknown> | null {
  const trimmed = (content ?? '').trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const value = JSON.parse(trimmed)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** Aperçu HUMAIN d'un événement selon son type (retry/frontière lisibles ; sinon message ou brut). */
export function humanEventPreview(kind: string, content: string, max = 140): string {
  const data = parseEventJson(content)
  if (kind === 'retry' && data) {
    const attempt = Number(data.attempt ?? data.attemptNumber ?? 0)
    const maxAttempts = Number(data.maxAttempts ?? data.max ?? 0)
    const reason = typeof data.reason === 'string' ? ` — ${data.reason}` : ''
    if (attempt && maxAttempts)
      return `Nouvel essai · tentative ${attempt} sur ${maxAttempts}${reason}`
    return `Nouvel essai${reason}`
  }
  if (kind === 'boundary' && data) {
    const parts: string[] = []
    if ('stream' in data) parts.push(data.stream ? 'streaming' : 'sans streaming')
    if (typeof data.reasoningEffort === 'string')
      parts.push(
        data.reasoningEffort === 'none' ? 'effort par défaut' : `effort ${data.reasoningEffort}`
      )
    if ('resumed' in data) parts.push(data.resumed ? 'session réutilisée' : 'nouvelle session')
    if (typeof data.model === 'string') parts.push(`modèle ${data.model}`)
    // Clés restantes non couvertes, pour ne rien cacher.
    for (const [k, v] of Object.entries(data)) {
      if (['stream', 'reasoningEffort', 'resumed', 'model'].includes(k)) continue
      if (v != null && typeof v !== 'object') parts.push(`${k} : ${v}`)
    }
    if (parts.length) {
      const text = `Passage au provider · ${parts.join(' · ')}`
      return text.length > max ? `${text.slice(0, max)}…` : text
    }
  }
  if (kind === 'cancellation' && data) {
    const reason = typeof data.reason === 'string' ? data.reason : ''
    if (reason === 'user') return 'Annulé par l’utilisateur'
    return reason ? `Annulé — ${reason}` : 'Annulé'
  }
  // Filet générique : tout objet JSON restant → « clé : valeur · … » (jamais de JSON brut).
  if (data) {
    const pairs = Object.entries(data)
      .filter(([, v]) => v != null && typeof v !== 'object')
      .map(([k, v]) => `${k} : ${v}`)
    if (pairs.length) {
      const text = pairs.join(' · ')
      return text.length > max ? `${text.slice(0, max)}…` : text
    }
  }
  return extractHumanMessage(content, max)
}

/** Aperçu du dernier message humain d'un appel (liste + détail). */
export function lastUserMessagePreview(
  messages: Array<{ role: string; content: string }>,
  max = 100
): string {
  const userMsg = [...messages].reverse().find((m) => m.role === 'user')
  return userMsg ? extractHumanMessage(userMsg.content, max) : ''
}

/** Refuse les enveloppes provider : elles ne constituent pas une action humaine observable. */
export function trustworthyRagTrigger(content: string, max = 180): string {
  const trimmed = content.trim()
  if (
    !trimmed ||
    trimmed.length > 500 ||
    /^[{[]/.test(trimmed) ||
    /"(?:instructions|messages|model)"\s*:/.test(trimmed)
  ) {
    return ''
  }
  return extractHumanMessage(trimmed, max)
}
