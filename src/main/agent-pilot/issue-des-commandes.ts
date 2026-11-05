// Issue réelle d'une commande du bus (réussite, mémoire non déposée, orchestration en échec),
// sortie telle quelle de agent-pilot.ts (conv-1580, lot 1).
import type { CommandResult } from '../commands'

/** Réussite visible de l'action, distincte de la seule réussite du transport IPC. */
export function commandResultSucceeded(result: CommandResult): boolean {
  if (!result.ok) return false
  if (!result.data || typeof result.data !== 'object') return true
  const data = result.data as Record<string, unknown>
  if (data.ok === false || data.valid === false || data.gateBlocked === true) return false
  /*
   * UN REFUS TRANSPORTE DANS UN SUCCES EST UN ECHEC — decision utilisateur du 2026-09-01 (conv-52).
   *
   * Plusieurs commandes rendent `{ok:true}` en portant un REFUS dans leur charge : `remember`
   * (`stored:false`, portee/type/source invalides, doublon), `verify` et `brain_query`
   * (`allowed:false`, rien n'a tourne). Le test ne regardait que `ok`/`valid`/`status`/`exitCode` :
   * ces resultats passaient pour des reussites, donc AUCUNE des gardes en aval ne s'armait — ni la
   * pastille rouge de l'action, ni le mur enregistre, ni la relance « corrige, puis poursuis ». Le
   * modele annoncait « je retiens ca » et rien n'etait ecrit. Le fait porteur est ce que la commande
   * dit d'ELLE-MEME (`stored` / `allowed` / `refused`), jamais la reussite du transport.
   */
  /*
   * SAUF le doublon VOULU (`dejaConnu`, brain-remember.ts) : le fait est DEJA en memoire, il n'y a
   * rien a corriger. Compte comme un echec, il relancait le tour (« ta dernière action a ÉCHOUÉ »)
   * deux fois pour rien — conv-1114, 2026-10-23.
   */
  if (data.stored === false && data.dejaConnu !== true) return false
  if (data.allowed === false || data.refused === true) return false
  /*
   * MEME FAMILLE, deux champs qui manquaient — mesure conv-244 (2026-09-04) sur les traces reelles :
   * `run` refuse rend `{ok:true, data:{lance:false, detail:"Commande refusee : ..."}}` et
   * `restart_app` indisponible rend `{redemarre:false}`. Rien n'a tourne, pourtant la trace causale
   * enregistrait ces resultats en `status:"completed"` — donc aucune garde d'echec ne s'armait.
   */
  if (data.lance === false || data.redemarre === false) return false
  if (data.status === 'failed' || data.status === 'red') return false
  return typeof data.exitCode !== 'number' || data.exitCode === 0
}

/**
 * Motif d'un depot memoire QUI N'A RIEN ECRIT, ou `undefined` quand la memoire est bien deposee.
 *
 * Mesure conv-33 (2026-09-01) : le Brain a rendu `{ok:true, data:{allowed:true, stored:false,
 * detail:"refuse par le Brain : not found"}}`. Ce resultat passe `commandResultSucceeded` — aucun
 * `ok:false`, aucun statut rouge, aucun exitCode — donc la garde de visibilite ne s'armait pas : le
 * tour s'est cloture sur « je depose la lecon » alors que RIEN n'etait ecrit, et l'utilisateur a lu
 * un tour qui semblait bloque. Le fait porteur est `stored`, jamais la reussite du transport : c'est
 * la meme lecture que `skill-node-mcp` fait deja cote MCP (« RIEN ECRIT »).
 */
/** Consigne unique de relance quand un tour qui a AGI ne conclut pas. Partagee par les DEUX
 *  chemins de cloture : la branche sans commande ET le raccourci `remember` auxiliaire. */
export const RELANCE_CONCLUSION_ABSENTE =
  'SYSTÈME: ta réponse ne CONCLUT pas. Reformule-la MAINTENANT, SANS aucune commande, en ' +
  'terminant par ce bloc, court et concret : « ✅ Fait » (liste NUMÉROTÉE 1., 2., 3. de ce ' +
  'que tu as réellement fait, une ligne par action avec son résultat), puis l’état en trois lignes — 📍 Maintenant / ⏳ Reste à faire / 👉 ' +
  'Recommandé. N’écris aucune étiquette technique du type « [a exécuté … ] » et ' +
  'n’annonce pas ce que tu vas faire : le travail est déjà fait, dis ce qu’il a donné. ' +
  'Cette nouvelle réponse REMPLACE la précédente à l’écran : écris-la en entier, sans ' +
  'renvoyer à ce que tu avais écrit. ' +
  'N’écris PAS le mot « rien » seul dans une rubrique pour la remplir : ce mot éteint le mode ' +
  'auto du chat. Réserve-le au travail réellement terminé ; sinon dis le fait en clair.'

export function motifDepotMemoireNonAbouti(result: CommandResult): string | undefined {
  if (!result.ok) return String(result.error ?? 'refus')
  const data = result.data as Record<string, unknown> | undefined
  if (!data || typeof data !== 'object') return undefined
  if (data.stored !== false) return undefined
  return typeof data.detail === 'string' && data.detail.trim()
    ? data.detail.trim()
    : JSON.stringify(data)
}

export function failedOrchestrationOutcome(error: unknown): Record<string, unknown> {
  return {
    status: 'failed',
    valid: false,
    error: String(error ?? 'raison non rapportee')
  }
}
