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
