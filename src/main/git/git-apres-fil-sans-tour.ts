import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CostSink } from '../dashboards/cost'
import { noterAppelCourt, signalerPanneAppelCourt } from '../orchestration/petites-taches-trace'
import type { ProprietaireDeFichier, ReponseProprietaire } from '../fichiers/proprietaire-fichier'
import type { ProviderRegistry } from '../providers/registry'
import type { RoleModelConfig } from '../profil/roles'
import type {
  AutoCloseResult,
  CommitLocal,
  GitRunner,
  PlageDesCommitsLocaux,
  VerificationAvantPublication
} from '../runs/run-autoclose'
import type { TypageAvantPublication } from '../verify/typage-avant-publication'

/**
 * PUBLIER LES FILS FINIS SANS TOUR DE MODÈLE (2026-11-05).
 *
 * Avant, la passe de `git-apres-fil.ts` ENVOYAIT un message `/git : publie le travail terminé de ce
 * fil…` dans le fil, au nom de l'utilisateur, puis un tour complet du gros modèle triait, commitait
 * et poussait. Demande de l'utilisateur : « je veux pas que ça envoie un message à ma place, je veux
 * que ça appelle un petit modèle, celui d'Agent Studio », et ne voir QUE le bloc git final.
 *
 * Le geste est donc fait par l'app : appartenance prouvée par le journal des fichiers (la même
 * lecture que `proprietaire_fichier`), typage et tests sur une copie propre (les mêmes que
 * l'enchaînement auto), commit et push par `autoCloseRun`. Le seul jugement qui reste — le message
 * de commit — part au modèle des petites tâches, réglé dans Agent Studio (`bindingDesPetitesTaches`).
 *
 * Ce qu'un tri par contenu seul peut trancher (fichier aussi touché par un autre fil, copie d'un
 * run, travail d'agent hors branche) ne part PAS : la passe le dit dans une note, avec un bouton
 * `/git` que l'utilisateur clique lui-même. Tout ou rien : un fichier refusé retient la passe
 * entière, car publier la moitié d'un travail laisse main sans ce dont l'autre moitié dépend.
 *
 * Les commits déjà sur la branche locale (passage de porte d'un fil en copie, voir `git-apres-fil.ts`)
 * partent ensuite, jugés sur une copie au niveau du distant où leurs fichiers sont posés : la même
 * comparaison avant/après que pour les fichiers d'un tour, sans le travail en cours de l'arbre partagé.
 */

/** Ce que la passe rend à la file (`FileGitApresFil`). */
export interface IssueDePasse {
  /** Au moins un commit est parti vers le distant. */
  publie: boolean
  /** Les commandes git `commit`/`push` exactement lancées (La ligne vraie, pas une reconstitution). */
  lignesShell: string[]
  /** Ce que le bandeau doit dire en plus (tests non joués, message de secours…). */
  notes: string[]
  /** Pourquoi rien n'est parti : vide = rien à trier. */
  aTrier: string[]
}

export interface PasseSansTour {
  fil: string
  fichiers: readonly string[]
  /** Les fils dont le travail peut partir : le fil, plus les lots du plan dont il est le chef. */
  fils: readonly string[]
  /** Travaux d'agents restés hors de la branche : jamais repris sans tri par contenu. */
  travaux: number
  /** Un passage de porte est entré dans la branche locale : pousser ce que le distant n'a pas. */
  commitsLocaux?: boolean
}

/** Ce qu'il faut pour pousser les commits de la branche locale absents du distant. */
export interface DepsDesCommitsLocaux {
  /** `undefined` = rien d'avance sur le distant. */
  lire(): Promise<PlageDesCommitsLocaux | undefined>
  /** Pousser la branche emporte TOUS ses commits : chacun doit pouvoir partir (`classerCommitLocal`). */
  classer(commit: CommitLocal): 'oui' | 'plus-tard' | 'non'
  /** Typage et tests sur une copie au niveau du distant, les fichiers de la plage posés dessus. */
  typer(plage: PlageDesCommitsLocaux): Promise<TypageAvantPublication>
  verifier(plage: PlageDesCommitsLocaux): Promise<VerificationAvantPublication>
  pousser(plage: PlageDesCommitsLocaux, runGit: GitRunner): Promise<AutoCloseResult>
}

export interface DepsSansTour {
  repo: string
  runGit: GitRunner
  proprietaires(chemins: string[]): Promise<ReponseProprietaire>
  typer(fichiers: readonly string[]): Promise<TypageAvantPublication>
  verifier(fichiers: readonly string[]): Promise<VerificationAvantPublication>
  /** Le petit modèle : la charge (fichiers + diff) en entrée, sa réponse brute en sortie. */
  rediger(charge: string): Promise<string>
  commiter(message: string, fichiers: string[], runGit: GitRunner): Promise<AutoCloseResult>
  /**
   * Un AUTRE fil du même dépôt a-t-il un tour en cours ? Ses Edit/Write n'arrivent au journal des
   * fichiers qu'à la fin de son appel : ce qu'il écrit n'a pas encore d'auteur.
   * Absent = aucun.
   */
  autreTourEnCours?(): boolean
  /** Absent = la passe ne pousse jamais la branche locale, seulement ses propres commits. */
  commitsLocaux?: DepsDesCommitsLocaux
}

export const CONSIGNE_MESSAGE_DE_COMMIT = [
  "Tu écris le titre du commit d'un changement de code, en français.",
  'Rends UNE seule ligne, rien d’autre : `type(zone): phrase`.',
  'type : feat, fix, refactor, test, docs ou chore. zone : le module touché, un seul mot.',
  'phrase : ce que le changement fait, au présent, 70 caractères au plus.',
  'Aucun numéro de conversation, aucun guillemet, aucun bloc de code.'
].join('\n')

const CHARGE_MAX = 12_000
const TITRE_MAX = 100
const CHEMINS_PAR_LECTURE = 50
const TITRE_VALIDE =
  /^(?:feat|fix|refactor|test|docs|chore|perf|style)\([\p{L}\p{N}._/-]+\): \S.+$/u

/** Pourquoi ce fichier ne part pas sans tri par contenu ; `undefined` = il part. */
export function refusDAppartenance(
  fichier: ProprietaireDeFichier,
  fils: ReadonlySet<string>
): string | undefined {
  if (fichier.refus) return fichier.refus
  if (fichier.copiesDeRun.length)
    return `en cours dans la copie du run ${fichier.copiesDeRun[0]!.run}`
  if (fichier.amont.commits.length)
    return `changé en amont (${fichier.amont.commits.length} commit(s))`
  if (fichier.fils.length === 0) return 'aucun fil tracé ne l’a écrit'
  const autres = [
    ...new Set(fichier.fils.filter((f) => !fils.has(f.conversation)).map((f) => f.conversation))
  ]
  if (autres.length) return `aussi touché par ${autres.join(', ')}`
  if (!fichier.fils[0]!.diffInchange) return 'retouché depuis hors de tout fil tracé'
  return undefined
}

/**
 * Refusé, ET les fils de la passe l'ont seulement VU changer à leur fin de tour (`vuSeulement`) :
 * ce n'est pas leur travail, il ne part pas et ne va pas à la note `/git`. Vrai cas
 * (05/11/2026) : 18 fichiers écrits par un script à 08:13:00, vus par trois fils, et une note
 * `/git` dans chacun pour conclure « rien à publier ». Seul vu sans autre refus, il part encore :
 * c'est une commande du fil qui l'a écrit sans le nommer.
 *
 * SAUF SI UN AUTRE FIL DU DÉPÔT A UN TOUR EN COURS (`autreTourEnCours`, 06/11/2026) : ses
 * écritures ne sont pas encore au journal (traces posées en fin d'appel), donc « vu, sans autre
 * auteur » ne prouve plus rien. Le fichier reste dans l'arbre, à son vrai auteur.
 */
export function vuSeulementEtRefuse(
  fichier: ProprietaireDeFichier,
  fils: ReadonlySet<string>,
  autreTourEnCours = false
): boolean {
  const liens = fichier.fils.filter((f) => fils.has(f.conversation))
  return (
    liens.length > 0 &&
    liens.every((f) => f.vuSeulement) &&
    (autreTourEnCours || refusDAppartenance(fichier, fils) !== undefined)
  )
}

/** Le titre rendu par le petit modèle, s'il a la forme exigée par AGENTS.md ; sinon `undefined`. */
export function titreDuModele(reponse: string): string | undefined {
  const ligne = reponse
    .split(/\r?\n/u)
    .map((l) => l.trim().replace(/^[`"'«»\s]+|[`"'«»\s]+$/gu, ''))
    .find(Boolean)
  if (!ligne) return undefined
  // Un numéro de conversation glissé malgré la consigne : c'est l'app qui pose le vrai.
  const titre = ligne.replace(/(?:\s*\(conv-\d+\))+\s*$/u, '').trim()
  return titre.length <= TITRE_MAX && TITRE_VALIDE.test(titre) ? titre : undefined
}

/** `(conv-A) (conv-B)` : chaque fil dans SA parenthèse, que `commitsPublies` sait retrouver. */
export function messageDeCommit(titre: string, fils: readonly string[]): string {
  return `${titre} ${fils.map((fil) => `(${fil})`).join(' ')}`
}

/** La ligne telle que le shell l'aurait reçue, variable d'environnement comprise. */
function ligneGit(args: readonly string[], env?: Record<string, string>): string {
  const prefixe = Object.entries(env ?? {})
    .map(([cle, valeur]) => `${cle}=${valeur} `)
    .join('')
  const mots = args.map((mot) => (/[\s"]/u.test(mot) ? JSON.stringify(mot) : mot))
  return `${prefixe}git ${mots.join(' ')}`
}

/** La charge du petit modèle : les fichiers, puis leur diff (fichiers nouveaux : leur début). */
async function chargeDuChangement(
  deps: Pick<DepsSansTour, 'repo' | 'runGit'>,
  fichiers: readonly string[]
): Promise<string> {
  const diff = await deps.runGit(['diff', 'HEAD', '--', ...fichiers], deps.repo).catch(() => '')
  const suivis = new Set(
    (await deps.runGit(['ls-files', '--', ...fichiers], deps.repo).catch(() => ''))
      .split(/\r?\n/u)
      .filter(Boolean)
  )
  const nouveaux = fichiers.filter((chemin) => !suivis.has(chemin))
  const contenus = nouveaux.map((chemin) => {
    let texte = ''
    try {
      texte = readFileSync(join(deps.repo, chemin), 'utf8').slice(0, 2_000)
    } catch {
      texte = '(illisible)'
    }
    return `--- nouveau fichier ${chemin}\n${texte}`
  })
  const charge = [`Fichiers : ${fichiers.join(', ')}`, diff, ...contenus].join('\n\n')
  return charge.length > CHARGE_MAX ? `${charge.slice(0, CHARGE_MAX)}\n… (coupé)` : charge
}

async function lireLesProprietaires(
  deps: Pick<DepsSansTour, 'proprietaires'>,
  fichiers: readonly string[]
): Promise<ProprietaireDeFichier[]> {
  const lus: ProprietaireDeFichier[] = []
  for (let i = 0; i < fichiers.length; i += CHEMINS_PAR_LECTURE) {
    lus.push(...(await deps.proprietaires(fichiers.slice(i, i + CHEMINS_PAR_LECTURE))).fichiers)
  }
  return lus
}

export async function publierSansTour(
  deps: DepsSansTour,
  passe: PasseSansTour
): Promise<IssueDePasse> {
  const issue: IssueDePasse = { publie: false, lignesShell: [], notes: [], aTrier: [] }
  if (passe.travaux > 0) {
    issue.aTrier.push(
      `${passe.travaux} travail(s) d’agent resté(s) hors de la branche : à trier par contenu`
    )
  }
  const runGitTrace: GitRunner = (args, cwd, options) => {
    if (args[0] === 'commit' || args[0] === 'push')
      issue.lignesShell.push(ligneGit(args, options?.env))
    return deps.runGit(args, cwd, options)
  }
  const refusAvant = issue.aTrier.length
  if (passe.fichiers.length) await publierLesFichiers(deps, passe, issue, runGitTrace)
  // Tout ou rien, ici aussi : un fichier du fil retenu retient la branche, qui en dépend peut-être.
  if (passe.commitsLocaux && deps.commitsLocaux && issue.aTrier.length === refusAvant)
    await pousserLesCommitsLocaux(deps.commitsLocaux, issue, runGitTrace)
  return issue
}

/** Typage puis tests de ce qui part ; faux = un rouge est noté à trier, et rien ne part. */
async function controler(
  issue: IssueDePasse,
  typer: () => Promise<TypageAvantPublication>,
  verifier: () => Promise<VerificationAvantPublication>,
  quoi?: string
): Promise<boolean> {
  const sur = quoi ? `${quoi} : ` : ''
  const typage = await typer()
  if (typage.statut === 'echec') {
    issue.aTrier.push(
      `${sur}typage rouge (${typage.commande}) : ${typage.erreurs.slice(0, 3).join(' ; ')}`
    )
    return false
  }
  if (typage.statut === 'non-verifie') issue.notes.push(`${sur}typage non joué : ${typage.raison}`)
  const tests = await verifier()
  if (tests.statut === 'echec') {
    issue.aTrier.push(`${sur}tests rouges (${tests.commande}) : ${tests.testsEnEchec.join(', ')}`)
    return false
  }
  if (tests.statut === 'non-verifie') issue.notes.push(`${sur}tests non joués : ${tests.raison}`)
  return true
}

/** Ce que l'envoi a donné : publié, refusé (à trier) ou resté local (dit). */
function noterLEnvoi(resultat: AutoCloseResult, issue: IssueDePasse, geste: string): void {
  if (resultat.status === 'pushed') {
    issue.publie = true
    if (resultat.mode === 'pr')
      issue.notes.push(
        `poussé sur la branche ${resultat.branch}, pas sur la branche courante${resultat.directRefused ? ` (${resultat.directRefused})` : ''}`
      )
  } else if (resultat.status === 'committed') {
    issue.notes.push('commit local seulement : rien n’est parti vers le distant')
  } else if (resultat.status === 'skipped') {
    issue.aTrier.push(
      `${geste} refusé : ${resultat.reason}${resultat.detail ? ` (${resultat.detail})` : ''}`
    )
  } else {
    issue.aTrier.push(`${geste} impossible : ${resultat.error}`)
  }
}

async function pousserLesCommitsLocaux(
  deps: DepsDesCommitsLocaux,
  issue: IssueDePasse,
  runGitTrace: GitRunner
): Promise<void> {
  let plage: PlageDesCommitsLocaux | undefined
  try {
    plage = await deps.lire()
  } catch (erreur) {
    issue.aTrier.push(
      `commits locaux illisibles : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    )
    return
  }
  if (!plage) return
  const lue = plage
  const quoi = `commits restés sur ${lue.branche} local`
  // Le distant a des commits que la branche n'a pas : le push direct serait refusé, et la copie de
  // contrôle jugerait contre une base dépassée. La branche est à réaligner avant tout envoi.
  if (lue.amont !== lue.base) {
    issue.aTrier.push(
      `${quoi} : origin/${lue.branche} a avancé (${lue.amont.slice(0, 9)}), la branche locale est à réaligner avant tout envoi`
    )
    return
  }
  const classes = lue.commits.map((commit) => ({ commit, classe: deps.classer(commit) }))
  const orphelins = classes.filter(({ classe }) => classe === 'non')
  if (orphelins.length) {
    issue.aTrier.push(
      ...orphelins.map(
        ({ commit }) =>
          `${quoi} : ${commit.sha.slice(0, 9)} « ${commit.sujet} » n’est réclamé par aucun fil qui peut publier`
      )
    )
    return
  }
  const attendent = classes.filter(({ classe }) => classe === 'plus-tard').length
  if (attendent) {
    issue.notes.push(
      `${quoi} : ${attendent} commit(s) d’un plan en cours, la branche part à sa fin`
    )
    return
  }
  if (
    !(await controler(
      issue,
      () => deps.typer(lue),
      () => deps.verifier(lue),
      quoi
    ))
  )
    return
  noterLEnvoi(await deps.pousser(lue, runGitTrace), issue, `envoi des ${quoi}`)
}

async function publierLesFichiers(
  deps: DepsSansTour,
  passe: PasseSansTour,
  issue: IssueDePasse,
  runGitTrace: GitRunner
): Promise<void> {
  const autorises = new Set(passe.fils)
  // Relevé AVANT de lire le journal : un tour fini avant ce relevé y a déjà tout écrit.
  const autreTourEnCours = deps.autreTourEnCours?.() ?? false
  const lus = await lireLesProprietaires(deps, passe.fichiers)
  // Un fichier déjà commité (par le fil lui-même, ou à la main) n'a plus rien à publier.
  const sales = lus.filter(
    (f) => (f.nonCommite || f.refus) && !vuSeulementEtRefuse(f, autorises, autreTourEnCours)
  )
  const refus = sales.flatMap((f) => {
    const motif = refusDAppartenance(f, autorises)
    return motif ? [`${f.chemin} : ${motif}`] : []
  })
  if (refus.length) {
    issue.aTrier.push(...refus)
    return
  }
  const partants = sales.map((f) => f.chemin)
  if (partants.length === 0) return
  const auteurs = passe.fils.filter((fil) =>
    sales.some((f) => f.fils.some((proprietaire) => proprietaire.conversation === fil))
  )

  if (
    !(await controler(
      issue,
      () => deps.typer(partants),
      () => deps.verifier(partants)
    ))
  )
    return

  let titre: string | undefined
  let panne = ''
  try {
    const reponse = await deps.rediger(await chargeDuChangement(deps, partants))
    titre = titreDuModele(reponse)
    if (!titre) panne = `réponse hors format (« ${reponse.trim().slice(0, 60)} »)`
  } catch (erreur) {
    panne = erreur instanceof Error ? erreur.message : String(erreur)
  }
  if (!titre) {
    titre = 'chore(publication): travail terminé du fil'
    issue.notes.push(`message de secours : le petit modèle n’a pas rédigé (${panne})`)
  }

  const resultat = await deps.commiter(
    messageDeCommit(titre, auteurs.length ? auteurs : [passe.fil]),
    partants,
    runGitTrace
  )
  noterLEnvoi(resultat, issue, 'commit')
}

/** Le petit modèle d'Agent Studio, branché comme le condenseur du Brain (`brain-condenseur.ts`). */
export function redacteurDeCommit(deps: {
  registry: Pick<ProviderRegistry, 'send'>
  roles: Pick<RoleModelConfig, 'bindingDesPetitesTaches'>
  cost: CostSink
}): (charge: string, conversationId?: string) => Promise<string> {
  return async (charge, conversationId) => {
    const binding = deps.roles.bindingDesPetitesTaches()
    const reponse = await deps.registry
      .send(binding.provider, [{ role: 'user', content: charge }], {
        system: CONSIGNE_MESSAGE_DE_COMMIT,
        systemBlocks: [{ name: 'messageDeCommit', chars: CONSIGNE_MESSAGE_DE_COMMIT.length }],
        model: binding.model,
        reasoningEffort: binding.reasoningEffort,
        // Sans ce profil, Claude prend la branche outillée du tour de chat (petites-taches-trace.ts).
        toolProfile: 'sans-outil',
        requestId: randomUUID()
      })
      .catch((error: unknown) => {
        signalerPanneAppelCourt('messageDeCommit', error)
        throw error
      })
    const texte = (reponse.text ?? '').trim()
    noterAppelCourt(deps.cost, {
      appel: 'messageDeCommit',
      binding,
      res: reponse,
      issue: texte.slice(0, 80),
      ...(conversationId ? { conversationId } : {})
    })
    return texte
  }
}
