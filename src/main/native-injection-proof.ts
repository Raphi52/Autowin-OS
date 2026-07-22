import type { BehaviourFile } from './behaviour-files'
import type { NativePreflightTrace } from './activity/native-preflight'

export type InjectionVerdict = 'injected' | 'unproven'
export interface InjectionProof {
  id: string
  verdict: InjectionVerdict
  observedAt?: string
  reason: string
}

/** Compare le contenu complet au payload pré-API redacted, sans le renvoyer au renderer. */
export function proveInjections(
  files: readonly BehaviourFile[],
  contents: ReadonlyMap<string, string>,
  traces: readonly NativePreflightTrace[]
): InjectionProof[] {
  const latest = traces.at(-1)
  if (!latest)
    return files.map((file) => ({
      id: file.id,
      verdict: 'unproven',
      reason: 'Aucune requête native capturée.'
    }))
  const payload = JSON.stringify(latest.request)
  return files.map((file) => {
    const content = contents.get(file.id)?.trim() ?? ''
    if (content.length < 12)
      return {
        id: file.id,
        verdict: 'unproven' as const,
        observedAt: latest.timestamp,
        reason: 'Contenu trop court pour une preuve fiable.'
      }
    if (payload.includes(content))
      return {
        id: file.id,
        verdict: 'injected' as const,
        observedAt: latest.timestamp,
        reason: `Retrouvé dans la requête capturée (${latest.boundary}).`
      }
    return {
      id: file.id,
      verdict: 'unproven' as const,
      observedAt: latest.timestamp,
      reason: 'Absent de la dernière requête capturée ; contexte non corrélé au workspace.'
    }
  })
}
