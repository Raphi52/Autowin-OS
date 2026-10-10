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

/** `17 s`, `1 min`, `2 min 5 s` — une duree en secondes, telle que les en-tetes l'affichent. */
export function dureeLisible(secondes: number): string {
  return secondes >= 60
    ? `${Math.floor(secondes / 60)} min${secondes % 60 ? ` ${secondes % 60} s` : ''}`
    : `${secondes} s`
}

/** Somme des durees connues des actions — la duree affichee dans la capsule Actions. */
export function secondesDesActions(actions: readonly ActionFrise[]): number {
  return actions.reduce((s, a) => s + (a.secondes ?? 0), 0)
}

/**
 * Bilan complet des actions : `6 · 1 échec · 44 s`. Depuis la capsule R5 (conv-162, 2026-10-10)
 * l'en-tete n'ECRIT plus que le nombre et la duree ; les echecs se lisent en rouge dans la barre.
 * Ce bilan reste l'infobulle de la capsule : le nombre d'echecs n'est jamais perdu.
 */
export function bilanDesActions(actions: readonly ActionFrise[]): string {
  const echecs = actions.filter((a) => a.etat === 'ko').length
  const total = secondesDesActions(actions)
  return [
    String(actions.length),
    echecs ? `${echecs} échec${echecs > 1 ? 's' : ''}` : '',
    total ? dureeLisible(total) : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * CHRONO DU RAISONNEMENT — le compteur de secondes de la capsule « Raisonnement » (variante R5,
 * conv-162 : « pas les mots de raisonnement, seulement un compteur de secondes »).
 *
 * PENDANT le tour, le chrono est MESURE A L'ECRAN, de l'apparition du bloc jusqu'a la fin du tour.
 * A la cloture, le processus principal enregistre la meme mesure avec le tour (`reasoningMs` de
 * `ChatTurnState`, run-pilot-chat.ts) : un tour relu sans chrono en memoire affiche cette valeur.
 * Un tour ancien qui n'a ni l'un ni l'autre n'affiche aucun compteur plutot qu'un chiffre invente.
 *
 * Le bloc peut etre DEMONTE puis remonte pendant le tour (changement de conversation, liste
 * virtualisee) : le debut est donc memorise par tour (`turnId`) pour ne pas repartir de zero.
 */
export type Chrono = { debut: number; fin?: number }

const CHRONOS = new Map<string, Chrono>()
const CHRONOS_MAX = 200

export function chronoMemorise(cle: string | undefined): Chrono | null {
  return (cle && CHRONOS.get(cle)) || null
}

export function memoriserChrono(cle: string, chrono: Chrono): void {
  CHRONOS.delete(cle)
  CHRONOS.set(cle, chrono)
  // Borne : on oublie le plus ancien tour, jamais le courant (il vient d'etre re-insere en dernier).
  if (CHRONOS.size > CHRONOS_MAX) CHRONOS.delete(CHRONOS.keys().next().value!)
}

/** Secondes ecoulees : jusqu'a la fin memorisee si elle existe, sinon jusqu'a `maintenant`. */
export function secondesDuChrono(chrono: Chrono | null, maintenant: number): number | null {
  if (!chrono) return null
  return Math.max(0, Math.floor(((chrono.fin ?? maintenant) - chrono.debut) / 1000))
}

export function corpsDesActions(
  statusLog: string[] | undefined,
  status: string | undefined
): string {
  return actionsDuTour(statusLog, status)
    .map((a) => a.texte)
    .join('\n')
}
