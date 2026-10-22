export const withDeviceMetricsOverride = async (send, metrics, run, restore = async () => {}) => {
  await send('Emulation.setDeviceMetricsOverride', metrics)
  try {
    return await run()
  } finally {
    try {
      await send('Emulation.clearDeviceMetricsOverride')
    } finally {
      try {
        await restore()
      } finally {
        await send('Page.reload', { ignoreCache: false })
      }
    }
  }
}

/**
 * La même taille émulée, rendue par un BAIL au lieu d'un `try/finally` — pour un script qui sort
 * par `process.exit` (ui-capture.mjs) : un `finally` n'y tourne jamais, chaque sortie appelle donc
 * `liberer()` elle-même. Pas de rechargement de page : sur une fenêtre réelle (--port), il ferait
 * perdre à l'utilisateur ce qu'il voyait. `liberer()` est idempotente — plusieurs sorties peuvent
 * l'appeler sans renvoyer de commande.
 *
 * Origine (2026-10-22, conv-1056) : ui-capture.mjs posait la taille de `--largeur` en direct depuis
 * le 2026-10-09, et sa sortie « bouton-nav-absent » quittait sans la retirer.
 */
export const bailDeviceMetricsOverride = async (send, metrics) => {
  await send('Emulation.setDeviceMetricsOverride', metrics)
  let libere = false
  return async () => {
    if (libere) return
    libere = true
    await send('Emulation.clearDeviceMetricsOverride')
  }
}
