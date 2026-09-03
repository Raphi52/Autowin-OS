/**
 * Panne du fournisseur de modèle — la SEULE définition de « ce n'est pas nous, c'est en face ».
 *
 * Elle vivait dans `src/main/task-manager/watchdog-suppression.ts`, lue par le seul superviseur.
 * Le chat en a besoin lui aussi (reprise automatique après un 529) : recopier ses motifs côté
 * interface aurait créé DEUX vérités qui divergent au premier ajout. Elle est donc ici, dans le
 * code partagé, et le superviseur la ré-exporte.
 */
export function isUpstreamOutage(summary: string, detail: string): boolean {
  const text = `${summary} ${detail}`.toLowerCase()
  return (
    // Vocabulaire explicite des fournisseurs (Anthropic, OpenAI) : aucune ambiguïté possible.
    /\boverloaded(?:_error)?\b/.test(text) ||
    /\bapi_error\b/.test(text) ||
    /\binternal server error\b/.test(text) ||
    /\bservice[ _]unavailable\b/.test(text) ||
    /\bbad gateway\b/.test(text) ||
    /\bgateway time-?out\b/.test(text) ||
    /\bupstream connect error\b/.test(text) ||
    // Codes 5xx, uniquement quand le contexte dit qu'il s'agit d'un statut.
    /\bhttp\s?5\d{2}\b/.test(text) ||
    /\bstatus(?:\s?code)?\s?5\d{2}\b/.test(text) ||
    /\bapi error\b[^\n]{0,40}\b5\d{2}\b/.test(text) ||
    /\b5\d{2}\b[^\n]{0,40}\bapi error\b/.test(text) ||
    // Le message d'abandon de NOTRE lecteur du CLI : « API Claude surchargée (529) — abandon
    // après 10/10 tentatives ». Aucun des mots anglais surveillés n'y figure, donc sans ce motif
    // la panne la plus fréquente restait invisible pour tout ce qui lit ce test. Pas de `\b` après
    // « surcharg » : `é` n'est pas un caractère de mot, la frontière tomberait avant l'accent.
    /\bsurcharg[^\n]{0,24}\b5\d{2}\b/.test(text) ||
    // Couche réseau : la requête n'a même pas abouti, il n'y a rien à analyser.
    /\b(?:econnreset|etimedout|enotfound|eai_again|econnrefused)\b/.test(text) ||
    /\bsocket hang up\b/.test(text) ||
    /\bfetch failed\b/.test(text)
  )
}
