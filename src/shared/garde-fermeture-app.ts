/**
 * GARDE : ON NE FERME PAS L'APPLICATION DE L'UTILISATEUR POUR SE DEBLOQUER.
 *
 * Mesure conv-660 (2026-09-17, turnId 726f9797-7e65-44c7-97ee-c5a1b5d4478b) : « tu utilises jamais
 * mon systeme de hdesk et tu arretes pas de fermer mon app c'es trop invasif ». Le geste type est
 * `taskkill /IM RigV3Desktop.exe` lance pour debloquer un `dotnet build` (MSB3021 : le .exe est
 * verrouille par l'app OUVERTE de l'utilisateur). Fermer l'app tue l'etat non enregistre de
 * l'utilisateur : c'est IRREVERSIBLE, et ce n'etait meme pas necessaire.
 *
 * Deux voies recuperables existent, toutes deux nommees dans le refus :
 *  - compiler sans copier le binaire : `dotnet msbuild -t:Compile` (mesure 2026-09-10, exit 0
 *    pendant que `dotnet build` etait rouge au meme instant) ;
 *  - lancer SA PROPRE instance dans un bureau cache : `scripts/hdesk-lancer.ps1`.
 *
 * PORTEE ETROITE, volontairement : seule la fermeture PAR NOM d'un programme (taskkill /IM,
 * Stop-Process -Name, pkill) est refusee — c'est la forme qui frappe un process que l'agent n'a
 * PAS demarre. `taskkill /PID <n>` et `Stop-Process -Id <n>` restent libres : un pid connu est un
 * process que l'on suit.
 *
 * CONTRAINTE : fonction AUTOPORTEE (aucun import) — elle est serialisee dans le hook du CLI.
 */
export function refusFermetureApplication(commande: string): string | undefined {
  const c = String(commande ?? '')
  if (!c.trim()) return undefined
  const motif = (quoi: string): string =>
    `Fermeture de l'application de l'utilisateur refusée (${quoi}) : ce process n'a pas été démarré ` +
    `par toi, et le fermer détruit son état non enregistré (mesuré conv-660 : « tu arrêtes pas de ` +
    `fermer mon app, c'est trop invasif »). Voies non invasives : pour compiler malgré un binaire ` +
    `verrouillé, \`dotnet msbuild -t:Compile\` (compile sans copier le .exe) ; pour observer ou ` +
    `piloter l'app, lance TA propre instance dans un bureau caché avec ` +
    `\`powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id <ton bureau> -Executable <exe>\`. ` +
    `Si la fermeture est vraiment nécessaire, demande-la à l'utilisateur en nommant ce qui se ferme.`

  for (const brut of c.split(/;|&&|\|\||\|/)) {
    const seg = brut.trim().replace(/^&\s*/, '')
    const mots = seg.split(/\s+/)
    const tete = (mots[0] ?? '').toLowerCase().replace(/\.exe$/, '')
    const reste = mots.slice(1)
    const cible = (i: number): string => (reste[i + 1] ?? '').replace(/^["']|["']$/g, '')
    if (tete === 'taskkill') {
      const i = reste.findIndex((m) => /^\/im$/i.test(m))
      if (i >= 0 && cible(i)) return motif(`taskkill /IM ${cible(i)}`)
    }
    if (tete === 'stop-process' || tete === 'kill') {
      const i = reste.findIndex((m) => /^-n(ame)?$/i.test(m))
      if (i >= 0 && cible(i)) return motif(`Stop-Process -Name ${cible(i)}`)
    }
    if (tete === 'pkill') {
      const nom = reste.filter((m) => !/^-/.test(m))[0]
      if (nom) return motif(`pkill ${nom}`)
    }
  }
  return undefined
}
