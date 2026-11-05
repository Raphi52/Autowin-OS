import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deposerFichier, relireFichier } from './ecriture-hors-fil'
import type { StatutDuPlan } from '../shared/plan-de-lots'
import type { AutoCloseReport, GitRunner } from './run-autoclose'
import { titreDuBandeau } from './titre-bandeau-git'

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
 * « FINI » NE SE LIT PLUS DANS `AUTOWIN_FIN_V1` (conv-1544, 2026-11-04). Mesuré sur 7 jours :
 * 35 `/git` tapés à la main, dont 3 seulement après un tour qui avait écrit cette ligne, et UNE
 * seule publication par cet interrupteur. Presque aucun fil ne l'écrit : la consigne la réserve au
 * fil sans aucune suite, et chaque tour propose ses suites. Fini = le fil est resté CALME
 * `CALME_AVANT_PUBLICATION_MS` après la fin de son tour (`FileGitApresFil`) : un mode auto qui
 * enchaîne ses tours repousse la passe, et un seul `/git` part par pause au lieu d'un par tour.
 *
 * « VALIDÉ » ne se devine pas, il se lit :
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
  /** Le dernier message de l'utilisateur. */
  demande: string
  /** Tous ses messages du fil : un « ne publie rien » du début vaut encore à la fin du fil. */
  demandesDuFil: readonly string[]
  /** Plus lu depuis conv-1544 (voir l'en-tête) ; encore passé par `ipc/chat.ts`. */
  compteRendu?: string
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
        | 'deja-une-publication'
        | 'publication-interdite'
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

/** Ce que le coordinateur des plans dit d'un fil (`planDuFil`), réduit à ce qu'il faut ici. */
export interface FilDansUnPlan {
  role: 'chef' | 'enfant'
  plan: { chef: string; statut: StatutDuPlan }
}

/** Un plan dont des lots peuvent encore écrire : la passe de son chef attend sa fin (conv-1544). */
const PLAN_QUI_TOURNE: ReadonlySet<StatutDuPlan> = new Set([
  'attente-accord',
  'en-cours',
  'suspendu-quota'
])

/** Le fil où tourne la passe : le chef du plan pour un lot, le fil lui-même sinon. */
export function filDeLaPasse(fil: string, vu: FilDansUnPlan | undefined): string {
  return vu?.plan.chef ?? fil
}

/** Le fil est-il le chef d'un plan qui tourne encore ? Sa passe attend alors, sans rien perdre. */
export function planTourneEncore(vu: FilDansUnPlan | undefined): boolean {
  return vu?.role === 'chef' && PLAN_QUI_TOURNE.has(vu.plan.statut)
}

/** Un message du fil interdit-il de publier ? Vaut pour toute la vie du fil. */
export function publicationInterditeDans(textes: readonly string[]): boolean {
  return textes.some((texte) => PUBLICATION_INTERDITE.test(texte))
}

/**
 * La condition de déclenchement, entière, sans effet de bord.
 *
 * LES FILS DE PLAN NE SONT PLUS ÉCARTÉS (conv-1544) : leur travail est rendu au fil CHEF par
 * l'appelant (`ipc/chat.ts`), et la passe attend que le plan ne tourne plus (`filOccupe`). Un lot
 * n'est donc jamais interrompu, et le plan entier part en une passe, à sa fin.
 */
export function decisionGitApresFil(tour: TourFini): DecisionGitApresFil {
  if (!tour.accord) return { lancer: false, raison: 'accord-absent' }
  if (!tour.dossierAutowin) return { lancer: false, raison: 'hors-autowin' }
  if (tour.deFond) return { lancer: false, raison: 'tour-de-fond' }
  if (DEJA_UNE_PUBLICATION.test(tour.demande))
    return { lancer: false, raison: 'deja-une-publication' }
  if (publicationInterditeDans([tour.demande, ...tour.demandesDuFil]))
    return { lancer: false, raison: 'publication-interdite' }
  const fichiers = tour.rapport?.exclus?.map((exclu) => exclu.path) ?? []
  if (!tour.rapport || fichiers.length === 0) return { lancer: false, raison: 'rien-a-rattraper' }
  if (refusDeQualite(tour.rapport)) return { lancer: false, raison: 'pas-valide' }
  return { lancer: true, fichiers }
}

/**
 * UN TRAVAIL D'AGENT FINI RESTÉ HORS DE LA BRANCHE (conv-1544) : copie de travail isolée ou branche
 * de secours d'un run, celui du bandeau « 1 travail terminé n'a jamais été publié ». Le 04/11, 8 des
 * `/git` tapés à la main visaient ces travaux-là (« trie les 25 copies de travail »).
 */
export interface TravailDAgent {
  agentId: string
  fichiers: string[]
  date?: string
}

/**
 * Les travaux d'agents à publier, rangés par fil qui a lancé le run. Écartés : un travail sans fil
 * connu (aucune passe ne saurait où se dire), un fil où publier seul n'est pas permis, et un travail
 * DÉJÀ TENTÉ — une passe qui n'a pas pu le reprendre (ascendance rompue, tests rouges) ne doit pas
 * coûter un tour du modèle à chaque fin de run. Il reste alors au bandeau, pour l'humain.
 */
export function travauxParFil(entree: {
  travaux: ReadonlyArray<TravailDAgent & { conversationId?: string }>
  dejaTentes: ReadonlySet<string>
  publiable: (fil: string) => boolean
}): Map<string, TravailDAgent[]> {
  const parFil = new Map<string, TravailDAgent[]>()
  for (const { conversationId: fil, ...travail } of entree.travaux) {
    if (!fil || entree.dejaTentes.has(travail.agentId) || !entree.publiable(fil)) continue
    parFil.set(fil, [...(parFil.get(fil) ?? []), travail])
  }
  return parFil
}

const FICHIERS_CITES = 20
const TRAVAUX_CITES = 12

/** Ce qu'une passe doit savoir en plus des fichiers de l'arbre partagé. */
export interface SuiteDuPrompt {
  /** Les fils dont vient le travail : les lots d'un plan, quand la passe tourne dans son chef. */
  fils?: readonly string[]
  travaux?: readonly TravailDAgent[]
}

/** Le message du tour : `/git` en tête (seule forme reconnue), puis ce que la skill ne devine pas. */
export function promptGitDuFil(
  conversationId: string,
  fichiers: readonly string[],
  suite: SuiteDuPrompt = {}
): string {
  const fils = suite.fils?.length ? [...new Set(suite.fils)] : [conversationId]
  const travaux = suite.travaux ?? []
  const plan = fils.some((fil) => fil !== conversationId)
  const reste = fichiers.length - FICHIERS_CITES
  const liste = fichiers.slice(0, FICHIERS_CITES).join(', ')
  const lignesTravaux = travaux.slice(0, TRAVAUX_CITES).map((travail) => {
    const quoi = travail.fichiers.length ? travail.fichiers.join(', ') : '(fichiers inconnus)'
    const date = travail.date ? ` — ${travail.date}` : ''
    return `- ${travail.agentId}${date} (piste : autowin/recovery/${travail.agentId}) : ${quoi}`
  })
  return [
    plan
      ? `/git : publie le travail terminé du plan mené par ce fil (${conversationId}), et lui seul — fils ${fils.join(', ')}. Le plan ne tourne plus, et l'enchaînement auto n'a pas pu tout publier.`
      : `/git : publie le travail terminé de ce fil (${conversationId}), et lui seul — il est resté calme 3 minutes après son dernier tour, et l'enchaînement auto n'a pas pu tout publier.`,
    ...(fichiers.length
      ? [`Fichiers laissés en attente : ${liste}${reste > 0 ? ` et ${reste} autres` : ''}.`]
      : []),
    ...(travaux.length
      ? [
          "Travaux d'agents restés hors de la branche (copies de travail isolées, branches de secours) :",
          ...lignesTravaux,
          ...(travaux.length > TRAVAUX_CITES
            ? [`- … et ${travaux.length - TRAVAUX_CITES} autres.`]
            : []),
          // Repris du bouton « Traiter » (travail-non-publie.ts) : mesuré, l'adresse annoncée
          // n'existait pas, et quatorze copies ne descendaient pas de leur SHA de départ.
          "L'adresse est une PISTE : vérifie-la (`git rev-parse --verify`) ; absente, cherche les autres cachettes et dis-le.",
          "Diagnostique l'ascendance avant de republier (`git merge-base --is-ancestor <baseSha> <tête>`) : une copie qui n'en descend pas ne se reprend pas telle quelle, dis pourquoi.",
          'Ne supprime aucune branche `autowin/recovery/*` sans avoir noté son SHA. Un travail repris ou abandonné se marque trié (`marquer_travail_trie`).'
        ]
      : []),
    plan
      ? 'Chaque commit porte « (conv-NNN) » du fil qui a écrit ce qu’il contient.'
      : `Chaque commit porte « (${conversationId}) » dans son message.`,
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
/**
 * Les commandes Bash du tour qui ont commité ou poussé, telles qu'envoyées au shell : lues dans le
 * journal du tour (`turn-journals/<fil>/<tour>.jsonl`, événement `provider-status`, `data.target`).
 * conv-1553 : l'utilisateur veut voir LA ligne exacte, pas une commande reconstituée.
 */
export function lignesGitDuJournal(jsonl: string): string[] {
  const lignes: string[] = []
  for (const brut of jsonl.split('\n')) {
    let evenement: { kind?: unknown; data?: { target?: unknown } }
    try {
      evenement = JSON.parse(brut)
    } catch {
      continue
    }
    const cible = evenement?.kind === 'provider-status' ? evenement.data?.target : undefined
    if (typeof cible !== 'string' || !/\bgit\s+(commit|push)\b/.test(cible)) continue
    if (!lignes.includes(cible)) lignes.push(cible)
  }
  return lignes
}

/** L'action lue dans les lignes : ce que l'utilisateur doit savoir sans relire la commande. */
function actionDesLignes(lignes: readonly string[]): string {
  const tout = lignes.join('\n')
  const commit = /\bgit\s+commit\b/.test(tout)
  const push = /\bgit\s+push\b/.test(tout)
  return commit && push ? 'Commit et push' : push ? 'Push' : commit ? 'Commit' : 'Publication'
}

export function bandeauPublie(
  commits: readonly CommitPublie[],
  lignesShell: readonly string[] = []
): string {
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
    '<style>.awp-annuler{display:inline-block;margin-top:6px;color:inherit;font-weight:600;text-decoration:none;cursor:pointer}.awp-shell{white-space:pre-wrap;word-break:break-all;margin:4px 0}</style>',
    // Titre = statut, « 1 commit et push origin main réussi » (conv-1573).
    `<div class="aw-kicker">${echapper(titreDuBandeau(n, lignesShell))}</div>`,
    `<div><b>${actionDesLignes(lignesShell)}</b> : <b class="aw-chiffre">${n} commit${n > 1 ? 's' : ''}</b> de ce fil <b>en ligne</b>.</div>`,
    ...lignes,
    ...(lignesShell.length
      ? lignesShell.map((ligne) => `<pre class="aw-chip awp-shell">${echapper(ligne)}</pre>`)
      : ['<div class="aw-discret">Commande du shell non retrouvée dans le journal du tour.</div>']),
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
 * Les commits de CE fil (ou de ces fils : les lots d'un plan) arrivés en amont depuis `depuis`, du
 * plus récent au plus ancien : l'ordre d'un `git revert`. Lus sur `@{u}` et non sur HEAD : un commit
 * resté local n'est pas « publié ». La parenthèse fermante du motif empêche `conv-9` d'attraper
 * `conv-99` ; plusieurs `--grep` se cumulent en « ou ».
 */
export async function commitsPublies(
  runGit: GitRunner,
  dossier: string,
  depuis: string,
  fils: string | readonly string[]
): Promise<CommitPublie[]> {
  const motifs = (typeof fils === 'string' ? [fils] : fils).map((fil) => `--grep=(${fil})`)
  const sortie = await runGit(
    ['log', '--abbrev=8', '--format=%h%x09%s', '--fixed-strings', ...motifs, `${depuis}..@{u}`],
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
  /** `fils` : le fil de la passe, plus les lots du plan quand il en est le chef. */
  commitsDepuis(
    conversationId: string,
    depuis: string,
    fils: readonly string[]
  ): Promise<CommitPublie[]>
  annoncer(conversationId: string, contenu: string): void
  /** Les lignes git exactes envoyées au shell par le dernier tour du fil (conv-1553). */
  lignesShellDuTour?(conversationId: string): Promise<string[]>
  /** Juste avant la passe : ces travaux d'agents ne seront plus reproposés (voir `travauxParFil`). */
  noterTravauxTentes?(agentIds: readonly string[]): void
  journal?(message: string, detail?: unknown): void
}

/** Ce qui attend la passe d'un fil. */
interface EnAttente {
  fichiers: Set<string>
  fils: Set<string>
  travaux: Map<string, TravailDAgent>
}

/**
 * Le calme qui vaut « fini » (conv-1544). Un mode auto enchaîne ses tours en quelques secondes ; un
 * humain qui lit la réponse puis répond reste souvent sous trois minutes. Au-delà, le fil est posé.
 */
export const CALME_AVANT_PUBLICATION_MS = 3 * 60_000

/**
 * UNE PASSE À LA FOIS, tous fils confondus : deux `/git` simultanés dans le même dossier se marchent
 * dessus (index, push, réalignement de l'arbre). La file vit en mémoire : un redémarrage la vide sans
 * rien perdre, le travail attend dans l'arbre comme avant, et le tour suivant du fil le reproposera.
 *
 * CHAQUE FIL ATTEND SON CALME (conv-1544) : chaque fin de tour relance son minuteur, et un fil occupé
 * quand le minuteur sonne est ATTENDU, pas sauté — avant, ses fichiers sortaient de la file, et seul
 * un `/git` tapé à la main les rattrapait.
 */
export class FileGitApresFil {
  readonly #deps: DepsGitApresFil
  readonly #calmeMs: number
  readonly #attente = new Map<string, EnAttente>()
  readonly #minuteurs = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #prets: string[] = []
  #occupee = false

  constructor(deps: DepsGitApresFil, options: { calmeMs?: number } = {}) {
    this.#deps = deps
    this.#calmeMs = options.calmeMs ?? CALME_AVANT_PUBLICATION_MS
  }

  /**
   * `conversationId` est le fil où la passe tournera ; `origine` celui qui a écrit les fichiers — un
   * lot, quand la passe tourne dans le chef de son plan (conv-1544).
   */
  ajouter(conversationId: string, fichiers: readonly string[], origine = conversationId): void {
    const entree = this.#entree(conversationId)
    for (const fichier of fichiers) entree.fichiers.add(fichier)
    entree.fils.add(origine)
    this.#armer(conversationId)
  }

  /** Les travaux d'agents finis d'un fil, restés hors de la branche (conv-1544). */
  ajouterTravaux(
    conversationId: string,
    travaux: readonly TravailDAgent[],
    origine = conversationId
  ): void {
    if (!travaux.length) return
    const entree = this.#entree(conversationId)
    for (const travail of travaux) entree.travaux.set(travail.agentId, travail)
    entree.fils.add(origine)
    this.#armer(conversationId)
  }

  #entree(fil: string): EnAttente {
    let entree = this.#attente.get(fil)
    if (!entree) {
      entree = { fichiers: new Set(), fils: new Set([fil]), travaux: new Map() }
      this.#attente.set(fil, entree)
    }
    return entree
  }

  /** Relance l'attente du calme : le fil vient de bouger, sa passe repart de zéro. */
  #armer(fil: string): void {
    clearTimeout(this.#minuteurs.get(fil))
    const minuteur = setTimeout(() => this.#calme(fil), this.#calmeMs)
    // Une attente de publication ne doit pas retenir la fermeture du processus.
    minuteur.unref?.()
    this.#minuteurs.set(fil, minuteur)
  }

  #calme(fil: string): void {
    this.#minuteurs.delete(fil)
    if (this.#deps.filOccupe(fil)) {
      this.#armer(fil)
      return
    }
    if (!this.#prets.includes(fil)) this.#prets.push(fil)
    void this.#suivant()
  }

  async #suivant(): Promise<void> {
    if (this.#occupee) return
    const fil = this.#prets.shift()
    if (!fil) return
    const entree = this.#attente.get(fil)
    if (!entree) {
      await this.#suivant()
      return
    }
    this.#attente.delete(fil)
    this.#occupee = true
    try {
      await this.#publier(fil, entree)
    } catch (erreur) {
      // Une passe ratée ne perd rien : le travail reste dans l'arbre, et la suivante doit partir.
      this.#deps.journal?.(`passe impossible pour ${fil}`, erreur)
    } finally {
      this.#occupee = false
      void this.#suivant()
    }
  }

  async #publier(fil: string, entree: EnAttente): Promise<void> {
    // Le fil a repris pendant la passe d'un autre : il n'est plus calme, sa passe attend son calme.
    if (this.#deps.filOccupe(fil)) {
      this.#deps.journal?.(`${fil} a repris : passe remise à son prochain calme`)
      const remise = this.#entree(fil)
      for (const fichier of entree.fichiers) remise.fichiers.add(fichier)
      for (const origine of entree.fils) remise.fils.add(origine)
      for (const [id, travail] of entree.travaux) remise.travaux.set(id, travail)
      this.#armer(fil)
      return
    }
    const fils = [...entree.fils]
    const travaux = [...entree.travaux.values()]
    const avant = await this.#deps.lireAmont(fil)
    if (travaux.length) this.#deps.noterTravauxTentes?.(travaux.map((travail) => travail.agentId))
    const resultat = await this.#deps.lancerTour(
      fil,
      promptGitDuFil(fil, [...entree.fichiers], { fils, travaux })
    )
    if (!resultat.ok || resultat.cancelled) {
      this.#deps.journal?.(`passe sans publication pour ${fil}`, resultat.error)
      return
    }
    if (!avant) return
    const commits = await this.#deps.commitsDepuis(fil, avant, fils)
    if (!commits.length) return
    const lignesShell = (await this.#deps.lignesShellDuTour?.(fil).catch(() => [])) ?? []
    this.#deps.annoncer(fil, bandeauPublie(commits, lignesShell))
  }
}

/** Au-delà, les plus anciens sortent : un travail si vieux a quitté le bandeau depuis longtemps. */
const TENTES_GARDES = 500

/**
 * LES TRAVAUX D'AGENTS DÉJÀ TENTÉS, sur le disque (conv-1544) : la liste survit au redémarrage, sinon
 * chaque relance de l'app repayerait une passe pour une copie qui ne se reprend pas. Une lecture
 * abîmée vaut liste vide : au pire une passe de plus, jamais une perte de travail.
 */
export function travauxTentesSurDisque(chemin: string): {
  lire: () => Set<string>
  noter: (agentIds: readonly string[]) => void
} {
  const lire = (): Set<string> => {
    try {
      const brut = JSON.parse(relireFichier(chemin) ?? '[]') as unknown
      return new Set(Array.isArray(brut) ? brut.filter((id) => typeof id === 'string') : [])
    } catch {
      return new Set()
    }
  }
  return {
    lire,
    noter: (agentIds) => {
      const tous = [...lire(), ...agentIds]
      deposerFichier(chemin, JSON.stringify([...new Set(tous)].slice(-TENTES_GARDES), null, 2))
    }
  }
}
