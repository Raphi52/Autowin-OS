/**
 * Reconnait l'echec de tour qui vient d'une SESSION EXPIREE, pas d'un defaut.
 *
 * Vecu le 2026-09-10 : « Failed to authenticate. API Error: 401 OAuth access token has expired.
 * Re-authenticate to continue. » s'affichait avec « ↻ Renvoyer » et « ✎ Reprendre en precisant… ».
 * Les deux sont inutiles : renvoyer le meme prompt echouera a l'identique tant que personne ne
 * s'est reconnecte. Le seul geste utile est le login — c'est donc le seul bouton a offrir.
 *
 * Motifs ANCRES sur le vocabulaire d'authentification (memes ancres que
 * `main/task-manager/watchdog-suppression.ts`) pour ne pas avaler un vrai defaut qui citerait
 * « 401 » par hasard.
 */
export function estErreurAuthExpiree(message: string): boolean {
  const text = message.toLowerCase()
  return (
    /\boauth\b[^\n]{0,40}\b(?:expired|expire|invalid)\b/.test(text) ||
    /\baccess token has expired\b/.test(text) ||
    /\bre-?authenticate\b/.test(text) ||
    /\bfailed to authenticate\b/.test(text) ||
    /\bauthentication_error\b/.test(text) ||
    /\binvalid[_ ]api[_ ]key\b/.test(text) ||
    /\bnot logged ?in\b/.test(text) ||
    /\b401\b[^\n]{0,40}\b(?:oauth|token|authenticate)\b/.test(text)
  )
}
