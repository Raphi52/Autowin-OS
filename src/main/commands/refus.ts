/**
 * Refus de regarder ou d'agir sur l'écran réel de l'utilisateur, et ce qui les lève.
 *
 * Code libre sorti de `commands.ts` tel quel (conv-1580, lot 5) ; `commands.ts` ré-exporte ce qu'il
 * exportait déjà, ses importeurs ne changent pas. Dans `commands/`, une VALEUR s'importe d'ici,
 * jamais par `'../commands'` (cycle d'import) : `commands/code-libre.test.ts` le garde.
 */

/**
 * NON INVASIF PAR DEFAUT — garde-fou deterministe (kaizen conv-586, tour
 * 5e3d954a-f79f-45c6-82ed-c34b4ba9ae63, 2026-09-16). La prose l'exigeait deja deux fois
 * (`chat-pilotage-prompt.ts`, kaizen conv-526 puis conv-540) et a echoue une troisieme fois : le
 * modele a capture l'ecran reel pour verifier une modif qu'il venait de compiler, et l'utilisateur
 * a annule le tour 17 s plus tard (saisie du 2026-09-16T08:44:46). La prose ne suffit donc pas ;
 * le refus vit ici, au point de decision.
 *
 * Il ne ferme PAS la porte : le premier appel du tour est refuse, le message nomme le bureau cache,
 * et `ecran_utilisateur: true` rouvre immediatement — une friction d'un appel, pas un blocage.
 */
export const refusEcranReel =
  "Appel REFUSE : `desktop_observe` regarde l'ECRAN REEL de l'utilisateur, ce n'est pas le defaut. " +
  'Pour verifier une application que tu viens de modifier, de compiler ou de lancer, utilise le ' +
  'bureau CACHE : `powershell -NoProfile -File scripts/hdesk-lancer.ps1 ...` puis ' +
  "`scripts/hdesk-observe.ps1` (ou `node scripts/ui-capture.mjs` pour une vue d'Autowin). " +
  "Si tu as vraiment besoin de son ecran, reemets l'appel avec `ecran_utilisateur: true` et dis-le " +
  'en une ligne avant.'

/**
 * Refus de `desktop_act` quand le dernier message de l'utilisateur ne demande PAS son ecran.
 *
 * Kaizen conv-835, tour ac1d0434-51c7-4dee-adf9-a8cb0a8e41f8 (evenements 87-89) : l'appel portait
 * DEJA `ecran_utilisateur: true` et le refus repondait « reemets l'appel avec
 * `ecran_utilisateur: true` » — une sortie qui n'existait pas, le 2e appel etant refuse faute de
 * demande (« envoi un message teams a leslie… » ne parle pas de son ecran). Et il ne parlait que de
 * clics : le plan suivant du modele etait de rouvrir le lien msteams: sur l'ecran reel (reponse
 * affichee, evenement 96). Le message dit donc la seule sortie reelle.
 */
export const refusActionSansDemande =
  "Appel REFUSE : `desktop_act` agit sur l'ECRAN REEL de l'utilisateur, et il n'a pas demande " +
  "d'agir sur SON ecran dans son dernier message : ne reemets pas l'appel, `ecran_utilisateur: true` " +
  "n'y change rien. Passe par le bureau CACHE : `powershell -NoProfile -File scripts/hdesk-lancer.ps1 ...` " +
  'pour ouvrir, `powershell -NoProfile -File scripts/hdesk-act.ps1 -InstanceId <id> -X <x> -Y <y> [-Texte "..."] [-Entree]` ' +
  'pour cliquer ou taper. Ne contourne pas ce refus en rouvrant un lien ou une app sur son ecran ' +
  "(`Start-Process`, `start`, msteams:, mailto:) : c'est le meme geste. Si le bureau cache ne peut pas " +
  "faire le geste (app deja ouverte chez lui, connexion a son compte requise), dis-le en une ligne et " +
  'DEMANDE-lui.'

/** Vrai quand le message utilisateur designe son propre ecran (« mon écran », « sur l'ecran »...). */
export const demandeEcranReel = (texte: string | undefined): boolean =>
  typeof texte === 'string' && /[ée]cran/i.test(texte)

/** Vrai quand l'appel assume explicitement de regarder l'ecran de l'utilisateur. */
export const assumeEcranReel = (args: Record<string, unknown>): boolean =>
  args.ecran_utilisateur === true || args.ecran_utilisateur === 'true'
