/**
 * DÉTECTION au démarrage d'un Brain `degraded` (index périmé) et RÉINDEXATION automatique.
 *
 * Mesure du 2026-09-04 : le service répondait, donc la sonde de démarrage (`pingBrain`, un simple
 * GET `/`) le voyait VERT — alors que `/health` rendait 503 `state: "degraded"` avec la raison
 * « index freshness mismatch ». Conséquence : les questions au Brain revenaient vides et il fallait
 * relancer `brain_index.py` À LA MAIN. Un ping binaire ne peut pas voir cet état : il faut lire
 * `/health`, qui exige le jeton de service.
 *
 * Deux gardes portées ici, et nulle part ailleurs :
 * - on ne réindexe QUE sur un état `degraded` dont une raison parle de fraîcheur d'index (une autre
 *   panne ne se répare pas en reconstruisant un index, et reconstruire coûte plusieurs minutes sur
 *   le partage réseau) ;
 * - une seule reconstruction à la fois, et plus aucune dans la session après deux échecs d'affilée
 *   (`resetBrainIndexRefreshAttempt` remet à zéro, pour les tests). Une reconstruction RÉUSSIE,
 *   elle, n'empêche pas la suivante : toute modification du savoir en cours de session passe par
 *   `reindexerApresMutation` (mesuré le 2026-09-29 : sans cela, le Brain restait muet jusqu'au
 *   prochain démarrage).
 *
 * `brain_index.py` est lancé SANS shell : ses arguments contiennent des espaces (« Projets IA/Amitel
 * Brain ») et passer par `cmd /c start` coupait la ligne au premier espace — l'essai à la main du
 * 2026-09-04 a échoué exactement là.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { amitelBrainOrigin } from './amitel-paths'
import { brainServiceToken } from './brain-retrieval'
import { resolveBrainRuntime } from './brain-server-launch'

export interface BrainHealth {
  state: 'healthy' | 'degraded' | 'unavailable' | string
  reasons: string[]
}

export interface BrainIndexRefresh {
  status: 'launched' | 'not-needed' | 'unavailable'
  detail: string
}

/**
 * Le processus est détaché et ses sorties ignorées, mais on écoute quand même sa FIN : sans cela,
 * une réindexation qui échoue passe pour réussie et le Brain reste muet jusqu'au prochain démarrage.
 * `once` est optionnel pour que les doublures de test restent simples.
 */
export interface LancedChild {
  unref?: () => void
  once?: (evenement: 'exit' | 'error', rappel: (...args: unknown[]) => void) => unknown
}

type SpawnLike = (
  bin: string,
  args: readonly string[],
  options: Record<string, unknown>
) => LancedChild

/** Lit `/health` (bearer obligatoire : 403 sinon). Rend `null` si le service ne répond pas. */
export async function readBrainHealth(
  fetchFn: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 4000
): Promise<BrainHealth | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs) // sleep-ok: borne la latence du fetch
  try {
    const token = brainServiceToken(env)
    const res = await fetchFn(`${amitelBrainOrigin(env)}/health`, {
      signal: ctrl.signal,
      headers: token ? { authorization: `Bearer ${token}` } : {}
    })
    // 503 est la réponse NORMALE d'un Brain dégradé : son corps porte le diagnostic.
    const body = (await res.json()) as { health?: { state?: unknown; reasons?: unknown } }
    const health = body?.health
    if (!health || typeof health.state !== 'string') return null
    const reasons = Array.isArray(health.reasons)
      ? health.reasons.filter((r): r is string => typeof r === 'string')
      : []
    return { state: health.state, reasons }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * Le serveur ne sait pas ENCORE nommer la cause : `state: "unavailable"` avec AUCUNE raison, parce
 * que la fraîcheur est en cours de réévaluation (`_on_corpus_change` remet `freshness` à null,
 * brain_retrieval.py:297). Mesuré le 2026-09-04 : cette fenêtre dure ~6 s après un changement du
 * corpus, PUIS l'état devient `degraded` avec la vraie raison. Abandonner dedans = ne rien
 * réindexer pour tout ce démarrage. Un `unavailable` MOTIVÉ, lui, est un état stable : inutile
 * d'attendre.
 */
export function isCauseUndetermined(health: BrainHealth | null): boolean {
  return health?.state === 'unavailable' && health.reasons.length === 0
}

/** Un index périmé se reconstruit ; toute autre dégradation, non. */
export function needsIndexRebuild(health: BrainHealth | null): boolean {
  if (!health || health.state !== 'degraded') return false
  // Une panne de SURVEILLANCE (« freshness watcher … », brain_retrieval.py:304 et :311) n'est pas
  // un index périmé : reconstruire ne la répare pas et coûte plusieurs minutes sur le partage.
  return health.reasons.some(
    (r) => !/watcher/i.test(r) && /index freshness mismatch|manifest missing|generation/i.test(r)
  )
}

/*
 * ÉTAT de la réindexation pour CETTE session. Mesure du 2026-09-29 : un simple « déjà tentée »
 * booléen interdisait toute reconstruction après celle du démarrage. Des notes promues à 08:32 ont
 * laissé le Brain muet (503 « index freshness mismatch ») pour le reste de la session.
 * - `libre`    : aucune reconstruction en cours ; la dernière, s'il y en a eu une, a RÉUSSI.
 * - `en-cours` : une reconstruction tourne. Une nouvelle demande est MÉMORISÉE et repart à sa fin
 *   (une note promue pendant le parcours du corpus a pu lui échapper), jamais en parallèle.
 * - `echec`    : les deux essais d'une reconstruction ont échoué. Plus AUCUN essai de la session :
 *   c'est la limite d'origine, gardée telle quelle (une cause durable — corpus illisible, disque
 *   plein — ne se répare pas en réessayant).
 */
let etat: 'libre' | 'en-cours' | 'echec' = 'libre'
let redemandee = false

/** Remise à zéro de l'état de session — réservée aux tests. */
export function resetBrainIndexRefreshAttempt(): void {
  etat = 'libre'
  redemandee = false
}

/**
 * Lance `brain_index.py` en tâche de fond. Une seule reconstruction à la fois ; après une réussite,
 * la suivante redevient possible ; après deux échecs d'affilée, plus rien de la session.
 */
export function startBrainIndexRebuild(
  env: NodeJS.ProcessEnv = process.env,
  spawnFn: SpawnLike = spawn as never
): BrainIndexRefresh {
  if (etat === 'echec') {
    return {
      status: 'not-needed',
      detail: 'réindexation échouée deux fois cette session — pas de nouvel essai'
    }
  }
  if (etat === 'en-cours') {
    redemandee = true
    return { status: 'not-needed', detail: 'réindexation déjà en cours — une autre suivra sa fin' }
  }
  const { tooling, python, brainRoot } = resolveBrainRuntime(env)
  if (!tooling || !python || !brainRoot) {
    return { status: 'unavailable', detail: 'runtime Brain local non configuré' }
  }
  const script = join(tooling, 'brain_index.py')
  if (!existsSync(python) || !existsSync(script)) {
    return { status: 'unavailable', detail: `brain_index.py ou venv introuvable (${script})` }
  }
  // L'index SERVI est celui de la racine du Brain : `brain_server.py:405` lit `root/tooling/index`.
  // Écrire dans le `tooling/` LOCAL (%LOCALAPPDATA%\AmitelBrain\tooling) construirait un index que
  // le serveur ne lit JAMAIS — mesuré le 2026-09-04 : ce dossier local n'existe même pas, alors que
  // la génération servie vit sur le partage. Le Brain resterait dégradé indéfiniment.
  const outDir = join(brainRoot, 'tooling', 'index')
  const childEnv: NodeJS.ProcessEnv = { ...env }
  delete childEnv.PYTHONPATH
  childEnv.AMITEL_BRAIN_ROOT = brainRoot
  etat = 'en-cours'
  const args = [script, '--knowledge', join(brainRoot, 'knowledge'), '--out', outDir]
  const options = { cwd: tooling, env: childEnv, detached: true, stdio: 'ignore', windowsHide: true }

  const lancer = (essaiFinal: boolean): void => {
    const child = spawnFn(python, args, options)
    // Node peut émettre `error` PUIS `exit` pour le même processus : sans ce verrou, un échec
    // compterait deux fois et lancerait deux « seconds essais ».
    let regle = false
    const echouer = (): void => {
      if (regle) return
      regle = true
      // UN seul deuxième essai : une reconstruction coûte plusieurs minutes sur le partage, et une
      // cause durable (corpus illisible, disque plein) ne se répare pas en réessayant en boucle.
      if (essaiFinal) {
        console.warn('[brain-index] second essai également échoué — Brain laissé dégradé')
        etat = 'echec'
        redemandee = false
        return
      }
      console.log('[brain-index] second et dernier essai')
      lancer(true)
    }
    // Sans cette écoute, un échec passait pour un succès : `launched` était rendu dès le lancement,
    // et le Brain restait dégradé jusqu'au prochain démarrage de l'app sans que rien ne le dise.
    child.once?.('error', (erreur) => {
      console.warn('[brain-index] lancement impossible —', String(erreur))
      echouer()
    })
    child.once?.('exit', (code) => {
      if (code !== 0) {
        console.warn('[brain-index] réindexation échouée (code', String(code), ')')
        echouer()
        return
      }
      if (regle) return
      regle = true
      console.log('[brain-index] réindexation terminée —', outDir)
      etat = 'libre'
      if (redemandee) {
        redemandee = false
        console.log(
          '[brain-index] savoir modifié pendant la reconstruction — nouvelle réindexation'
        )
        startBrainIndexRebuild(env, spawnFn)
      }
    })
    child.unref?.()
  }
  lancer(false)
  return { status: 'launched', detail: `réindexation lancée (${outDir})` }
}

/** Point d'entrée du démarrage : sonde `/health`, puis réindexe si — et seulement si — c'est la cause. */
export async function ensureBrainIndexFresh(deps?: {
  readHealth?: () => Promise<BrainHealth | null>
  env?: NodeJS.ProcessEnv
  spawnFn?: SpawnLike
  /** Attente entre deux sondes — injectée par les tests pour ne rien attendre réellement. */
  sleepFn?: (ms: number) => Promise<void>
  /** Nombre total de sondes, la première comprise. 5 sondes × 2 s couvrent la fenêtre de ~6 s. */
  essais?: number
  delaiMs?: number
  /**
   * Le savoir VIENT de changer. Un Brain encore vu sain (ou muet) peut simplement ne pas avoir
   * encore reçu l'avis de changement du partage : on resonde aussi dans ce cas, au lieu de
   * conclure trop tôt qu'il n'y a rien à reconstruire.
   */
  apresMutation?: boolean
}): Promise<BrainIndexRefresh> {
  // Session qui a déjà renoncé : inutile de solliciter le serveur.
  if (etat === 'echec') return startBrainIndexRebuild(deps?.env, deps?.spawnFn)
  const env = deps?.env ?? process.env
  const lire = deps?.readHealth ?? (() => readBrainHealth(fetch, env))
  const attendre = deps?.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))) // sleep-ok: laisse le Brain finir d'évaluer la fraîcheur
  const essais = deps?.essais ?? 5
  const delaiMs = deps?.delaiMs ?? 2000
  const aResonder = (h: BrainHealth | null): boolean =>
    isCauseUndetermined(h) ||
    (deps?.apresMutation === true && (h === null || h.state === 'healthy'))

  let health = await lire()
  // Tant que la cause n'est pas NOMMÉE, on resonde : la réponse utile arrive ~6 s plus tard.
  for (let i = 1; i < essais && aResonder(health); i++) {
    await attendre(delaiMs)
    health = await lire()
  }
  if (!needsIndexRebuild(health)) {
    return { status: 'not-needed', detail: `état du Brain : ${health?.state ?? 'injoignable'}` }
  }
  return startBrainIndexRebuild(env, deps?.spawnFn)
}

/**
 * À appeler après TOUTE modification du savoir (promotion, retrait, restauration, remplacement,
 * curation) ou un rafraîchissement demandé. Sans reconstruction, le serveur détecte la péremption
 * mais refuse de servir (503) : il ne rebâtit jamais l'index lui-même. Même garde que le démarrage
 * (on ne reconstruit que sur un index PÉRIMÉ), en insistant le temps que le changement soit vu.
 */
export function reindexerApresMutation(
  deps?: Parameters<typeof ensureBrainIndexFresh>[0]
): Promise<BrainIndexRefresh> {
  return ensureBrainIndexFresh({ ...deps, apresMutation: true })
}
