/**
 * Ce qu'un chien de garde NE DOIT PAS reveiller.
 *
 * Ces predicats viennent de `auto-kaizen-supervisor.ts`, DEPLACES ici mot pour mot avec leurs
 * commentaires : chacun encode un incident REELLEMENT mesure sur ce poste, pas une precaution
 * theorique. Les reecrire aurait perdu ce qui leur donne leur valeur — la date, le compte, la boucle
 * exacte qu'ils ont coupee.
 *
 * Sans eux, une regle qui ecoute les echecs reveille un agent sur : un run que l'utilisateur vient
 * d'annuler lui-meme, un quota epuise qu'aucune modification de code ne rendra, et une API en panne
 * que l'agent va justement rappeler pour echouer pareil.
 */

import { classifyProviderFailure } from '../provider-failure-diagnosis'
import { isUpstreamOutage } from '../../shared/panne-amont'

/**
 * Un mur EXTERNE n'est pas un défaut réparable : aucune modification de code ne rétablit un quota
 * acheté. Le 2026-08-04, le quota codex épuisé jusqu'au 8 août a produit 2924 incidents en 3 h 09 —
 * chaque run kaizen rappelait codex, échouait sur le même mur, et engendrait l'incident suivant.
 * Ce garde coupe la boucle à la source ; l'erreur reste ENREGISTRÉE et signalée, simplement non
 * confiée à un agent qui ne peut rien y faire.
 */
export function isNonActionableWall(summary: string, detail: string): boolean {
  const text = `${summary} ${detail}`.toLowerCase()
  return (
    /\busage[ _-]?limit(?:_reached)?\b/.test(text) ||
    /\bhit your usage limit\b/.test(text) ||
    /\bquota (?:exceeded|epuise|épuisé|exhausted)\b/.test(text) ||
    /\binsufficient_quota\b/.test(text) ||
    /\bpurchase more credits\b/.test(text) ||
    /\bbudget\s+tokens?\s+total\s+(?:depasse|dépassé|exceeded)\b/.test(text) ||
    /\btotal\s+token\s+budget\s+exceeded\b/.test(text) ||
    /\bbudget\s+(?:usd|d['’]appels?\s+provider|d['’]agents|de\s+concurrence|dur[ée]e|tokens?\s+(?:total|frais)|du\s+tour)\s+(?:atteint(?:e)?|depasse|dépassé|exceeded|entierement\s+reserve|entièrement\s+réservé|compromis)\b/.test(
      text
    ) ||
    /\bdevis impossible avant ex[ée]cution\b/.test(text) ||
    // MUR DE PLAFOND — le libelle a change le 2026-09-05 (commit 5dab5172, « devis » ->
    // « plan d'execution »). Les DEUX formulations restent reconnues : la nouvelle pour les runs a
    // venir, l'ancienne parce que le magasin d'incidents porte encore des lignes qui la citent.
    // Ne garder que la neuve rouvrirait exactement la boucle que ce garde existe pour couper.
    /\bplan d['’]ex[ée]cution impossible\b/.test(text) ||
    /\bhttp 429\b/.test(text) ||
    // TOKEN D'AUTH EXPIRE — mur non actionnable : l'agent ne peut PAS passer, seul l'utilisateur peut
    // se re-authentifier, et Auto-Kaizen ne peut rien « corriger » a un token expire. Vecu sur
    // conv-1086 (2026-08-13) : « 401 OAuth access token has expired. Re-authenticate to continue »
    // passait a travers la suppression et declenchait un incident kaizen inutile — un des
    // amplificateurs des 2248 alertes de l'historique. Ancre sur le VOCABULAIRE d'authentification
    // pour ne pas avaler un vrai defaut qui mentionnerait « 401 » par hasard.
    /\boauth\b[^\n]{0,40}\b(?:expired|expire|invalid)\b/.test(text) ||
    /\baccess token has expired\b/.test(text) ||
    /\bre-?authenticate\b/.test(text) ||
    /\bfailed to authenticate\b/.test(text) ||
    /\bauthentication_error\b/.test(text) ||
    /\binvalid[_ ]api[_ ]key\b/.test(text) ||
    /\bhttp 401\b[^\n]{0,60}\b(?:token|auth|expire|expired)\b/.test(text) ||
    /\b401\b[^\n]{0,40}\b(?:oauth|token|authenticate)\b/.test(text)
  )
}

/**
 * ABANDON VOULU — l'arrêt vient d'un humain, il n'y a aucun défaut à analyser.
 *
 * POURQUOI CE GARDE EXISTE ALORS QU'UN DRAPEAU PAR CONVERSATION EXISTE DÉJÀ. Le drapeau
 * (`ActiveChatTurns.wasDeliberatelyStopped`) est consulté sur la conversation SOURCE de l'incident. Or
 * mesuré sur les incidents réels du 2026-08-05 : les incidents nés d'un arrêt vivent dans les
 * conversations ENFANTS du kaizen (`conv-1036`…`conv-1043`, profondeurs 2 à 4, même racine), dont les
 * identifiants n'ont jamais été marqués — l'utilisateur a cliqué Stop ailleurs. Le drapeau ne pouvait
 * donc structurellement pas les couvrir.
 *
 * J'avais écarté le filtrage par SIGNATURE comme « fragile ». Les données le contredisent : l'abandon
 * produit un vocabulaire stable et reconnaissable, et c'est le seul garde qui traverse la cascade sans
 * plomberie. Relevés tels quels dans le fichier d'incidents : « This operation was aborted »,
 * « claude CLI annulé », et le détail réduit au mot « user » — littéralement la raison passée à
 * `controller.abort('user')`, remontée jusqu'ici comme si c'était un message d'erreur.
 *
 * Les motifs sont ANCRÉS : le mot « aborted » seul n'est PAS retenu, une transaction annulée par une
 * base de données étant un vrai échec. On ne reconnaît que les formulations propres à un abandon demandé.
 */
export function isDeliberateAbort(summary: string, detail: string): boolean {
  const text = `${summary} ${detail}`.toLowerCase().trim()
  return (
    // MARQUEUR `[abort]` — la signature de l'émetteur, posée par `providers/abort-diagnostic.ts` et
    // par lui seul. Sans elle, ce garde ne connaissait que l'ANCIEN libellé « … annulé », abandonné
    // le 2026-08-18 au profit de « [abort] <action> interrompu : <raison> ». Le nouveau vocabulaire
    // avait été propagé à `provider-failure-diagnosis.ts`, pas ici : un Stop du chat traversait donc
    // la suppression et relançait un chantier payant sur un arrêt VOULU (mesuré le 2026-09-02,
    // `runs/conv-14/kaizen-conv-13-est-bloquee-mtk5a9fg-workspace/RUN.md`).
    //
    // On DÉLÈGUE à `classifyProviderFailure` au lieu de recopier une expression, pour deux raisons :
    // le marqueur reste défini à un seul endroit, et l'ORDRE y est déjà juste — un arrêt imposé par
    // le devis porte lui aussi `[abort] … interrompu` mais se classe `budget`, donc n'est PAS un
    // abandon ici et retombe sur le mur non actionnable, qui dit la vraie cause.
    classifyProviderFailure(text) === 'cancelled' ||
    // Message exact d'un `AbortController` Node/undici.
    /\bthis operation was aborted\b/.test(text) ||
    /\bthe operation was aborted\b/.test(text) ||
    /\baborterror\b/.test(text) ||
    /\boperation was (?:canceled|cancelled)\b/.test(text) ||
    // « claude CLI annulé », « sous-agent annulé » : l'annulation d'un exécutable qu'on a coupé.
    // PAS de `\b` final : `é` n'est pas un caractère de mot en regex JS, donc la frontière tomberait
    // AVANT l'accent et le motif ne matcherait jamais. Vérifié — c'est un test qui l'a attrapé.
    // `(?![a-zà-ÿ])` joue le rôle de la frontière sans dépendre de la classe de `é`.
    /\b(?:cli|agent|sous-agent|run|orchestration|processus)\s+annul(?:é|e)(?![a-zà-ÿ])/.test(
      text
    ) ||
    // Le détail réduit à la RAISON d'abandon. Ancré aux extrémités : « user » au milieu d'une phrase
    // n'est pas un abandon.
    /^\s*user\s*$/.test(detail.trim().toLowerCase()) ||
    /^\s*(?:conversation-deleted|user)\s*$/.test(detail.trim().toLowerCase())
  )
}

/**
 * Panne du fournisseur : definition UNIQUE, partagee avec l'interface (reprise automatique apres
 * un 529). Re-exportee ici pour que les appelants historiques de ce fichier ne bougent pas.
 */
export { isUpstreamOutage }

export type WatchdogSuppression = 'aborted' | 'non-actionable' | 'upstream-outage'

/**
 * Rend le motif pour lequel ce signal ne merite PAS un agent, ou `undefined` s'il en merite un.
 * L'ordre reprend celui du superviseur : l'abandon volontaire d'abord, parce que c'est la cause la
 * plus frequente d'incident inutile.
 */
export function suppressionFor(summary: string, detail: string): WatchdogSuppression | undefined {
  if (isDeliberateAbort(summary, detail)) return 'aborted'
  if (isUpstreamOutage(summary, detail)) return 'upstream-outage'
  if (isNonActionableWall(summary, detail)) return 'non-actionable'
  return undefined
}
