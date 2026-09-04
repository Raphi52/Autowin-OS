/**
 * Probes RÉELS (main) du diagnostic de démarrage (#4/#5) : ping brain_server, présence des CLI
 * providers, token Brain. Centralisés ici pour être partagés entre le run de démarrage et l'IPC
 * `preflight:recheck` du wizard first-run (#5) — une seule définition, pas de divergence.
 */
import { existsSync } from 'node:fs'
import { amitelBrainOrigin } from './amitel-paths'
import { delimiter, join } from 'node:path'
import { spawn } from 'node:child_process'
import {
  runPreflight,
  type PreflightOptions,
  type PreflightProbes,
  type PreflightResult
} from './preflight'
import { brainServiceToken } from './brain-retrieval'
import { resolveBrainRuntime } from './brain-server-launch'
import { probeClaudeSession } from './claude-session'

/**
 * Resout un executable sur le PATH, SANS l'executer — comme `where`, en pur Node.
 *
 * POURQUOI (bug constate 2026-07-30) : la presence d'un CLI etait testee en LANCANT `<cli> --version`
 * avec un timeout de 3 s. Au demarrage (Electron + Vite + antivirus, plusieurs spawns en parallele) le
 * timeout etait depasse et le wizard annoncait « CLI introuvable » a tort ; un clic sur « Re-verifier »,
 * machine calmee, repassait tout vert — d'ou la popup qui s'affichait toujours puis disparaissait.
 *
 * La presence d'un binaire est une question de SYSTEME DE FICHIERS : y repondre par un lancement de
 * process est a la fois lent et faux sous charge. On lit le PATH (+ PATHEXT sous Windows, ou vivent les
 * shims `.cmd` poses par `npm -g`). Pur et injectable -> testable sans disque.
 */
export function resolveBinOnPath(
  which: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  const raw = env.PATH ?? env.Path ?? ''
  const extensions =
    process.platform === 'win32'
      ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : ['']
  for (const dir of raw.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(dir, `${which}${extension}`)
      if (exists(candidate)) return candidate
    }
  }
  return null
}

export function appPreflightProbes(): PreflightProbes {
  return {
    pingBrain: async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1500) // sleep-ok: timeout d'abort d'un fetch réseau, borne la latence du ping (pas un sleep de polling)
      try {
        // Le corps est lu jusqu'au bout AVANT de lâcher la connexion : couper une réponse
        // à moitié écrite fait lever WinError 10053 côté serveur Brain, qui l'affiche alors
        // comme un traceback au lancement d'Autowin (service pourtant sain).
        /*
         * ORIGINE CONFIGUREE, jamais une adresse ecrite en dur.
         *
         * MESURE DU 2026-09-03 (conv-8) : ce ping visait `127.0.0.1:8765` en dur alors que le
         * service a jour ecoutait 8766 (c'est lui qui porte l'echange de defi du protocole 2). La
         * sonde voyait donc le cerveau ETEINT en permanence — meme quand la lecture du savoir, elle,
         * fonctionnait par `amitelBrainOrigin()`. Consequence observee dans `dev-app-stdout.log` :
         * l'app relancait des serveurs inutiles, qui se posaient sur 8765 et n'y servaient personne.
         * C'est le MEME defaut que celui corrige le 2026-09-02 dans `brain-retrieval` : deux chemins
         * vers le meme service, un seul qui lisait la configuration.
         */
        const res = await fetch(`${amitelBrainOrigin()}/`, { signal: ctrl.signal })
        await res.arrayBuffer()
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
      if (which !== 'claude') return false
      const envBin = process.env[`${which.toUpperCase()}_BIN`]
      if (envBin) return existsSync(envBin)
      // shell:true sur Windows : codex/claude sont installés en shims `.cmd` par npm -g → un spawn
      // sans shell échoue en ENOENT et rapporterait "CLI introuvable" à tort. `which` est
      // whitelisté ci-dessus → shell:true ne peut pas injecter. (Faithful major.)
      return await new Promise<boolean>((resolve) => {
        const probe = spawn(which, ['--version'], {
          windowsHide: true,
          shell: process.platform === 'win32'
        })
        let settled = false
        const finish = (available: boolean): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve(available)
        }
        const timeout = setTimeout(() => {
          probe.kill()
          // Un timeout ne PROUVE PAS l'absence : au demarrage (Electron + Vite + antivirus, plusieurs
          // spawns en parallele) le CLI repond trop tard et on annoncait « introuvable » a tort — d'ou
          // la popup du wizard qui disparaissait des qu'on cliquait « Re-verifier », machine calmee.
          // On tranche alors sur le SYSTEME DE FICHIERS, qui ne depend pas de la charge.
          finish(resolveBinOnPath(which) !== null)
        }, 8000)
        // Idem pour un echec de lancement (shim illisible, shell indisponible) : le disque decide.
        probe.once('error', () => finish(resolveBinOnPath(which) !== null))
        probe.once('close', (code) => {
          // Le libelle de ce controle est « CLI introuvable » : il repond « est-ce INSTALLE ? ».
          // Un `--version` qui sort en code non nul (verrou transitoire, shim capricieux au boot)
          // signale un CLI en mauvais etat, PAS un CLI absent — l'authentification a son propre
          // controle. On ne declare donc « absent » que si le disque ne le trouve pas non plus.
          finish(code === 0 || resolveBinOnPath(which) !== null)
        })
      })
    },
    // `claude auth status` est l'autorité : le store de credentials du CLI n'est pas contractuel.
    claudeSession: () => probeClaudeSession(),
    hasBrainToken: () => brainServiceToken().length > 0,
    // MÊME résolution que le lancement (`resolveBrainRuntime`) : sonder un autre chemin que celui
    // qui sera réellement exécuté produirait un vert qui ne veut rien dire. Chemin vide (pas de
    // LOCALAPPDATA) = rien à affirmer → on ne fabrique pas un rouge.
    hasBrainRuntime: () => {
      const python = resolveBrainRuntime().python
      return python ? existsSync(python) : true
    }
  }
}

// Cache TTL court : déduplique le double-run au 1er lancement (le run de démarrage ET le montage du
// wizard demandent le diagnostic à ~ms d'intervalle → un seul jeu de probes). Le bouton "Re-vérifier"
// passe `force` pour ignorer le cache. (Conformer sobriété.)
const PREFLIGHT_TTL_MS = 5000
let preflightCache: { key: string; at: number; result: PreflightResult } | null = null
let preflightInFlight: { key: string; promise: Promise<PreflightResult> } | null = null
let preflightGeneration = 0

function preflightOptionsKey(options: PreflightOptions): string {
  return [...new Set(options.standbyProviders ?? [])].sort().join(',')
}

export function getLastAppPreflightResult(): PreflightResult | null {
  return preflightCache?.result ?? null
}

export async function runAppPreflight(
  force = false,
  options: PreflightOptions = {}
): Promise<PreflightResult> {
  const now = Date.now()
  const key = preflightOptionsKey(options)
  if (!force && preflightCache?.key === key && now - preflightCache.at < PREFLIGHT_TTL_MS) {
    return preflightCache.result
  }
  if (!force && preflightInFlight?.key === key) return preflightInFlight.promise

  const generation = ++preflightGeneration
  const run = runPreflight(appPreflightProbes(), options).then((result) => {
    if (generation === preflightGeneration) {
      preflightCache = { key, at: Date.now(), result }
    }
    return result
  })
  const tracked = run.finally(() => {
    if (preflightInFlight?.promise === tracked) preflightInFlight = null
  })
  preflightInFlight = { key, promise: tracked }
  return tracked
}

/** Handle de scheduler annulable (injectable en test pour piloter le temps sans vrai timer). */
export interface PreflightSchedulerHandle {
  cancel: () => void
}

export interface PreflightWatchDeps {
  /** Planificateur injectable — défaut: setTimeout. Retourne un handle annulable. */
  schedule?: (fn: () => void, ms: number) => PreflightSchedulerHandle
  /** Exécuteur du preflight — défaut: runAppPreflight. Le 1ᵉʳ tour respecte le cache, les re-probes forcent. */
  run?: (force: boolean, options: PreflightOptions) => Promise<PreflightResult>
}

export interface PreflightWatchOptions extends PreflightOptions {
  /**
   * Backoff (ms) entre re-probes TANT que le check `brain` échoue. Défaut ≈ 118 s cumulés (couvre le
   * warm-up fastembed ~30-40 s sur SMB avec marge). La boucle s'arrête dès `brain` ok ou cap atteint.
   */
  delaysMs?: number[]
}

const DEFAULT_PREFLIGHT_BACKOFF_MS = [3000, 5000, 8000, 12000, 20000, 30000, 40000]

const brainCheckFailing = (r: PreflightResult): boolean =>
  r.checks.some((c) => c.id === 'brain' && !c.ok)

/**
 * Boucle de re-probe BORNÉE du diagnostic de démarrage. Motif : brain_server n'ouvre son port
 * qu'APRÈS le warm-up de fastembed + index (constructeur `BrainRetriever` eager, prouvé côté serveur),
 * donc « port répond ⟹ RAG prêt » — mais un ping unique au lancement échoue pendant les ~30-40 s de
 * warm-up et RESTE figé. Ici on re-sonde en `force` (bypass cache) avec backoff tant que `brain`
 * échoue, et on appelle `onResult` à CHAQUE résultat — y compris la récupération ok qui efface la
 * bannière. On NE s'acharne PAS si le seul échec est non-récupérable (CLI/token, pas brain).
 * Retourne `{ stop }` pour couper la boucle (fermeture fenêtre / quit).
 */
export function watchAppPreflight(
  onResult: (r: PreflightResult) => void,
  options: PreflightWatchOptions = {},
  deps: PreflightWatchDeps = {}
): { stop: () => void } {
  const delays = options.delaysMs ?? DEFAULT_PREFLIGHT_BACKOFF_MS
  const schedule =
    deps.schedule ??
    ((fn, ms): PreflightSchedulerHandle => {
      const t = setTimeout(fn, ms)
      if (typeof t === 'object' && 'unref' in t) t.unref() // ne pas retenir l'event loop à la fermeture
      return { cancel: () => clearTimeout(t) }
    })
  const run = deps.run ?? runAppPreflight
  const preflightOptions: PreflightOptions = { standbyProviders: options.standbyProviders }
  let stopped = false
  let pending: PreflightSchedulerHandle | null = null
  let retries = 0

  const tick = (): void => {
    if (stopped) return
    const isFirst = retries === 0
    void run(!isFirst, preflightOptions)
      .then((result) => {
        if (stopped) return
        onResult(result)
        // On ne re-sonde QUE si `brain` est encore le problème et qu'il reste des essais.
        if (result.ok || !brainCheckFailing(result) || retries >= delays.length) return
        const delay = delays[Math.min(retries, delays.length - 1)]
        retries += 1
        pending = schedule(tick, delay)
      })
      .catch(() => {
        // runAppPreflight ne throw pas (safe interne) ; par prudence, une erreur ne relance pas la boucle.
      })
  }

  tick()
  return {
    stop: () => {
      stopped = true
      pending?.cancel()
      pending = null
    }
  }
}
