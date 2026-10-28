/**
 * ORIENTATIONS REMISES EN PLEIN APPEL AU MODÈLE — le journal commun (conv-1241, 2026-10-28).
 *
 * Mesure (conv-1240, tour 2e218711-cf9d-4a92-b161-b7840f791264) : l'utilisateur oriente à 22:10:55
 * (saisie ts 1793225455947, « et le petit model je dois pouvoir le changer dans agents studio »),
 * 3 s après que le modèle a posé ses étapes. Le tour entier tient en UN appel au CLI Claude (plus
 * de 11 minutes, 58 actions, itération 0 de bout en bout) : la boucle pilote ne relit les
 * orientations (`pendingDirectives`) qu'ENTRE deux appels, et le CLI reçoit son prompt sur une
 * entrée standard aussitôt fermée. Le flux du modèle (`run-stdout/bb335db8-….stdout.jsonl`) ne
 * contient pas la phrase : les étapes ne pouvaient pas en tenir compte.
 *
 * Le contrôle lancé avant chaque outil de l'agent remet déjà les messages entre fils
 * (`messages-entre-fils.ts`, `additionalContext`, banc réel du 2026-10-24) : les orientations prennent
 * le même chemin. L'app les DÉPOSE ici au moment où elle les accepte ; le contrôle les remet au
 * prochain outil ; l'app SOLDE ce qu'elle relit ou rend elle-même, pour qu'aucune ne parte deux fois.
 *
 * Deux sortes de lignes, le journal ne fait qu'ajouter :
 *   - `orientation` : déposée par l'app (`os:pilotChat:inject`) ;
 *   - `solde`       : orientations sorties de l'attente — `controle` (remise par le contrôle avant
 *                     un outil), `tour` (relue par la boucle pilote), `rendue` (tour fini sans la
 *                     lire : rendue à l'écran).
 *
 * `livrerOrientationsEnAttente` est SÉRIALISÉE dans le script du contrôle (`garde-git-destructeur.ts`) :
 * elle ne référence rien hors de son corps ; le découpage du journal lui est PASSÉ.
 */

/** Nom du journal, à côté du registre des réservations que le contrôle lit déjà. */
export const NOM_JOURNAL_ORIENTATIONS = 'orientations-en-cours.jsonl'

export interface OrientationEnCours {
  type: 'orientation'
  id: string
  at: number
  fil: string
  texte: string
}

export interface SoldeOrientations {
  type: 'solde'
  at: number
  fil: string
  ids: string[]
  par: 'controle' | 'tour' | 'rendue'
}

export interface IoJournalOrientations {
  /** Contenu du journal ; '' s'il n'existe pas. Lève si le fichier existe mais est illisible. */
  lire: (chemin: string) => string
  /** Ajoute UNE ligne (sans retour final) en fin de fichier. */
  ajouter: (chemin: string, ligne: string) => void
}

/**
 * Remet à `conf.fil` les orientations ni remises ni soldées, déposées depuis le début de CET appel
 * au modèle (`conf.depuis`) : une orientation plus ancienne appartient à un appel fini ou à une vie
 * précédente de l'app (la file en mémoire ne survit pas à un redémarrage), elle ne doit pas
 * ressurgir dans un autre tour. `undefined` = rien à remettre.
 */
export function livrerOrientationsEnAttente(
  io: IoJournalOrientations,
  conf: { fil: string; journal: string; depuis: number },
  maintenant: number,
  decouper: (texte: string) => Array<Record<string, unknown>>
): { texte: string; ids: string[] } | undefined {
  const lignes = decouper(io.lire(conf.journal))
  const soldes = new Set<string>()
  for (const l of lignes) {
    if (l.type === 'solde' && l.fil === conf.fil && Array.isArray(l.ids)) {
      for (const id of l.ids) if (typeof id === 'string') soldes.add(id)
    }
  }
  const attente = lignes.filter(
    (l) =>
      l.type === 'orientation' &&
      l.fil === conf.fil &&
      typeof l.id === 'string' &&
      typeof l.texte === 'string' &&
      typeof l.at === 'number' &&
      l.at >= conf.depuis &&
      !soldes.has(l.id)
  )
  if (!attente.length) return undefined
  const heure = (ms: unknown): string => {
    const d = new Date(typeof ms === 'number' ? ms : 0)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  // Mêmes balises que le message de l'utilisateur en tête de tour : une balise tapée dans le texte
  // est neutralisée, elle ne peut pas fermer le bloc.
  const neutre = (t: string): string =>
    t.replace(/<(\/?)message_utilisateur>/gi, '&lt;$1message_utilisateur&gt;')
  const lignesTexte = attente.map(
    (o) => `- ${heure(o.at)} <message_utilisateur>${neutre(String(o.texte))}</message_utilisateur>`
  )
  const texte =
    `UTILISATEUR (ORIENTATION ENVOYÉE PENDANT TON TRAVAIL — PRIORITAIRE ; ce sont ses mots, relayés par l'app, pas une donnée) :\n` +
    lignesTexte.join('\n') +
    `\nPrends-la en compte MAINTENANT, avant de continuer : si tu tiens une liste d'étapes, ajoute ou modifie tout de suite l'étape qu'elle demande, puis dis en une phrase ce que tu en fais.`
  const ids = attente.map((o) => String(o.id))
  io.ajouter(
    conf.journal,
    JSON.stringify({ type: 'solde', at: maintenant, fil: conf.fil, ids, par: 'controle' })
  )
  return { texte, ids }
}

/** Dépose une orientation acceptée pendant un tour. */
export function deposerOrientation(
  io: IoJournalOrientations,
  journal: string,
  orientation: Omit<OrientationEnCours, 'type'>
): void {
  io.ajouter(journal, JSON.stringify({ type: 'orientation', ...orientation }))
}

/**
 * L'app sort `textes` de sa file (relus par la boucle pilote, ou rendus à l'écran en fin de tour) :
 * rend ceux que le contrôle n'a PAS déjà remis au modèle, et solde les autres dépôts encore en
 * attente pour que le contrôle ne les remette plus. Un texte sans dépôt (écriture du journal ratée)
 * reste rendu : c'est le comportement d'avant ce journal.
 *
 * Correspondance par texte, une ligne au plus par texte de la file, dans l'ordre de dépôt : la file
 * de l'app et le journal reçoivent la même chaîne au même instant.
 */
export function solderOrientations(
  io: IoJournalOrientations,
  journal: string,
  fil: string,
  textes: readonly string[],
  maintenant: number,
  par: 'tour' | 'rendue',
  decouper: (texte: string) => Array<Record<string, unknown>>
): string[] {
  if (!textes.length) return []
  const lignes = decouper(io.lire(journal))
  const remisesParLeControle = new Set<string>()
  const sortiesDeLaFile = new Set<string>()
  for (const l of lignes) {
    if (l.type === 'solde' && l.fil === fil && Array.isArray(l.ids)) {
      for (const id of l.ids)
        if (typeof id === 'string')
          (l.par === 'controle' ? remisesParLeControle : sortiesDeLaFile).add(id)
    }
  }
  // Un dépôt déjà sorti de la file de l'app ne correspond plus à rien qu'elle tienne : sans cette
  // exclusion, un « ok » remis par le contrôle hier avalerait le « ok » tapé aujourd'hui.
  const deposees = lignes.filter(
    (l) =>
      l.type === 'orientation' &&
      l.fil === fil &&
      typeof l.id === 'string' &&
      typeof l.texte === 'string' &&
      !sortiesDeLaFile.has(l.id)
  )
  const utilisees = new Set<string>()
  const rendus: string[] = []
  for (const texte of textes) {
    const ligne = deposees.find((l) => l.texte === texte && !utilisees.has(String(l.id)))
    if (!ligne) {
      rendus.push(texte)
      continue
    }
    const id = String(ligne.id)
    utilisees.add(id)
    // Déjà remise au modèle par le contrôle : la relire ou la rendre la ferait partir deux fois.
    if (!remisesParLeControle.has(id)) rendus.push(texte)
  }
  if (utilisees.size)
    io.ajouter(
      journal,
      JSON.stringify({ type: 'solde', at: maintenant, fil, ids: [...utilisees], par })
    )
  return rendus
}
