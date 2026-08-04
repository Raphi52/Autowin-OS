import type { ImportedModel } from '../models'
import type { FabricNodeSummary } from './control-plane'

export interface FabricProductBindings {
  models: ImportedModel[]
}

/** Rend uniquement les ressources locales vérifiées et interdit tout repli implicite. */
export function createFabricProductBindings(summary: FabricNodeSummary): FabricProductBindings {
  if (
    summary.trust !== 'paired' ||
    summary.availability !== 'online' ||
    !summary.lastManifestDigest
  ) {
    return { models: [] }
  }

  return {
    models: summary.resources
      .filter((resource) => resource.modes.includes('local-tools'))
      .map((resource) => ({
        id: `fabric/${summary.nodeId}/${resource.id}`,
        provider: `fabric:${summary.nodeId}:${resource.id}`,
        model: resource.id,
        label: `${resource.displayName} · ${summary.nodeId}`,
        reasoningEfforts: ['none'],
        defaultReasoningEffort: 'none',
        dynamicallyLoaded: true,
        compute: {
          kind: 'fabric',
          nodeId: summary.nodeId,
          resourceId: resource.id,
          mode: 'local-tools',
          policyRef: 'paired-manifest',
          manifestDigest: summary.lastManifestDigest as string,
          fallback: { kind: 'none' }
        }
      }))
  }
}
