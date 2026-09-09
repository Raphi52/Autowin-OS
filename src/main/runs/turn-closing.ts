/**
 * Un `done` conversationnel reprend souvent le texte deja streame : on ne le duplique pas. Une
 * cloture d'orchestration porte au contraire un outcome structure distinct du preambule ; elle doit
 * toujours rester visible et durable.
 */
export function shouldPersistClosingText(
  durableResponseTextSeen: boolean,
  outcome: Record<string, unknown> | undefined
): boolean {
  return !durableResponseTextSeen || Boolean(outcome && Object.keys(outcome).length > 0)
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
  durableResponseTextSeen: boolean,
  outcome: Record<string, unknown> | undefined,
  texteDejaStreame?: string
): { durable: { kind: 'delta'; streamId: string; text: string }; live: { kind: 'delta'; streamId: string; text: string } } | undefined {
  const closing = closingText?.trim()
  if (!closing || !shouldPersistClosingText(durableResponseTextSeen, outcome)) return undefined
  /*
   * ON NE REPUBLIE QUE CE QUI N'A PAS DEJA ETE DIT.
   *
   * Regle historique : une cloture porteuse d'un `outcome` etait TOUJOURS republiee, parce qu'a
   * l'epoque le compte-rendu d'orchestration n'existait que dans le `done` — rien n'etait streame.
   * Depuis que le modele reprend la parole apres `orchestrate` (agent-pilot, 2026-08-27), il ECRIT
   * lui-meme ce compte-rendu en direct ; le `done` reprend alors le meme texte et le fil l'affichait
   * DEUX FOIS (signale par l'utilisateur le 2026-09-09 sur un rendu de scout).
   *
   * On retranche donc le prefixe deja streame et on ne persiste que le reste (typiquement le pied de
   * cloture ajoute par `texteDeCloture`). Rien de neuf a dire => aucune livraison.
   */
  const deja = texteDejaStreame?.trim() ?? ''
  const reste = deja && closing.startsWith(deja) ? closing.slice(deja.length).trim() : closing
  if (!reste) return undefined
  const delta = { kind: 'delta' as const, streamId: closingStreamId(turnId), text: reste }
  return { durable: delta, live: { ...delta } }
}
