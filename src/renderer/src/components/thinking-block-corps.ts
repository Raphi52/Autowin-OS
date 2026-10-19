/*
 * Corps des blocs « Raisonnement » et « Actions » — hors du composant EXPRES : un fichier qui
 * exporte a la fois un composant et une fonction casse le rechargement a chaud de React
 * (regle react-refresh/only-export-components). Le calcul est pur, il n'a pas besoin du composant.
 */
import { estLigneDEtape, lireLigneDEtape, type Etape } from '../../../shared/etapes-du-tour'
import { lireLigneDErreur } from '../../../shared/erreur-d-action'

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

/** Un morceau d'un paragraphe de pensée : du texte, ou un `code` à dessiner en puce. */
export type MorceauDePensee = { code: boolean; texte: string }

/**
 * Le corps DÉPLIÉ du Raisonnement en PARAGRAPHES (conv-335, 2026-10-18, « Implémenter 1 + 3 » :
 * Liseuse + Fil de pensée). Chaque paragraphe prend un point numéroté sur le rail : on coupe aux
 * lignes vides — plusieurs à la suite n'en font qu'une, et aucun paragraphe vide ne naît. Un retour
 * à la ligne simple reste DANS son paragraphe. Les `code` sortent en morceaux à part, pour être
 * dessinés en puce ; un accent grave seul (pensée en cours d'écriture) reste du texte.
 */
export function paragraphesDeLaPensee(text: string): MorceauDePensee[][] {
  return text
    .split(/\n[ \t]*\n\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const morceaux: MorceauDePensee[] = []
      let depuis = 0
      for (const m of p.matchAll(/`([^`\n]+)`/g)) {
        if (m.index > depuis) morceaux.push({ code: false, texte: p.slice(depuis, m.index) })
        morceaux.push({ code: true, texte: m[1]! })
        depuis = m.index + m[0].length
      }
      if (depuis < p.length) morceaux.push({ code: false, texte: p.slice(depuis) })
      return morceaux
    })
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

/**
 * TACHE NOMMEE (conv-910, 2026-10-12 : « une tache de fond est dépliable pour voir la liste
 * d'actions liées […] n'écris pas tache de fond, écris direct ce qu'est la tache de fond »).
 *
 * Ce que le CLI appelle une tache (`task_started` / `task_notification`, relayes par claude.ts en
 * « tache de fond en cours - <description> » puis « tache de fond terminee - <description> ») n'est
 * PAS un travail a part : c'est la commande Bash en cours elle-meme, devenue longue. Mesure sur le
 * flux brut du tour de la capture (run-stdout c10e16e5…, conv-906) : les 12 taches portent toutes
 * `task_type: local_bash`, `is_backgrounded: false` et le `tool_use_id` de l'appel Bash qui les
 * precede ; l'ordre recu est `Bash · <commande>` → tache en cours → tache terminee → `Bash terminé`.
 * Elles ajoutaient donc DEUX lignes et deux pastilles de legende par commande, sous un libelle qui
 * ne disait pas ce qu'elle faisait — la legende du bloc plie s'etalait sur dix lignes.
 *
 * Regle : la tache NOMME la commande qu'elle enveloppe (la plus ancienne commande encore en cours
 * sans nom — deux commandes lancees en parallele gardent chacune la sienne), et ses actions liees
 * sont les commandes que cette ligne Bash enchaine. Aucune ligne « tache de fond » n'est ecrite.
 */
const TACHE = /^tache de fond (en cours|terminee|en echec|[a-z]+)(?: - (.*))?$/

export type ActionFrise = {
  /** Texte de la ligne — inchange par rapport au corps texte (`outil · cible — duree`). */
  texte: string
  outil: string
  /** Famille d'icone : lecture, recherche, modification, commande, autre. */
  famille: 'lire' | 'chercher' | 'modifier' | 'commande' | 'autre'
  etat: EtatAction
  /** Duree en secondes, si connue (sert a la largeur du segment de la barre de temps). */
  secondes: number | null
  /** Ce que fait la commande, quand le CLI l'a decrite (voir TACHE). Le texte devient ce nom. */
  tache?: { nom: string; etat: EtatAction }
  /** Les commandes enchainees par cette ligne — ce qu'on lit en depliant une tache nommee. */
  sousActions?: string[]
  /** Message rendu par l'outil en ÉCHEC (ligne `<outil> erreur - …`, conv-341) : dit sous la ligne. */
  erreur?: string
}

/**
 * Coupe le libelle d'une commande coupee a 120 caracteres par claude.ts (`cible.slice(0, 120)`) :
 * au-dela, la derniere sous-commande est un moignon, et on le dit par « … ».
 */
const CIBLE_MAX = 120

/**
 * Les commandes d'une ligne shell, dans l'ordre : coupees sur `&&`, `||`, `;` et le retour a la
 * ligne HORS guillemets. Un tube (`|`) reste une seule action — c'est une seule commande qui
 * coule dans une autre. Un here-doc (`<<`) garde ses lignes : ce sont des donnees, pas des actions.
 */
export function sousCommandes(commande: string): string[] {
  const sortie: string[] = []
  const coupeLigne = !commande.includes('<<')
  let courante = ''
  let guillemet: string | null = null
  const pousser = (): void => {
    const propre = courante.trim()
    if (propre) sortie.push(propre)
    courante = ''
  }
  for (let i = 0; i < commande.length; i += 1) {
    const c = commande[i]!
    if (c === '\\' && guillemet !== "'" && i + 1 < commande.length) {
      courante += c + commande[i + 1]!
      i += 1
      continue
    }
    if (guillemet) {
      courante += c
      if (c === guillemet) guillemet = null
      continue
    }
    if (c === '"' || c === "'") {
      guillemet = c
      courante += c
      continue
    }
    const deux = commande.slice(i, i + 2)
    if (deux === '&&' || deux === '||') {
      pousser()
      i += 1
      continue
    }
    if (c === ';' || (c === '\n' && coupeLigne)) {
      pousser()
      continue
    }
    courante += c
  }
  pousser()
  return sortie
}

/**
 * Le signe de vie COURANT, tel que la seconde ligne du bloc plie l'affiche : une tache s'y lit par
 * ce qu'elle fait (« Run the new trace event tests »), jamais par « tache de fond en cours - … ».
 */
export function statutLisible(statut: string): string {
  const tache = TACHE.exec(statut)
  if (!tache) return statut.replace(/^tache de fond /, 'commande ')
  const nom = (tache[2] ?? '').trim()
  const issue = tache[1]!
  if (issue === 'en cours') return nom || 'commande en cours'
  const fin = issue === 'terminee' ? 'terminée' : issue === 'en echec' ? 'en échec' : issue
  return nom ? `${nom} · ${fin}` : `commande ${fin}`
}

function familleDe(outil: string): ActionFrise['famille'] {
  if (/^(Read|NotebookRead)$/i.test(outil)) return 'lire'
  if (/^(Grep|Glob|WebSearch|WebFetch|LS)$/i.test(outil)) return 'chercher'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/i.test(outil)) return 'modifier'
  if (/^(Bash|PowerShell|Commande)$/i.test(outil)) return 'commande'
  return 'autre'
}

/** « 45 s », « 2 min 30 s », « 3 min » -> secondes ; null si la chaine ne commence pas par une duree. */
export function secondesDe(texte: string): number | null {
  const m = /^(?:(\d+) min)?\s*(?:(\d+) s)?/.exec(texte.trim())
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
}

/** Ligne du journal qui a créé chaque action (voir `actionsDuTour`) — lue par `avancementDesEtapes`. */
const ORIGINE = new WeakMap<ActionFrise, number>()

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
  // Les lignes d'ÉTAPES (TaskCreate / TaskUpdate du CLI) ne sont pas des actions : elles nourrissent
  // le bloc Étapes (shared/etapes-du-tour.ts).
  const lignes = (statusLog?.length ? statusLog : status ? [status] : []).flatMap((ligne, i) =>
    ligne && !estLigneDEtape(ligne) ? [{ ligne, i }] : []
  )
  const sortie: ActionFrise[] = []
  // ORIGINE de chaque action : l'index, dans le journal ENTIER (étapes comprises), de la ligne qui
  // l'a créée — l'avancement des étapes la rattache à l'étape en cours à cet endroit. Les actions
  // ne sont jamais retirées de `sortie` : celles ajoutées depuis la dernière marque viennent de la
  // ligne précédente, quel que soit le `continue` qui l'a close.
  let marque = 0
  let origine = -1
  const dater = (): void => {
    for (; marque < sortie.length; marque += 1) ORIGINE.set(sortie[marque]!, origine)
  }
  const derniere = (outil: string): number => {
    for (let i = sortie.length - 1; i >= 0; i -= 1) if (sortie[i]!.outil === outil) return i
    return -1
  }
  const plusAncienneOuverte = (outil: string): number =>
    sortie.findIndex((a) => a.outil === outil && a.etat === 'encours')
  const nouvelle = (texte: string, outil: string, secondes: number | null): ActionFrise => ({
    texte,
    outil,
    famille: familleDe(outil),
    etat: 'encours',
    secondes
  })
  // L'action que la DERNIÈRE ligne de fin a fermée : son message d'erreur la suit immédiatement.
  let fermeeEnDernier = -1
  for (const { ligne, i } of lignes) {
    dater()
    origine = i
    // MESSAGE D'ERREUR d'une action rouge (conv-341) : il ne crée pas de ligne, il se range SOUS
    // l'action que la ligne de fin précédente vient de fermer — la plus récente en échec de son
    // outil si cette fin manque (journal borné, tour relu).
    const erreur = lireLigneDErreur(ligne)
    if (erreur) {
      const juste = sortie[fermeeEnDernier]
      const cible =
        juste?.outil === erreur.outil && juste.etat === 'ko'
          ? juste
          : sortie.findLast((a) => a.outil === erreur.outil && a.etat === 'ko')
      if (cible) cible.erreur = erreur.message
      continue
    }
    const tache = TACHE.exec(ligne)
    if (tache) {
      const nom = (tache[2] ?? '').trim()
      const etat: EtatAction =
        tache[1] === 'en cours' ? 'encours' : tache[1] === 'terminee' ? 'ok' : 'ko'
      if (etat === 'encours') {
        // La PLUS ANCIENNE commande en cours encore sans nom : deux Bash lances ensemble recoivent
        // leur tache dans l'ordre de lancement, pas tous deux la derniere.
        const cible = sortie.find(
          (a) =>
            a.etat === 'encours' &&
            !a.tache &&
            (a.famille === 'commande' || /^(Agent|Task)$/.test(a.outil))
        )
        if (cible) cible.tache = { nom, etat }
        else sortie.push({ ...nouvelle(nom || 'commande', 'Commande', null), tache: { nom, etat } })
        continue
      }
      // Une fin rattache la tache EN COURS du meme nom (la plus recente), sinon la derniere ouverte.
      const ouvertes = sortie.filter((a) => a.tache?.etat === 'encours')
      const cible = ouvertes.filter((a) => a.tache!.nom === nom).at(-1) ?? ouvertes.at(-1)
      if (cible) cible.tache!.etat = etat
      else {
        // Fin sans debut vu (tour relu, journal borne) : la ligne existe quand meme, terminee.
        const seule = { ...nouvelle(nom || 'commande', 'Commande', null), tache: { nom, etat } }
        seule.etat = etat
        sortie.push(seule)
      }
      continue
    }
    const fin = FIN.exec(ligne)
    const battement = fin ? null : BATTEMENT.exec(ligne)
    if (!fin && !battement) {
      if (sortie.at(-1)?.texte !== ligne) sortie.push(nouvelle(ligne, outilDe(ligne), null))
      continue
    }
    const outil = (fin ?? battement)![1]!.trim()
    const suite = ((fin ? fin[3] : battement![2]) ?? '').trim()
    // Une fin rattache la PLUS ANCIENNE action de son outil encore en cours — l'ordre de lancement,
    // comme les taches de fond ci-dessus ; un battement, la derniere de son outil.
    // DEUX Bash LANCES ENSEMBLE (conv-937, 2026-10-13) : la fin ne porte pas d'identifiant. Ne
    // regarder que la DERNIERE action laissait la 2e fin sans cible des que la 1re l'avait close :
    // elle creait une action FANTOME (11 actions pour 10 commandes), la premiere commande restait
    // ouverte et prenait le nom de la tache de fond de la seconde.
    const index = fin ? plusAncienneOuverte(outil) : derniere(outil)
    if (index < 0) {
      sortie.push(
        nouvelle(fin ? `${outil}${suite ? ` — ${suite}` : ''}` : ligne, outil, secondesDe(suite))
      )
      if (fin) {
        sortie.at(-1)!.etat = fin[2] === 'échoué' ? 'ko' : 'ok'
        fermeeEnDernier = sortie.length - 1
      }
      continue
    }
    if (fin) fermeeEnDernier = index
    const action = sortie[index]!
    if (!fin && BATTEMENT.test(action.texte)) action.texte = ligne
    else
      action.texte = suite
        ? `${action.texte.split(' — ')[0]!} — ${suite}`
        : action.texte.split(' — ')[0]!
    action.secondes = secondesDe(suite) ?? action.secondes
    if (fin) action.etat = fin[2] === 'échoué' ? 'ko' : 'ok'
  }
  dater()
  for (const a of sortie) {
    if (!a.tache) continue
    // La ligne garde l'etat le plus grave de la commande et de sa tache : une commande lancee en
    // arriere-plan rend la main en 0 s mais sa tache tourne encore.
    a.etat =
      a.etat === 'ko' || a.tache.etat === 'ko'
        ? 'ko'
        : a.etat === 'encours' || a.tache.etat === 'encours'
          ? 'encours'
          : 'ok'
    if (!a.tache.nom || a.outil === 'Commande') continue
    const [tete, ...suite] = a.texte.split(' — ')
    const commande = tete!.replace(/^[^·]*·\s*/, '')
    const actions = sousCommandes(commande)
    if (actions.length && commande.length >= CIBLE_MAX) actions[actions.length - 1] += '…'
    a.sousActions = actions
    a.texte = [a.tache.nom, ...suite].join(' — ')
  }
  if (done) for (const a of sortie) if (a.etat === 'encours') a.etat = 'ok'
  return sortie
}

/**
 * Le signe de vie a afficher sous la capsule ACTIONS : la derniere ligne qui n'est pas une etape.
 * Sans ce tri, un TaskUpdate venu en dernier ferait lire « Étape #2 en cours » sous « Actions ».
 */
export function dernierStatutDAction(
  statusLog: readonly string[] | undefined,
  status: string | undefined
): string | undefined {
  // Le message d'erreur d'une action (conv-341) se lit sous sa ligne, déplié : sous la capsule,
  // c'est « Glob échoué - 25 s » qui reste, pas 280 caractères de sortie d'outil.
  const parle = (ligne: string): boolean => !estLigneDEtape(ligne) && !lireLigneDErreur(ligne)
  if (status && parle(status)) return status
  for (let i = (statusLog?.length ?? 0) - 1; i >= 0; i -= 1) {
    const ligne = statusLog![i]!
    if (ligne && parle(ligne)) return ligne
  }
  return undefined
}

/**
 * Ce que dit la seconde ligne du bloc ÉTAPES plie, comme la ligne a spinner de claude.exe :
 * l'etape EN COURS ; sinon la prochaine a faire ; sinon la fin.
 */
export function resumeDesEtapes(etapes: readonly Etape[]): string {
  const enCours = etapes.find((e) => e.statut === 'in_progress')
  if (enCours) return enCours.sujet || `Étape #${enCours.id}`
  const suivante = etapes.find((e) => e.statut === 'pending')
  if (suivante) return `Ensuite : ${suivante.sujet || `étape #${suivante.id}`}`
  return etapes.length > 0 ? 'Toutes les étapes sont terminées' : ''
}

/**
 * AVANCEMENT DE CHAQUE ÉTAPE (conv-303, 2026-10-17 : « un bloc qui montre comment la tâche est
 * décomposée et la progression de chaque tâche »). claude.exe ne donne que TROIS états par étape,
 * jamais un pourcentage : ce qui se mesure, ce sont les actions lancées pendant qu'elle était en
 * cours, et leur durée connue. Une action appartient à l'étape EN COURS à la ligne qui l'a créée (le
 * journal mêle étapes et actions dans l'ordre) ; avant toute étape en cours, à aucune.
 */
export type AvancementEtape = { actions: number; secondes: number }

export function avancementDesEtapes(
  statusLog: readonly string[] | undefined,
  status: string | undefined,
  frise: readonly ActionFrise[]
): Map<string, AvancementEtape> {
  // La MÊME source que `actionsDuTour` : les index d'origine s'y rapportent.
  const source = statusLog?.length ? statusLog : status ? [status] : []
  const enCoursA: Array<string | null> = []
  let enCours: string | null = null
  for (const ligne of source) {
    const etape = ligne ? lireLigneDEtape(ligne) : null
    if (etape?.statut === 'in_progress') enCours = etape.id
    else if (etape && etape.id === enCours) enCours = null
    enCoursA.push(enCours)
  }
  const parEtape = new Map<string, AvancementEtape>()
  for (const action of frise) {
    const i = ORIGINE.get(action)
    const id = i === undefined ? null : (enCoursA[i] ?? null)
    if (!id) continue
    const avancement = parEtape.get(id) ?? { actions: 0, secondes: 0 }
    avancement.actions += 1
    avancement.secondes += action.secondes ?? 0
    parEtape.set(id, avancement)
  }
  return parEtape
}

/**
 * Ce qu'une étape affiche à droite de sa barre : ses actions et sa durée, sinon son état.
 * La durée est celle MESURÉE à l'écran (`mesure`, voir `avancerChronosDesEtapes`) quand elle existe,
 * sinon la somme des durées de ses actions — seule mesure d'un tour relu.
 */
export function valeurDeLEtape(
  etape: Etape,
  avancement: AvancementEtape | undefined,
  mesure: number | null = null
): string {
  const n = avancement?.actions ?? 0
  const secondes = mesure ?? avancement?.secondes ?? 0
  const duree = secondes > 0 ? ` · ${dureeLisible(secondes)}` : ''
  if (n === 0)
    return etape.statut === 'completed'
      ? `terminée${duree}`
      : etape.statut === 'in_progress'
        ? `en cours${duree}`
        : 'à faire'
  return `${n} action${n > 1 ? 's' : ''}${duree}`
}

/**
 * PIED AU TEMPS (conv-326, 2026-10-18, /draft « des meilleures barres de progression pour ce bloc »
 * en trois tours : « le 3 et 4 », « Affiner la 6 · Pastilles numérotées », puis « Implémenter la 5 ·
 * Pied au temps »). Sous la liste, une jauge dont chaque segment a la largeur du temps de son étape :
 * la MÊME durée que sa valeur (`valeurDeLEtape` — chrono mesuré à l'écran, sinon somme des actions).
 * Une étape à faire n'a encore aucune durée : son segment est court et de largeur fixe (`part: null`),
 * rien n'est inventé. Rien de mesuré encore : les étapes commencées se partagent la jauge à parts
 * égales, et le total est 0 (le pied ne l'affiche pas).
 */
export type SegmentDuPied = {
  id: string
  /** Rang dans la liste, à partir de 1 : le numéro de la pastille de la même étape. */
  numero: number
  statut: Etape['statut']
  /** Part de la jauge (flex-grow) ; `null` = étape à faire, segment de largeur fixe. */
  part: number | null
}

export function piedDesEtapes(
  etapes: readonly Etape[],
  avancement: ReadonlyMap<string, AvancementEtape>,
  mesures: ReadonlyMap<string, number>
): { segments: SegmentDuPied[]; total: number } {
  const duree = (e: Etape): number => mesures.get(e.id) ?? avancement.get(e.id)?.secondes ?? 0
  const total = etapes.reduce((s, e) => (e.statut === 'pending' ? s : s + duree(e)), 0)
  return {
    total,
    segments: etapes.map((e, i) => ({
      id: e.id,
      numero: i + 1,
      statut: e.statut,
      part: e.statut === 'pending' ? null : total > 0 ? duree(e) : 1
    }))
  }
}

/**
 * CHRONO DE CHAQUE ÉTAPE (conv-313, 2026-10-17 : « le timer est fix dans ce bloc »). La somme des
 * durées d'outils ne bouge qu'à la fin d'un outil — ou au battement de 30 s d'un outil long — et
 * jamais pendant que le modèle réfléchit entre deux outils : sous une étape EN COURS, « 59 s »
 * restait figé. Comme le chrono du Raisonnement, le temps d'une étape se MESURE donc à l'écran : il
 * part quand l'étape passe en cours, s'arrête quand elle est terminée ou que le tour finit.
 *
 * Une étape déjà en cours quand le bloc apparaît (conversation ouverte en plein tour) part de la
 * durée de ses actions déjà connue, pas de zéro. Une étape vue seulement terminée n'a pas de chrono :
 * elle garde la somme de ses actions. Une étape rouverte reprend son début, comme un tour rallumé.
 */
export type ChronosDesEtapes = ReadonlyMap<string, Chrono>

const CHRONOS_DES_ETAPES = new Map<string, ChronosDesEtapes>()

export function chronosDesEtapesMemorises(cle: string | undefined): ChronosDesEtapes {
  return (cle && CHRONOS_DES_ETAPES.get(cle)) || new Map()
}

export function memoriserChronosDesEtapes(cle: string, chronos: ChronosDesEtapes): void {
  CHRONOS_DES_ETAPES.delete(cle)
  CHRONOS_DES_ETAPES.set(cle, chronos)
  if (CHRONOS_DES_ETAPES.size > CHRONOS_MAX)
    CHRONOS_DES_ETAPES.delete(CHRONOS_DES_ETAPES.keys().next().value!)
}

/** Les chronos à l'instant `maintenant` ; rend l'objet REÇU tel quel si rien n'a changé. */
export function avancerChronosDesEtapes(
  chronos: ChronosDesEtapes,
  etapes: readonly Etape[],
  avancement: ReadonlyMap<string, AvancementEtape>,
  maintenant: number,
  done: boolean
): ChronosDesEtapes {
  let suite: Map<string, Chrono> | null = null
  const poser = (id: string, chrono: Chrono): void => {
    suite ??= new Map(chronos)
    suite.set(id, chrono)
  }
  for (const e of etapes) {
    const c = chronos.get(e.id)
    if (e.statut === 'in_progress' && !done) {
      if (!c) poser(e.id, { debut: maintenant - (avancement.get(e.id)?.secondes ?? 0) * 1000 })
      else if (c.fin !== undefined) poser(e.id, { debut: c.debut })
    } else if (c && c.fin === undefined && e.statut !== 'pending') {
      poser(e.id, { debut: c.debut, fin: maintenant })
    }
  }
  return suite ?? chronos
}

/** Secondes mesurées de chaque étape en cours ou terminée qui a un chrono. */
export function secondesDesEtapes(
  etapes: readonly Etape[],
  chronos: ChronosDesEtapes,
  maintenant: number
): Map<string, number> {
  const sortie = new Map<string, number>()
  for (const e of etapes) {
    const c = chronos.get(e.id)
    if (c && e.statut !== 'pending') sortie.set(e.id, secondesDuChrono(c, maintenant)!)
  }
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
