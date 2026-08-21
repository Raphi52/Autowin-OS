/**
 * Detecte l'affirmation « je n'ai pas cet outil » quand l'outil EST au catalogue du tour.
 *
 * POURQUOI CETTE GARDE EXISTE. Mesure du 20/08, conversation reelle : un tour de chat a affirme
 * « `edit_file` n'existe pas dans le catalogue reellement disponible de cette session » et
 * « `verify` non disponible non plus ». Les deux etaient la. `directReadOnly` vaut `false` en dur
 * (agent-pilot.ts) : un tour pilote par l'utilisateur recoit TOUJOURS le catalogue complet. L'agent
 * n'a jamais essaye. Il a ensuite passe huit tours a reclamer des droits shell dont il n'avait pas
 * besoin, pour finir a 13,15 $ sans une seule ligne ecrite.
 *
 * Aucune ligne de prompt n'arrete une hallucination : une certitude ressentie ne se distingue pas
 * d'un fait pour celui qui la formule. Ce qui les separe est une VERIFICATION, et celle-ci est
 * triviale — le catalogue du tour est connu du code qui vient de l'envoyer.
 *
 * PRECISION AVANT COUVERTURE. Une garde qui se declenche a tort injecte une fausse correction et
 * coute une iteration. La negation doit donc GOUVERNER le nom : on n'accepte qu'un intercalaire
 * court, sans virgule, sans autre nom cite, sans « mais ». « j'ai `edit_file`, mais `git apply`
 * n'est pas disponible » ne doit RIEN declencher — c'est vrai, et c'est le cas voisin le plus
 * proche de la frontiere.
 */

/** Ce qui compte comme une declaration d'absence, accents et casse tolerés. */
const NEGATIONS = [
  "n'existe pas",
  "n'existent pas",
  'non disponible',
  'non disponibles',
  "n'est pas disponible",
  'ne sont pas disponibles',
  'indisponible',
  'indisponibles',
  "n'est pas expose",
  "n'est pas exposé",
  'ne sont pas exposes',
  'ne sont pas exposés',
  'pas dans le catalogue',
  'absent du catalogue',
  'absents du catalogue',
  'no such tool'
]

/** Un intercalaire plus long, ou porteur d'une rupture, ne gouverne plus le nom qui precede. */
const PLAFOND_INTERCALAIRE = 24
const RUPTURES = [',', ' mais ', ' sauf ', ' contrairement ', ' et ']

function sansAccent(texte: string): string {
  return texte.normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
}

/**
 * Les noms d'outils que le texte declare absents alors qu'ils sont au catalogue.
 *
 * `catalogue` est la liste REELLEMENT envoyee pour ce tour : un outil absent d'un sous-agent
 * orchestre l'est vraiment, et le dire n'est pas un defaut. La comparaison ne vaut que contre le
 * catalogue de CE tour.
 */
export function outilsFaussementAbsents(texte: unknown, catalogue: readonly string[]): string[] {
  if (typeof texte !== 'string' || !texte.trim() || !catalogue.length) return []
  /*
   * Les accents graves sont du BALISAGE, pas du sens : les garder mettait le backtick fermant
   * entre le nom et sa negation, donc toute mention citee — c'est-a-dire toutes les vraies —
   * etait rejetee comme rupture. Cinq tests rouges sur ce seul caractere.
   */
  const plat = sansAccent(texte).toLowerCase().split(String.fromCharCode(96)).join('')
  const trouves: string[] = []

  for (const nom of catalogue) {
    const cible = sansAccent(nom).toLowerCase()
    if (!cible) continue
    let depuis = 0
    let signale = false
    while (!signale) {
      const position = plat.indexOf(cible, depuis)
      if (position < 0) break
      depuis = position + cible.length
      // Le nom doit etre un token entier : `verify` ne doit pas matcher dans `verifyPath`.
      const avant = plat[position - 1]
      const apres = plat[depuis]
      if ((avant && /[\w-]/u.test(avant)) || (apres && /[\w-]/u.test(apres))) continue
      const suite = plat.slice(depuis, depuis + PLAFOND_INTERCALAIRE + 30)
      for (const negation of NEGATIONS) {
        const index = suite.indexOf(sansAccent(negation).toLowerCase())
        if (index < 0 || index > PLAFOND_INTERCALAIRE) continue
        const intercalaire = suite.slice(0, index)
        if (RUPTURES.some((rupture) => intercalaire.includes(rupture))) continue
        trouves.push(nom)
        signale = true
        break
      }
    }
  }
  return trouves
}

/** La correction remise a l'agent. Elle NOMME les outils, parce qu'il vient d'affirmer le contraire. */
export function correctionOutilsPresents(noms: readonly string[]): string {
  const liste = noms.map((nom) => `\`${nom}\``).join(', ')
  return (
    `SYSTÈME: tu affirmes ne pas disposer de ${liste} — c'est FAUX, ${liste} ` +
    `${noms.length > 1 ? 'sont' : 'est'} dans le catalogue de CE tour, avec sa description. ` +
    `Tu ne l'as pas essayé. Un tour piloté par l'utilisateur reçoit toujours le catalogue complet. ` +
    `N'exige aucun droit shell supplémentaire pour muter : \`edit_file\` écrit dans un bureau isolé, ` +
    `le vérifie et ne publie que si le test passe. Utilise l'outil maintenant, ou dis précisément ` +
    `quelle tentative a échoué et ce qu'elle a rendu.`
  )
}

/*
 * DEUXIEME FORME DU MEME DEFAUT : « je n'ai pas ACCES a cette information ».
 *
 * Mesure du 21/08, le lendemain de la premiere garde. L'utilisateur demande « tu peux reconsulter
 * les resultats de ton scout ? ». Reponse : « Le scout aux 8 candidats n'existe dans mon contexte
 * qu'a travers le tableau de verification du frame. » Or `conversation_read` etait au catalogue, et
 * sa description se termine par : « Ne reponds JAMAIS "je ne peux pas citer cette conversation" sans
 * avoir appele cet outil. » La consigne existait, mot pour mot, et n'a pas suffi.
 *
 * La premiere garde ne pouvait pas le voir : elle cherche un NOM d'outil declare absent. Ici l'agent
 * ne nie aucun outil — il nie l'ACCES a une information. Meme faute, autre formulation.
 *
 * PORTEE VOLONTAIREMENT ETROITE. On ne detecte pas « toute information inaccessible » : ce serait un
 * filet a faux positifs, et une bonne part des refus d'acces sont VRAIS (un serveur, un secret, un
 * droit). On ne couvre que le cas ou un outil du catalogue rend precisement cette information, et ou
 * sa propre description interdit deja la reponse : la CONVERSATION.
 */

/** L'outil qui rend le contenu d'une conversation. Absent du catalogue ⇒ la garde se tait. */
const OUTIL_CONVERSATION = 'conversation_read'

/**
 * Ce qui compte comme « je ne peux pas atteindre cette conversation ».
 *
 * Chaque motif vient d'une phrase REELLEMENT ecrite, ou de la formule que la description de l'outil
 * interdit nommement. On exige la mention d'une CONVERSATION (ou d'un scout/tour passe) a proximite :
 * « je n'ai pas acces au serveur » ne doit rien declencher.
 */
const INACCESSIBLE = [
  /n.existe\s+(?:que\s+)?dans\s+mon\s+contexte/iu,
  /hors\s+de\s+mon\s+contexte/iu,
  /je\s+ne\s+peux\s+pas\s+(?:citer|relire|consulter|rouvrir)/iu,
  /je\s+n.ai\s+pas\s+(?:acc[èe]s\s+[àa]\s+|)(?:cette|la|ces|les)\s+(?:conversation|conversations|tours?)/iu,
  /je\s+ne\s+vois\s+pas\s+(?:cette|la)\s+conversation/iu,
  /pas\s+(?:d.acc[èe]s|acc[èe]s)\s+[àa]\s+(?:l.historique|mes\s+conversations)/iu
]

/** Le sujet doit etre une conversation ou un tour passe, sinon le refus d'acces est peut-etre vrai. */
const SUJET_CONVERSATION =
  /conversation|scout|tour\s+pr[ée]c[ée]dent|historique|ce\s+qu.on\s+a\s+dit/iu

/**
 * L'agent declare-t-il inaccessible une conversation que le catalogue sait lire ?
 *
 * Rend le nom de l'outil a lui rappeler, ou `null`. `null` des que l'outil n'est pas la : sans lui,
 * la phrase est vraie et la reprendre serait une faute.
 */
export function conversationPretendueInaccessible(
  texte: unknown,
  catalogue: readonly string[]
): string | null {
  if (typeof texte !== 'string' || !texte.trim()) return null
  if (!catalogue.includes(OUTIL_CONVERSATION)) return null
  if (!SUJET_CONVERSATION.test(texte)) return null
  return INACCESSIBLE.some((motif) => motif.test(texte)) ? OUTIL_CONVERSATION : null
}

/** La correction : elle cite l'instruction que l'outil porte deja, pour ne pas inventer une regle. */
export function correctionConversationLisible(outil: string): string {
  return (
    `SYSTÈME: tu affirmes ne pas pouvoir atteindre une conversation ou un tour passé. C'est FAUX : ` +
    `\`${outil}\` est dans le catalogue de CE tour et rend le contenu réel des messages, depuis ` +
    `l'état vivant de l'application — plus frais que le fichier sur disque. Sa description te dit ` +
    `déjà : « Ne réponds JAMAIS "je ne peux pas citer cette conversation" sans avoir appelé cet ` +
    `outil. » Appelle-le maintenant, puis réponds sur ce qu'il rend. Si son résultat ne contient pas ` +
    `ce que tu cherches, dis-le en citant ce que tu as lu — c'est une réponse, pas un refus.`
  )
}
