/**
 * LA VOIE DU BUREAU CACHÉ, DITE À L'AGENT D'UN RUN — AVEC UN BUREAU À LUI.
 *
 * Défaut mesuré (conv-611 puis conv-618, 2026-09-16) : « mes travaux en parallèle se parasitent
 * car ils utilisent pas mon système de bureau virtuel ». La consigne des runs
 * (`PIPELINE_DISCIPLINE_INSTRUCTION`) ne citait que `scripts/ui-capture.mjs` : `hdesk-lancer.ps1`
 * n'apparaissait QUE dans le prompt du chat. Un run qui devait ouvrir une AUTRE application
 * improvisait donc un lancement au premier plan — refusé par le garde, ou posé sur l'écran de
 * l'utilisateur. Et deux runs qui improvisaient prenaient le même nom de bureau.
 *
 * L'identifiant est DÉRIVÉ DU runId : deux runs parallèles n'ont jamais le même bureau caché,
 * donc ni le même profil ni le même verrou d'instance.
 */

/** Identifiant de bureau caché réservé à un run. Pure. Jamais vide, jamais partagé entre runs. */
export function identifiantBureauCache(runId: string): string {
  const nettoye = String(runId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `run-${nettoye || 'sans-id'}`
}

/** Le bloc de consigne injecté au système du run. Vide si aucun runId. Pure. */
export function consigneBureauCache(runId: string): string {
  if (!String(runId ?? '').trim()) return ''
  const id = identifiantBureauCache(runId)
  return (
    `\nBUREAU CACHÉ (ton bureau à toi : ${id}) : pour ouvrir une application graphique — autre chose ` +
    `qu'une vue d'Autowin, que \`scripts/ui-capture.mjs\` couvre déjà —, ne la lance JAMAIS au premier ` +
    `plan : elle s'afficherait sur l'écran de l'utilisateur et se disputerait l'instance des travaux ` +
    `parallèles. Et ne FERME jamais une application de l'utilisateur pour te débloquer : un binaire ` +
    `verrouillé pendant une compilation (MSB3021 / MSB3027) se contourne en compilant SANS lier — ` +
    `\`dotnet msbuild <projet> -t:Compile\` —, jamais en tuant le processus par son nom. Passe par ` +
    `\`powershell -NoProfile -File scripts/hdesk-lancer.ps1 -Id ${id} -Executable "<chemin.exe>" -Arguments "<args>" -Travail "<ce que tu fais>"\`, ` +
    `puis capture avec \`powershell -NoProfile -File scripts/hdesk-observe.ps1 -InstanceId ${id} -Output <chemin.png>\` et LIS l'image. ` +
    `N'emploie aucun autre identifiant de bureau : ${id} est réservé à ce run, c'est ce qui empêche ` +
    `deux travaux parallèles de se parasiter. Un code de sortie non nul du lanceur (4 = l'app est morte, ` +
    `3 = aucune fenêtre, 1 = échec) est une erreur de TON tour : lis \`erreur\` et \`journalWindows\`, ` +
    `corrige la cause, relance — ne bascule pas sur l'écran de l'utilisateur.\n`
  )
}

/**
 * Le bureau caché réservé à UNE conversation du chat (conv-620).
 *
 * Défaut mesuré : le prompt du chat prescrivait `-Id <nom>` — un nom LIBRE. Deux conversations
 * menées en parallèle sur la même application choisissaient le même nom évident (« rigv3 »),
 * donc le même bureau, le même profil et le même verrou d'instance : elles se parasitaient,
 * exactement comme les runs avant conv-618. L'identifiant est ici DÉRIVÉ de l'id du fil.
 */
export function identifiantBureauCacheChat(conversationId: string): string {
  const nettoye = String(conversationId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `chat-${nettoye || 'sans-id'}`
}

/** Le bloc de consigne injecté au chat pour un tour visuel. Vide sans id de fil. Pure. */
export function consigneBureauCacheChat(conversationId: string): string {
  if (!String(conversationId ?? '').trim()) return ''
  const id = identifiantBureauCacheChat(conversationId)
  return (
    `\nTON BUREAU CACHÉ EST NOMMÉ : utilise \`-Id ${id}\` et \`-InstanceId ${id}\`, jamais un nom ` +
    `que tu inventes. Deux conversations menées en même temps sur la même application choisiraient ` +
    `sinon le même nom évident, donc le même bureau et le même verrou d'instance, et se ` +
    `parasiteraient. ${id} est réservé à ce fil.\n`
  )
}
