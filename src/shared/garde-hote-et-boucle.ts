/**
 * DEUX GARDES DÉTERMINISTES qui remplacent des règles jusqu'ici en PROSE dans le prompt de pilotage
 * (demande utilisateur conv-58, 2026-10-02 : « on fait 1 et 2 pour tester »).
 *
 * CONTRAINTE : fonctions AUTOPORTÉES (aucun import, aucune référence externe) — elles sont sérialisées
 * telles quelles dans le script de hook PreToolUse du CLI (`scriptHookGardes`).
 */

/**
 * GARDE 1 — NE TUE PAS L'APP HÔTE. Un agent tourne DANS Autowin (Electron + node) : un arrêt PAR NOM
 * de ces processus coupe sa propre conversation et emporte des runs qui ne lui appartiennent pas.
 * Seules les formes PAR NOM sont refusées ; un arrêt ciblé par PID reste libre (borné, attribuable).
 */
export function refusArretHote(commande: string): string | undefined {
  const c = String(commande ?? '').toLowerCase()
  if (!c.trim()) return undefined
  const cible = '(electron|node|autowin[\\w .-]*)(\\.exe)?'
  const formes: RegExp[] = [
    // taskkill /IM electron.exe, taskkill /F /IM node.exe, taskkill /im "Autowin OS.exe"
    new RegExp(`\\btaskkill\\b[^\\n;|&]*\\/im\\s+["']?${cible}\\b`),
    // Stop-Process -Name electron, spps -n node, kill -name electron (alias PowerShell)
    new RegExp(`\\b(stop-process|spps|kill)\\b[^\\n;|&]*-n(ame)?\\s+["']?${cible}\\b`),
    // Get-Process electron | Stop-Process  /  gps node | kill
    new RegExp(`\\b(get-process|gps|ps)\\s+(-name\\s+)?["']?${cible}\\b[^\\n;]*\\|\\s*(stop-process|spps|kill)\\b`),
    // pkill electron, killall node, pkill -f electron
    new RegExp(`\\b(pkill|killall)\\b(\\s+-\\S+)*\\s+["']?${cible}\\b`),
    // wmic process where name='electron.exe' delete / call terminate
    new RegExp(`\\bwmic\\b[^\\n;|&]*name\\s*=\\s*["']?${cible}[^\\n;|&]*\\b(delete|terminate)\\b`)
  ]
  if (!formes.some((re) => re.test(c))) return undefined
  return (
    `Arrêt de l'app hôte refusé : cette commande arrête Electron/node PAR NOM, donc Autowin lui-même — ` +
    `ta conversation serait coupée au milieu du tour et d'autres runs seraient perdus. ` +
    `Pour redémarrer l'app, utilise la commande restart_app (avec une consigne de reprise). ` +
    `Pour arrêter un processus que TU as lancé, vise-le par son PID (taskkill /PID <n>, Stop-Process -Id <n>).`
  )
}

/**
 * GARDE 2 — DÉTECTEUR DE BOUCLE. Refuse un appel d'outil STRICTEMENT identique (même outil, mêmes
 * arguments) à ceux qui le précèdent IMMÉDIATEMENT, à partir de `seuil` occurrences consécutives.
 *
 * Seuil 3 (le 3e appel identique d'affilée est refusé) : relancer UNE fois à l'identique peut être
 * légitime (vérifier après une attente) ; une 3e fois sans rien faire entre deux, c'est une boucle.
 * « Consécutif » est la protection contre les faux positifs : `npm test` → Edit → `npm test` n'est
 * pas une boucle, l'édition intercalée casse la série.
 *
 * Pure : reçoit l'historique (clés des derniers appels, le plus récent en dernier) et rend le motif.
 */
export function refusBoucle(historique: readonly string[], cle: string, seuil = 3): string | undefined {
  if (!cle) return undefined
  let n = 1
  for (let i = historique.length - 1; i >= 0 && historique[i] === cle; i--) n++
  if (n < seuil) return undefined
  return (
    `Appel identique refusé : c'est la ${n}e fois d'affilée exactement le même outil avec les mêmes arguments. ` +
    `Le refaire à l'identique ne t'apprendra rien de neuf : sers-toi du résultat déjà obtenu, ` +
    `ou change d'approche (réflexe 7) — autres arguments, autre outil, autre hypothèse.`
  )
}
