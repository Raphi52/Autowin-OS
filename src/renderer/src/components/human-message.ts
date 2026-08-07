/**
 * Extraction du message HUMAIN d'un contenu de tour COMPOSÉ.
 *
 * `chat-turn-messages.ts` ne transmet pas la demande seule : il la préfixe d'un instantané de l'app,
 * sous la forme `ÉTAT DE L'APP:\n{json}\n\nUTILISATEUR: …`. Toute vue qui affiche « la demande » à
 * partir du contenu brut montre donc le JSON d'état à sa place.
 *
 * Cette fonction vivait en privé dans `ObservatoryView`. La vue Sous-agents, qui affrontait le même
 * contenu, s'intitulait `ÉTAT DE L'APP: {"tab":"chat",…}` sur CHAQUE bloc — tous identiques et
 * illisibles. Le remède n'était pas d'écrire un second extracteur mais de partager celui qui marchait.
 */
export function extractHumanMessage(content: string, max = 100): string {
  const segments = (content ?? '').split('\n\n')
  const utilisateur = segments.filter((s) => /^\s*UTILISATEUR\s*:/.test(s))
  let human: string
  if (utilisateur.length) {
    // Le DERNIER segment : un tour peut en empiler plusieurs, c'est le plus récent qui est la demande.
    human = utilisateur[utilisateur.length - 1].replace(/^\s*UTILISATEUR\s*:\s*/, '')
  } else if (/^\s*(ÉTAT|ETAT)\b/.test(content ?? '')) {
    // Préfixe d'état SANS marqueur `UTILISATEUR:` : on prend le premier segment qui n'est ni l'entête,
    // ni du JSON, ni une aparté. À défaut, on le DIT plutôt que d'afficher le blob.
    human =
      segments.find((s) => {
        const t = s.trim()
        return t && !/^(ÉTAT|ETAT|TOI\s*:|\()/.test(t) && !t.startsWith('{')
      }) ?? '(état de l’app)'
  } else {
    // Contenu normal : rendu tel quel. C'est le cas le plus fréquent, et il ne doit rien perdre.
    human = content ?? ''
  }
  const text = human.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}
