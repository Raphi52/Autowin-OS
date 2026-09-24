/*
 * Corps des blocs « Raisonnement » et « Actions » — hors du composant EXPRES : un fichier qui
 * exporte a la fois un composant et une fonction casse le rechargement a chaud de React
 * (regle react-refresh/only-export-components). Le calcul est pur, il n'a pas besoin du composant.
 */
/**
 * Corps du bloc RAISONNEMENT : la pensee du modele, et rien d'autre.
 *
 * Avant le 2026-09-12 ce corps melangeait la pensee et les lignes d'action ; l'utilisateur ne
 * voyait donc que les actions sur les modeles dont la pensee arrive vide. Les deux vivent
 * desormais dans DEUX blocs empiles.
 */
export function corpsDuBloc(text: string): string {
  return text
}

/**
 * En-tete du bloc RAISONNEMENT quand il est PLIE : la DERNIERE ligne ecrite, comme le bloc
 * Actions affiche son action courante (demande de l'utilisateur, 2026-09-12). On saute les lignes
 * vides de fin : une pensee qui vient de passer a la ligne afficherait sinon du vide.
 */
export function derniereLigneDuRaisonnement(text: string): string {
  const lignes = text.split('\n')
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const ligne = lignes[i]!.trim()
    if (ligne) return ligne
  }
  return ''
}

/**
 * Corps du bloc ACTIONS : UNE LIGNE PAR ACTION.
 *
 * Le fournisseur emet deux sortes de lignes : l'ACTION elle-meme (`Read · src/a.ts`) puis des
 * BATTEMENTS qui ne font que redire la meme action avec sa duree qui monte (`Bash en cours - 30 s`,
 * `Bash en cours - 1 min`, ...). Empilees telles quelles, une seule commande longue produisait des
 * dizaines de lignes et le bloc devenait illisible. Demande de l'utilisateur (2026-09-12) : « dans
 * le bloc Action je veux une ligne par action ».
 *
 * Regle : un battement ne cree PAS de ligne, il MET A JOUR la ligne de son outil (la derniere du
 * meme nom). Si l'action n'a jamais ete annoncee, le battement devient lui-meme cette ligne.
 */
const BATTEMENT = /^(.+?) en cours(?: - (.*))?$/

/** Nom d'outil porte par une ligne d'action (`Read · cible` -> `Read`). */
function outilDe(ligne: string): string {
  const battement = BATTEMENT.exec(ligne)
  if (battement) return battement[1]!.trim()
  return (ligne.split('·')[0] ?? ligne).trim()
}

/** Ligne de FIN d'action emise au resultat de l'outil : `Bash échoué - 31 s`, `Read terminé - 1 s`. */
const FIN = /^(.+?) (terminé|échoué)(?: - (.*))?$/

export type EtatAction = 'ok' | 'ko' | 'encours'

/** Une action du bloc, telle que la frise C3 la dessine. */
export type ActionFrise = {
  /** Texte de la ligne — inchange par rapport au corps texte (`outil · cible — duree`). */
  texte: string
  outil: string
  /** Famille d'icone : lecture, recherche, modification, commande, autre. */
  famille: 'lire' | 'chercher' | 'modifier' | 'commande' | 'autre'
  etat: EtatAction
  /** Duree en secondes, si connue (sert a la largeur du segment de la barre de temps). */
  secondes: number | null
}

function familleDe(outil: string): ActionFrise['famille'] {
  if (/^(Read|NotebookRead)$/i.test(outil)) return 'lire'
  if (/^(Grep|Glob|WebSearch|WebFetch|LS)$/i.test(outil)) return 'chercher'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/i.test(outil)) return 'modifier'
  if (/^(Bash|PowerShell|tache de fond)$/i.test(outil)) return 'commande'
  return 'autre'
}

/** « 45 s », « 2 min 30 s », « 3 min » -> secondes ; null si la chaine ne commence pas par une duree. */
export function secondesDe(texte: string): number | null {
  const m = /^(?:(\d+) min)?\s*(?:(\d+) s)?/.exec(texte.trim())
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
}

/**
 * Actions du tour, UNE PAR LIGNE, avec leur etat et leur duree — la matiere de la frise C3.
 * Memes regles de repli que le corps texte : battements et fins METTENT A JOUR la ligne de leur
 * outil, ils n'en creent pas. Tour termine (`done`) : une action restee sans fin compte comme
 * reussie (l'ancien historique n'a pas de lignes de fin).
 */
export function actionsDuTour(
  statusLog: string[] | undefined,
  status: string | undefined,
  done = false
): ActionFrise[] {
  const lignes = (statusLog?.length ? statusLog : status ? [status] : []).filter(Boolean)
  const sortie: ActionFrise[] = []
  const derniere = (outil: string): number => {
    for (let i = sortie.length - 1; i >= 0; i -= 1) if (sortie[i]!.outil === outil) return i
    return -1
  }
  const nouvelle = (texte: string, outil: string, secondes: number | null): ActionFrise => ({
    texte,
    outil,
    famille: familleDe(outil),
    etat: 'encours',
    secondes
  })
  for (const ligne of lignes) {
    const fin = FIN.exec(ligne)
    const battement = fin ? null : BATTEMENT.exec(ligne)
    if (!fin && !battement) {
      if (sortie.at(-1)?.texte !== ligne) sortie.push(nouvelle(ligne, outilDe(ligne), null))
      continue
    }
    const outil = (fin ?? battement)![1]!.trim()
    const suite = ((fin ? fin[3] : battement![2]) ?? '').trim()
    let index = derniere(outil)
    // Une fin ne rattache qu'une action ENCORE en cours ; un battement, la derniere de son outil.
    if (fin && index >= 0 && sortie[index]!.etat !== 'encours') index = -1
    if (index < 0) {
      sortie.push(
        nouvelle(fin ? `${outil}${suite ? ` — ${suite}` : ''}` : ligne, outil, secondesDe(suite))
      )
      if (fin) sortie.at(-1)!.etat = fin[2] === 'échoué' ? 'ko' : 'ok'
      continue
    }
    const action = sortie[index]!
    if (!fin && BATTEMENT.test(action.texte)) action.texte = ligne
    else
      action.texte = suite
        ? `${action.texte.split(' — ')[0]!} — ${suite}`
        : action.texte.split(' — ')[0]!
    action.secondes = secondesDe(suite) ?? action.secondes
    if (fin) action.etat = fin[2] === 'échoué' ? 'ko' : 'ok'
  }
  if (done) for (const a of sortie) if (a.etat === 'encours') a.etat = 'ok'
  return sortie
}

/** Bilan de l'en-tete C3 : `6 · 1 échec · 44 s`. */
export function bilanDesActions(actions: readonly ActionFrise[]): string {
  const echecs = actions.filter((a) => a.etat === 'ko').length
  const total = actions.reduce((s, a) => s + (a.secondes ?? 0), 0)
  const duree =
    total >= 60
      ? `${Math.floor(total / 60)} min${total % 60 ? ` ${total % 60} s` : ''}`
      : `${total} s`
  return [
    String(actions.length),
    echecs ? `${echecs} échec${echecs > 1 ? 's' : ''}` : '',
    total ? duree : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

export function corpsDesActions(
  statusLog: string[] | undefined,
  status: string | undefined
): string {
  return actionsDuTour(statusLog, status)
    .map((a) => a.texte)
    .join('\n')
}
