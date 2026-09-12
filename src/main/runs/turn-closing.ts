/**
 * CE QUI RESTE A DIRE, une fois retranche ce qui a DEJA ete dit.
 *
 * C'est la SEULE garde anti-doublon, et elle regarde le CONTENU. L'ancienne se contentait de
 * demander « des deltas ont-ils ete vus ? » et, si oui, jetait le texte final en entier au motif
 * qu'il « reprend ce qui a deja ete dit ». Ce motif n'est vrai que d'un tour qui ne parle qu'une
 * fois. Des qu'un tour parle ENTRE ses appels d'outils -- ce que la consigne « jamais de fil muet »
 * lui demande -- son texte final est du texte NEUF, et il etait perdu.
 *
 * MESURE le 2026-09-11 sur `conv-471` : quatre phrases diffusees (222 caracteres), puis le process
 * principal relance pendant la redaction. A la reprise le texte final existait ; le veto l'a jete.
 * L'utilisateur a lu « je lance les tests » puis plus rien, sans moyen de savoir si c'etait fini,
 * pour 10652 tokens de sortie deja payes.
 */
export function resteADire(closing: string, dejaDit: string): string {
  const deja = dejaDit.trim()
  if (!deja) return closing
  // Prolongement : le texte final reprend le debut deja diffuse, on ne publie que la suite.
  if (closing.startsWith(deja)) return closing.slice(deja.length).trim()
  // Rien de neuf : tout ce que porte la cloture a deja ete affiche.
  if (deja.includes(closing.trim())) return ''
  return closing
}

/** Flux dédié : ce texte de clôture n'appartient à aucun stream déjà ouvert. */
export function closingStreamId(turnId: string): string {
  return `${turnId}:closing`
}

/**
 * DURABLE ET LIVE, DÉCIDÉS ENSEMBLE — sinon le texte est écrit sur disque sans jamais atteindre le fil.
 *
 * MESURÉ le 2026-08-17 dans `conv-1276` (tour « finis ça une bonne fois pour toutes ») : tout le texte
 * du tour tenait dans UNE part de flux `<turnId>:closing`, celle que la clôture écrit dans le store.
 * L'utilisateur n'a vu que la ligne du gate ; le reste n'est apparu qu'à l'envoi du message SUIVANT,
 * qui provoque une relecture du store. Cause : le renderer ne reçoit que l'événement `done`, et son
 * réducteur le réduit à `{ kind: 'done' }` — le texte du `done` y est jeté, par construction, pour ne
 * pas dupliquer ce qui a déjà été streamé. Le chemin frère `orchestrate-turn-persistence.ts` émet, lui,
 * un vrai `delta` : c'est le patron correct.
 *
 * La décision (dupliquer ou non) vit ICI et une seule fois : le renderer ne peut pas la reproduire, il
 * ne sait pas ce que le tour a déjà streamé. On rend donc les DEUX événements ensemble, avec le même
 * flux et le même texte — impossible d'en persister un sans livrer l'autre.
 */
export function closingTurnDelivery(
  turnId: string,
  closingText: string | undefined,
  texteDejaStreame?: string
): { durable: { kind: 'delta'; streamId: string; text: string }; live: { kind: 'delta'; streamId: string; text: string } } | undefined {
  const closing = closingText?.trim()
  if (!closing) return undefined
  /*
   * ON NE REPUBLIE QUE CE QUI N'A PAS DEJA ETE DIT.
   *
   * Le `done` reprend souvent le texte deja diffuse ; le fil l'affichait alors DEUX FOIS (signale
   * par l'utilisateur le 2026-09-09 sur un rendu de scout). On retranche donc ce qui a deja ete dit
   * et on ne persiste que le RESTE. Rien de neuf a dire => aucune livraison. Cette comparaison de
   * contenu remplace l'ancien veto « des deltas ont ete vus », qui jetait des textes finaux NEUFS.
   */
  const reste = resteADire(closing, texteDejaStreame ?? '')
  if (!reste) return undefined
  const delta = { kind: 'delta' as const, streamId: closingStreamId(turnId), text: reste }
  return { durable: delta, live: { ...delta } }
}
