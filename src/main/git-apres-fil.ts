import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { signalFinExplicite } from '../shared/prompt-suivant'
import type { AutoCloseReport, GitRunner } from './run-autoclose'

/**
 * « PUBLIER SANS TAPER /git » (conv-1339, 2026-10-30, piste du scout conv-1332).
 *
 * L'ACCORD DE PUBLIER EXISTAIT DÉJÀ : « Enchaînement auto » (conv-267), allumé sur ce poste depuis
 * le 23/10, publie chaque tour réussi dont il PROUVE les fichiers. Un second accord « dans le profil »
 * aurait fait deux interrupteurs pour un même consentement. Ce qui manquait est la suite : dans un
 * dossier partagé, un fichier touché par un autre fil reste en attente (`exclus`), et seul un tri par
 * contenu sait le rendre à son fil. Mesuré le 30/10 : 5 `/git` tapés pour finir ces fils-là, et 3
 * surveillances « /git à la fin du tour » posées à la main (conv-1280, conv-1317) qui n'ont rien
 * publié, car une surveillance tourne en lecture seule (`chat-dispatch.ts`, `readOnly: true`).
 *
 * CET INTERRUPTEUR-CI EST À PART ET ÉTEINT PAR DÉFAUT : chaque lancement est un tour de modèle, donc
 * un coût que l'accord de conv-267 ne couvrait pas. C'est l'utilisateur qui l'allume, jamais le code.
 *
 * « FINI » et « VALIDÉ » ne se devinent pas, ils se lisent :
 *   - fini = le fil a écrit `AUTOWIN_FIN_V1`, la ligne qui éteint déjà le mode auto ;
 *   - validé = l'enchaînement n'a rien refusé pour une raison de QUALITÉ (tests, typage, secret).
 *     Il ne reste que le manque de preuve d'appartenance, le seul refus que `/git` sait lever. Ce
 *     n'est pas une preuve de vert : la consigne de `/git` exige donc de rejouer typage et tests.
 */

/** Fichiers laissés FAUTE DE PREUVE d'appartenance : le seul cas qu'un tri par contenu résout. */
const MOTIFS_DU_DOSSIER_PARTAGE: ReadonlySet<string> = new Set([
  'modifie-avant-le-tour',
  'touche-par-un-autre-fil',
  'autre-fil-en-cours',
  'import-hors-commit'
])

/** Une passe `/git` ou `/salvage` en cours de fin : la relancer ferait une boucle. */
const DEJA_UNE_PUBLICATION = /^\s*\/(?:git|salvage)(?:\s|$)/iu

/**
 * Une demande qui interdit de publier prime sur l'accord permanent. Vécu le 2026-10-01 (conv-770) :
 * « Ne publie rien : aucun commit, aucun push » a été lu comme une demande de publication.
 */
const PUBLICATION_INTERDITE =
  /(?:^|[^\p{L}])(?:ne|n['’])\s*(?:\p{L}+\s+)?(?:publi|pouss|commit|push)|(?:^|[^\p{L}])(?:sans|aucune?|pas\s+de|pas\s+d['’]|interdiction\s+de)\s*(?:commit|push|publi|pouss)/iu

export interface TourFini {
  /** L'interrupteur « Publier les fils finis ». */
  accord: boolean
  /** Le fil travaille dans le dépôt d'Autowin : les autres projets ne se publient pas seuls. */
  dossierAutowin: boolean
  deFond: boolean
  /** Fil chef ou fil de lot : la fin d'un lot a son propre suivi, qu'un tour de plus perturberait. */
  filDePlan: boolean
  /** Le dernier message de l'utilisateur. */
  demande: string
  /** Tous ses messages du fil : un « ne publie rien » du début vaut encore à la fin du fil. */
  demandesDuFil: readonly string[]
  compteRendu: string
  /** Rapport de l'enchaînement auto ; absent = interrupteur éteint, ou rien à publier. */
  rapport: AutoCloseReport | undefined
}

export type DecisionGitApresFil =
  | { lancer: true; fichiers: string[] }
  | {
      lancer: false
      raison:
        | 'accord-absent'
        | 'hors-autowin'
        | 'tour-de-fond'
        | 'fil-de-plan'
        | 'deja-une-publication'
        | 'publication-interdite'
        | 'fil-pas-fini'
        | 'rien-a-rattraper'
        | 'pas-valide'
    }

/** Le rapport dit-il que la QUALITÉ a été refusée, plutôt que l'appartenance non prouvée ? */
function refusDeQualite(rapport: AutoCloseReport): boolean {
  const { project, exclus = [] } = rapport
  if (project.status === 'failed') return true
  if (project.status === 'skipped' && project.reason !== 'unattributed') return true
  return exclus.some((exclu) => !MOTIFS_DU_DOSSIER_PARTAGE.has(exclu.motif))
}

/**
 * Le dossier est-il le dépôt d'Autowin ? Lu dans son `package.json` : `executionWorkspace` ne le dit
 * pas, c'est un dossier que l'utilisateur peut choisir. Sur tout autre projet, l'accord ne vaut pas :
 * Raphaël refuse toute publication qu'il n'a pas demandée sur un projet piloté à distance (Brain,
 * « ne jamais proposer de publier ce qui n'a pas été demandé »).
 */
export function estDepotAutowin(dossier: string): boolean {
  try {
    const paquet = JSON.parse(readFileSync(join(dossier, 'package.json'), 'utf8')) as {
      name?: unknown
    }
    return paquet.name === 'autowin-os'
  } catch {
    return false
  }
}

/** La condition de déclenchement, entière, sans effet de bord. */
export function decisionGitApresFil(tour: TourFini): DecisionGitApresFil {
  if (!tour.accord) return { lancer: false, raison: 'accord-absent' }
  if (!tour.dossierAutowin) return { lancer: false, raison: 'hors-autowin' }
  if (tour.deFond) return { lancer: false, raison: 'tour-de-fond' }
  if (tour.filDePlan) return { lancer: false, raison: 'fil-de-plan' }
  if (DEJA_UNE_PUBLICATION.test(tour.demande))
    return { lancer: false, raison: 'deja-une-publication' }
  if ([tour.demande, ...tour.demandesDuFil].some((texte) => PUBLICATION_INTERDITE.test(texte)))
    return { lancer: false, raison: 'publication-interdite' }
  if (!signalFinExplicite(tour.compteRendu)) return { lancer: false, raison: 'fil-pas-fini' }
  const fichiers = tour.rapport?.exclus?.map((exclu) => exclu.path) ?? []
  if (!tour.rapport || fichiers.length === 0) return { lancer: false, raison: 'rien-a-rattraper' }
  if (refusDeQualite(tour.rapport)) return { lancer: false, raison: 'pas-valide' }
  return { lancer: true, fichiers }
}

const FICHIERS_CITES = 20

/** Le message du tour : `/git` en tête (seule forme reconnue), puis ce que la skill ne devine pas. */
export function promptGitDuFil(conversationId: string, fichiers: readonly string[]): string {
  const reste = fichiers.length - FICHIERS_CITES
  const liste = fichiers.slice(0, FICHIERS_CITES).join(', ')
  return [
    `/git : publie le travail terminé de ce fil (${conversationId}), et lui seul — il vient de se déclarer fini, et l'enchaînement auto n'a pas pu prouver à qui sont ces fichiers.`,
    `Fichiers laissés en attente : ${liste}${reste > 0 ? ` et ${reste} autres` : ''}.`,
    `Chaque commit porte « (${conversationId}) » dans son message.`,
    // `unattributed` sort AVANT le typage et les tests (chat-turn-publication.ts) : quand tout est
    // laissé en attente, rien n'a été vérifié, et « validé » ne veut dire que « rien n'a été refusé ».
    'Avant de pousser : typage et tests de ce qui part, joués sur une copie propre. Rouge = ne publie rien, et dis pourquoi.',
    "Interdit : le travail d'un fil dont le tour tourne encore, push --force, stash, reset --hard, checkout -- sur un fichier d'un autre fil.",
    `Si rien à faire : « Rien à publier pour ${conversationId} ».`
  ].join('\n')
}

export interface CommitPublie {
  sha: string
  sujet: string
}

/** Au-delà, le libellé dépasserait `LONGUEUR_MAX_PROMPT` (300) et le fil ignorerait le bouton. */
const COMMITS_DANS_LE_BOUTON = 25

const echapper = (texte: string): string =>
  texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * La note « publié » posée dans le fil, avec son bouton d'annulation. Le fil envoie le LIBELLÉ du
 * lien (`bouton-prompt-html.ts`) : ce qui sera annulé est écrit sur le bouton, et l'annulation est
 * un tour ordinaire, demandé par un clic. Un `git revert` direct depuis l'app buterait sur un arbre
 * partagé plein du travail des autres fils.
 */
export function bandeauPublie(commits: readonly CommitPublie[]): string {
  const n = commits.length
  const lignes = commits
    .slice(0, COMMITS_DANS_LE_BOUTON)
    .map(
      (commit) =>
        `<div><span class="aw-chip">${echapper(commit.sha)}</span> ${echapper(commit.sujet)}</div>`
    )
  const annuler =
    n <= COMMITS_DANS_LE_BOUTON
      ? `<a class="aw-chip awp-annuler" href="#autowin-prompt">Annuler la publication (git revert ${commits.map((c) => c.sha).join(' ')}, puis push)</a>`
      : `<div class="aw-discret">Commits trop nombreux pour un bouton : demande leur annulation dans le fil.</div>`
  return [
    '```html-render',
    // Sans cette règle, le lien sort dans le bleu par défaut du navigateur, illisible sur fond sombre.
    '<style>.awp-annuler{display:inline-block;margin-top:6px;color:inherit;font-weight:600;text-decoration:none;cursor:pointer}</style>',
    '<div class="aw-kicker">Publié sans /git</div>',
    `<div><b class="aw-chiffre">${n} commit${n > 1 ? 's' : ''}</b> de ce fil <b>sont en ligne</b>.</div>`,
    ...lignes,
    annuler,
    '```'
  ].join('\n')
}

/** Le SHA de l'amont de la branche courante ; `undefined` sans amont : la passe ne tombe pas. */
export async function lireAmont(runGit: GitRunner, dossier: string): Promise<string | undefined> {
  try {
    return (await runGit(['rev-parse', '@{u}'], dossier)).trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Les commits de CE fil arrivés en amont depuis `depuis`, du plus récent au plus ancien : l'ordre
 * d'un `git revert`. Lus sur `@{u}` et non sur HEAD : un commit resté local n'est pas « publié ».
 * La parenthèse fermante du motif empêche `conv-9` d'attraper `conv-99`.
 */
export async function commitsPublies(
  runGit: GitRunner,
  dossier: string,
  depuis: string,
  conversationId: string
): Promise<CommitPublie[]> {
  const sortie = await runGit(
    [
      'log',
      '--abbrev=8',
      '--format=%h%x09%s',
      '--fixed-strings',
      `--grep=(${conversationId})`,
      `${depuis}..@{u}`
    ],
    dossier
  )
  return sortie
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter(Boolean)
    .map((ligne) => {
      const [sha = '', ...sujet] = ligne.split('\t')
      return { sha, sujet: sujet.join('\t') }
    })
}

export interface DepsGitApresFil {
  lancerTour(
    conversationId: string,
    prompt: string
  ): Promise<{ ok: boolean; cancelled?: boolean; error?: string }>
  filOccupe(conversationId: string): boolean
  lireAmont(conversationId: string): Promise<string | undefined>
  commitsDepuis(conversationId: string, depuis: string): Promise<CommitPublie[]>
  annoncer(conversationId: string, contenu: string): void
  journal?(message: string, detail?: unknown): void
}

/**
 * UNE PASSE À LA FOIS, tous fils confondus : deux `/git` simultanés dans le même dossier se marchent
 * dessus (index, push, réalignement de l'arbre). La file vit en mémoire : un redémarrage la vide sans
 * rien perdre, le travail attend dans l'arbre comme avant, et le tour suivant du fil le reproposera.
 */
export class FileGitApresFil {
  readonly #deps: DepsGitApresFil
  readonly #attente = new Map<string, string[]>()
  #occupee = false

  constructor(deps: DepsGitApresFil) {
    this.#deps = deps
  }

  ajouter(conversationId: string, fichiers: readonly string[]): void {
    const deja = this.#attente.get(conversationId) ?? []
    this.#attente.set(conversationId, [...new Set([...deja, ...fichiers])])
    void this.#suivant()
  }

  async #suivant(): Promise<void> {
    if (this.#occupee) return
    const prochain = this.#attente.entries().next().value
    if (!prochain) return
    const [fil, fichiers] = prochain
    this.#attente.delete(fil)
    this.#occupee = true
    try {
      await this.#publier(fil, fichiers)
    } catch (erreur) {
      // Une passe ratée ne perd rien : le travail reste dans l'arbre, et la suivante doit partir.
      this.#deps.journal?.(`passe impossible pour ${fil}`, erreur)
    } finally {
      this.#occupee = false
      void this.#suivant()
    }
  }

  async #publier(fil: string, fichiers: readonly string[]): Promise<void> {
    // Le fil a repris depuis sa fin (la publication prend du temps) : il n'est plus fini.
    if (this.#deps.filOccupe(fil)) {
      this.#deps.journal?.(`${fil} a repris : passe sautée`)
      return
    }
    const avant = await this.#deps.lireAmont(fil)
    const resultat = await this.#deps.lancerTour(fil, promptGitDuFil(fil, fichiers))
    if (!resultat.ok || resultat.cancelled) {
      this.#deps.journal?.(`passe sans publication pour ${fil}`, resultat.error)
      return
    }
    if (!avant) return
    const commits = await this.#deps.commitsDepuis(fil, avant)
    if (commits.length) this.#deps.annoncer(fil, bandeauPublie(commits))
  }
}
