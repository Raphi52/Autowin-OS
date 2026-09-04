/**
 * LES CANAUX DES FOURNISSEURS DE MODÈLES, sortis de `src/main/index.ts`.
 *
 * Quatre canaux : lancer une connexion, lire le statut d'authentification au chargement de la page
 * Routeur, basculer un fournisseur entre actif et veille, et tester réellement une connexion.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, mêmes
 * refus (fournisseur hors liste, mode inconnu), mêmes bornes de temps. Deux règles de fond que le
 * déplacement ne touche pas :
 *   - le statut au CHARGEMENT reste local et pas cher : `claude`/`kimi`/`gemini` n'y sont sondés
 *     que pour leur PRÉSENCE, jamais déclarés authentifiés sans un test réel ;
 *   - le TEST explicite passe par le superviseur d'exécution, avec un vrai mini-appel borné.
 *
 * La sonde `probeProviderConnection` vient avec eux : le canal de test en était le seul appelant.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardString } from '../ipc-guards'
import { ROUTED_PROVIDERS, type RoutedProvider } from '../routed-providers'
import {
  buildProviderStatuses,
  probePresenceUnlessStandby,
  probeResultStatus
} from '../provider-status'
import { compileExecutionQuote } from '../execution-quote'
import type { AutowinOS } from '../os'
import type { ProviderStateStore, ProviderMode } from '../provider-state-store'

/** Ce que les canaux des fournisseurs prenaient dans `index.ts` — désormais passé explicitement. */
export type ProvidersIpcDeps = {
  os: AutowinOS
  providerStateStore: ProviderStateStore
}

/**
 * Borne du probe de connexion d'un provider. 20 s : c'est un VRAI appel (spawn de CLI + aller-retour
 * réseau), donc largement au-dessus d'une latence normale — la valeur n'est pas là pour accélérer un
 * échec mais pour empêcher un hang de bloquer le préflight indéfiniment.
 */
const PROVIDER_PROBE_TIMEOUT_MS = 20_000

async function probeProviderConnection(
  id: RoutedProvider,
  { os, providerStateStore }: ProvidersIpcDeps
): Promise<{ provider: RoutedProvider; status: ReturnType<typeof probeResultStatus> | 'standby' }> {
  if (providerStateStore.get(id).mode === 'standby') {
    return { provider: id, status: 'standby' }
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const quote = compileExecutionQuote(`provider-probe:${id}`, {
      maxProviderCalls: 1,
      maxTotalTokens: 100_000,
      maxUsd: 0.05
    })
    quote.phases = []
    quote.decomposition = { mode: 'disabled', maxNodes: 1 }
    quote.limits.maxAgents = 0
    quote.limits.maxConcurrency = 1
    quote.limits.maxDurationMs = PROVIDER_PROBE_TIMEOUT_MS
    quote.limits.maxRecoveries = 0
    quote.limits.maxFreshTokens = Math.min(quote.limits.maxFreshTokens, 25_000)
    const timeoutController = new AbortController()
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        const message = `pas de reponse de ${id} apres ${PROVIDER_PROBE_TIMEOUT_MS} ms`
        timeoutController.abort(message)
        reject(new Error(`pas de reponse de ${id} apres ${PROVIDER_PROBE_TIMEOUT_MS} ms`))
      }, PROVIDER_PROBE_TIMEOUT_MS) // sleep-ok: garde-timeout bornant un vrai appel provider (réseau/CLI)
    })
    const result = (await os.executionSupervisor.run(quote, timeoutController.signal, () =>
      Promise.race([
        // Probe minimal : aucun kit système injecté, pour éviter de facturer le contexte applicatif.
        os.registry.send(id, [{ role: 'user', content: 'ping' }], {
          system: '',
          signal: timeoutController.signal
        }),
        timeout
      ])
    )) as { text?: string }
    const text = (result?.text ?? '').toLowerCase()
    const status = /authenticate|oauth|expired|not logged|login/.test(text)
      ? probeResultStatus({ expired: true })
      : probeResultStatus({ ok: true })
    providerStateStore.recordProbe(id, status)
    return { provider: id, status }
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
    const status = /authenticate|oauth|expired|not logged|login/.test(message)
      ? probeResultStatus({ expired: true })
      : probeResultStatus({ errored: true })
    providerStateStore.recordProbe(id, status)
    return { provider: id, status }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

export function registerProvidersIpc({ os, providerStateStore }: ProvidersIpcDeps): void {
  ipcMain.handle('os:providerLogin', (event, provider: unknown) => {
    assertTrustedRendererSender(event, 'Provider login')
    os.startProviderLogin(guardString(provider, 'provider'))
    return { ok: true }
  })
  // Page Routeur — statut d'auth au CHARGEMENT (cheap/local) : claude = présence CLI seulement
  // (JAMAIS « authenticated » sans probe réel). Borné.
  ipcMain.handle('os:providerStatus', async (event) => {
    assertTrustedRendererSender(event, 'Provider status')
    const bounded = (p: Promise<boolean>): Promise<boolean> =>
      Promise.race([
        p.catch(() => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), 4000)) // sleep-ok: garde-timeout bornant auth() (spawn CLI), pas un délai flaky
      ])
    const responds = async (id: string): Promise<boolean> => {
      const state = providerStateStore.get(id)
      return probePresenceUnlessStandby(state, async () => {
        try {
          const adapter = os.registry.get(id) as { auth?: () => Promise<boolean> }
          return adapter.auth ? await bounded(adapter.auth()) : false
        } catch {
          return false
        }
      })
    }
    // Un seul moteur routé : plus aucun spawn de sondage pour les moteurs retirés (Codex, Kimi,
    // Gemini). Leur statut n'était de toute façon plus publié — on payait le spawn pour rien.
    const claudeResponds = await responds('claude')
    return buildProviderStatuses({
      claudeResponds,
      now: Date.now(),
      states: { claude: providerStateStore.get('claude') }
    })
  })
  ipcMain.handle('os:providerMode:set', (event, provider: unknown, mode: unknown) => {
    assertTrustedRendererSender(event, 'Provider mode')
    const id = guardString(provider, 'provider')
    if (!ROUTED_PROVIDERS.includes(id as RoutedProvider)) {
      throw new Error('Provider non supporté.')
    }
    if (mode !== 'active' && mode !== 'standby') throw new Error('Mode provider invalide.')
    return providerStateStore.setMode(id, mode as ProviderMode)
  })
  // Bouton « Tester » — probe RÉEL borné à la demande (claude/kimi) : un vrai mini-tour dont
  // l'erreur d'auth révèle l'expiration. Timeout/exception → unknown (jamais authenticated).
  ipcMain.handle('os:providerTest', async (event, provider: unknown) => {
    assertTrustedRendererSender(event, 'Provider test')
    const id = guardString(provider, 'provider')
    if (!ROUTED_PROVIDERS.includes(id as RoutedProvider)) {
      throw new Error('Provider non supporté.')
    }
    return probeProviderConnection(id as RoutedProvider, { os, providerStateStore })
  })
}
