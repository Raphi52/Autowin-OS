/**
 * Choix du port de débogage distant (CDP) en DEV.
 *
 * PROBLÈME CONSTATÉ (chez un collègue, 2026-07-30) : `npm run dev` sortait
 * `bind() ... (0x2740)` + `Cannot start http server for devtools`, parce que le port 9223 était
 * déjà tenu. Vérifié sur cette machine : `netstat` montrait `127.0.0.1:9223 LISTENING <pid>` avec un
 * PID QUI N'EXISTAIT PLUS — un process enfant lancé par l'app avait hérité du socket d'écoute
 * DevTools et le gardait après la mort de l'app. Le port restait donc bloqué jusqu'au reboot, et le
 * seul recours était de chasser le process à la main.
 *
 * Le symptôme n'est pas fatal (l'app démarre, seul le pilotage à distance manque), mais il est
 * inexplicable pour un nouveau venu. On le rend AUTO-RÉPARANT : si le port préféré est occupé, on
 * prend le suivant libre et on l'annonce.
 *
 * Pourquoi une sonde SYNCHRONE : `appendSwitch` doit être posé avant que l'app soit prête, il n'y a
 * donc pas de place pour un test de bind asynchrone. Un `netstat` coûte ~50 ms, en DEV uniquement.
 */
export const DEFAULT_CDP_PORT = 9223
/** Au-delà, on renonce et on garde le port préféré (mieux vaut l'erreur d'Electron qu'une boucle). */
const MAX_PORT_PROBES = 10

/** Ports en écoute d'après une sortie `netstat -ano`. Tolère les formats IPv4/IPv6 et locales FR/EN. */
export function listeningPorts(netstatOutput: string): Set<number> {
  const ports = new Set<number>()
  for (const line of netstatOutput.split(/\r?\n/)) {
    // On ne retient que les sockets en ÉCOUTE : une connexion sortante vers :9223 n'occupe pas le port.
    if (!/listening/i.test(line)) continue
    // Adresse locale = 2ᵉ colonne ; le port suit le DERNIER `:` (IPv6 : `[::1]:9223`).
    const columns = line.trim().split(/\s+/)
    const local = columns[1] ?? ''
    const port = Number.parseInt(local.slice(local.lastIndexOf(':') + 1), 10)
    if (Number.isFinite(port)) ports.add(port)
  }
  return ports
}

/**
 * Port CDP à utiliser. `AUTOWIN_CDP_PORT` force la valeur (aucune sonde : un choix explicite de
 * l'utilisateur n'est jamais réécrit). Sinon on part du port préféré et on avance jusqu'au 1ᵉʳ libre.
 * `probe` est injecté → testable sans réseau ni netstat.
 */
export function resolveCdpPort(
  probe: () => Set<number>,
  env: NodeJS.ProcessEnv = process.env,
  preferred = DEFAULT_CDP_PORT
): { port: number; moved: boolean; forced: boolean } {
  const forcedRaw = Number.parseInt(env.AUTOWIN_CDP_PORT ?? '', 10)
  if (Number.isFinite(forcedRaw) && forcedRaw > 0 && forcedRaw < 65_536) {
    return { port: forcedRaw, moved: false, forced: true }
  }
  let busy: Set<number>
  try {
    busy = probe()
  } catch {
    // Pas de netstat / sortie illisible → on garde le port préféré : la sonde est un confort,
    // jamais une raison d'empêcher le démarrage.
    return { port: preferred, moved: false, forced: false }
  }
  for (let offset = 0; offset < MAX_PORT_PROBES; offset += 1) {
    const candidate = preferred + offset
    if (!busy.has(candidate)) return { port: candidate, moved: offset > 0, forced: false }
  }
  return { port: preferred, moved: false, forced: false }
}
