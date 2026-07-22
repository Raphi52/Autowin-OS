/**
 * Probes RÉELS (main) du diagnostic de démarrage (#4/#5) : ping brain_server, présence des CLI
 * providers, token Brain. Centralisés ici pour être partagés entre le run de démarrage et l'IPC
 * `preflight:recheck` du wizard first-run (#5) — une seule définition, pas de divergence.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { runPreflight, type PreflightProbes, type PreflightResult } from './preflight'
import { brainServiceToken } from './brain-retrieval'

export function appPreflightProbes(): PreflightProbes {
  return {
    pingBrain: async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1500) // sleep-ok: timeout d'abort d'un fetch réseau, borne la latence du ping (pas un sleep de polling)
      try {
        await fetch('http://127.0.0.1:8765/', { signal: ctrl.signal })
        return true
      } catch {
        return false
      } finally {
        clearTimeout(t)
      }
    },
    hasBin: async (which) => {
      // Whitelist runtime (défense en profondeur, pas seulement le typage TS) : ne jamais exécuter
      // un binaire arbitraire même si un futur appelant relayait une valeur non contrôlée. (Guardian.)
      if (which !== 'codex' && which !== 'claude') return false
      const envBin = process.env[`${which.toUpperCase()}_BIN`]
      if (envBin) return existsSync(envBin)
      // shell:true sur Windows : codex/claude sont installés en shims `.cmd` par npm -g → un spawnSync
      // nu (sans shell) échoue en ENOENT et rapporterait "CLI introuvable" à tort. `which` est
      // whitelisté ci-dessus → shell:true ne peut pas injecter. (Faithful major.)
      const probe = spawnSync(which, ['--version'], {
        timeout: 3000,
        windowsHide: true,
        shell: process.platform === 'win32'
      })
      return probe.status === 0
    },
    hasBrainToken: () => brainServiceToken().length > 0
  }
}

// Cache TTL court : déduplique le double-run au 1er lancement (le run de démarrage ET le montage du
// wizard demandent le diagnostic à ~ms d'intervalle → un seul jeu de probes). Le bouton "Re-vérifier"
// passe `force` pour ignorer le cache. (Conformer sobriété.)
const PREFLIGHT_TTL_MS = 5000
let preflightCache: { at: number; result: PreflightResult } | null = null

export async function runAppPreflight(force = false): Promise<PreflightResult> {
  const now = Date.now()
  if (!force && preflightCache && now - preflightCache.at < PREFLIGHT_TTL_MS) {
    return preflightCache.result
  }
  const result = await runPreflight(appPreflightProbes())
  preflightCache = { at: now, result }
  return result
}
