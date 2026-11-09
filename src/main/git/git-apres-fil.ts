import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formeDuChemin } from '../fichiers/meme-chemin'
import { deposerFichier, relireFichier } from '../gel/ecriture-hors-fil'
import type { StatutDuPlan } from '../../shared/plan-de-lots'
import type { IssueDePasse } from './git-apres-fil-sans-tour'
import type { AutoCloseReport, GitRunner } from '../runs/run-autoclose'
import { destinationDuPush, titreDuBandeau } from './titre-bandeau-git'

/**
 * « PUBLIER SANS TAPER /git » (2026-10-30, piste du scout).
 *
 * L'ACCORD DE PUBLIER EXISTAIT DÉJÀ : « Enchaînement auto », allumé sur ce poste depuis
 * le 23/10, publie chaque tour réussi dont il PROUVE les fichiers. Un second accord « dans le profil »
 * aurait fait deux interrupteurs pour un même consentement. Ce qui manquait est la suite : dans un
 * dossier partagé, un fichier touché par un autre fil reste en attente (`exclus`), et seul un tri par
 * contenu sait le rendre à son fil. Mesuré le 30/10 : 5 `/git` tapés pour finir ces fils-là, et 3
 * surveillances « /git à la fin du tour » posées à la main qui n'ont rien
 * publié, car une surveillance tourne en lecture seule (`chat-dispatch.ts`, `readOnly: true`).
 *
 * CET INTERRUPTEUR-CI EST À PART ET ÉTEINT PAR DÉFAUT : chaque lancement est un tour de modèle, donc
 * un coût que l'accord ne couvrait pas. C'est l'utilisateur qui l'allume, jamais le code.
 *
 * « FINI » NE SE LIT PLUS DANS `AUTOWIN_FIN_V1` (2026-11-04). Mesuré sur 7 jours :
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
 * Une demande qui interdit de publier prime sur l'accord permanent. Vécu le 2026-10-01 :
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
  /** Plus lu (voir l'en-tête) ; encore passé par `ipc/chat.ts`. */
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

/**
 * Le dossier est-il un dépôt git à sa racine ? Un `.git` s'y trouve : un dossier, ou un fichier pour une copie
 * liée (son propre arbre de travail). Un sous-dossier de dépôt n'en est pas un. Ce tri ouvre une copie de travail
 * pour n'importe quel dépôt ; l'envoi vers un serveur reste réservé à `estDepotAutowin`.
 */
// fix-ok: l'ouverture se trie sur ce test et non sur estDepotAutowin, sinon aucun autre dépôt git n'aurait de copie.
export function estUnDepotGit(dossier: string): boolean {
  return existsSync(join(dossier, '.git'))
}

/**
 * Les dépôts à ranger : celui de l'app en tête, s'il est un dépôt git, puis ceux où un fil a sa copie. Une passe du
 * ménage tourne par dépôt, car une copie ne se range que par le dépôt qui l'a ouverte. Chaque dépôt n'est rendu qu'une fois.
 */
export function depotsDesCopiesDeFil(
  fils: ReadonlyArray<{ copieDuFil?: { depot: string } }>,
  depotDeLApp: string
): string[] {
  const vus = new Map<string, string>()
  for (const depot of [depotDeLApp, ...fils.map((fil) => fil.copieDuFil?.depot)]) {
    if (!depot || !estUnDepotGit(depot)) continue
    const cle = formeDuChemin(depot)
    if (!vus.has(cle)) vus.set(cle, depot)
  }
  return [...vus.values()]
}

/** Ce que le coordinateur des plans dit d'un fil (`planDuFil`), réduit à ce qu'il faut ici. */
export interface FilDansUnPlan {
  role: 'chef' | 'enfant'
  plan: { chef: string; statut: StatutDuPlan }
}

/** Un plan dont des lots peuvent encore écrire : la passe de son chef attend sa fin. */
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
 * LES FILS DE PLAN NE SONT PLUS ÉCARTÉS : leur travail est rendu au fil CHEF par
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
 * UN TRAVAIL D'AGENT FINI RESTÉ HORS DE LA BRANCHE : copie de travail isolée ou branche
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

const echapper = (texte: string): string =>
  texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Au-delà, la note renvoie au journal au lieu de tout recopier. */
const MOTIFS_CITES = 12

/**
 * LA NOTE QUAND RIEN NE PEUT PARTIR SEUL : ce qui reste à trier, et un bouton `/git` que
 * l'utilisateur clique LUI-MÊME. Avant, la passe envoyait ce `/git` dans le fil à sa place ; il l'a
 * refusé (« je veux pas que ça envoie un message à ma place »).
 *
 * ELLE NE PARLE QUE DES CHANGEMENTS QU'ELLE LISTE : un commit du même fil peut partir à côté (la
 * publication du tour, ou le travail d'agent de cette passe). « GIT : rien publié » posé près d'un
 * « 1 commit et push réussi » faisait deux blocs qui se contredisaient.
 */
export function noteATrier(conversationId: string, motifs: readonly string[]): string {
  const lignes = motifs.slice(0, MOTIFS_CITES).map((motif) => `<div>· ${echapper(motif)}</div>`)
  return [
    '```html-render',
    '<style>.awp-git{display:inline-block;margin-top:6px;color:inherit;font-weight:600;text-decoration:none;cursor:pointer}</style>',
    '<div class="aw-kicker">GIT : reste à trier</div>',
    `<div><b>Pas publiés</b> : ces changements demandent un <b>tri par contenu</b>.</div>`,
    ...lignes,
    ...(motifs.length > MOTIFS_CITES
      ? [`<div class="aw-discret">… et ${motifs.length - MOTIFS_CITES} autres.</div>`]
      : []),
    `<a class="aw-chip awp-git" href="#autowin-prompt">/git : publie le travail terminé de ce fil (${conversationId}), et lui seul</a>`,
    '```'
  ].join('\n')
}

export interface CommitPublie {
  sha: string
  sujet: string
}

/** Au-delà, le libellé dépasserait `LONGUEUR_MAX_PROMPT` (300) et le fil ignorerait le bouton. */
const COMMITS_DANS_LE_BOUTON = 25

/**
 * RAIL COMPACT (/draft « 1 · Compact rail ») : un trait vertical, une LIGNE par étape —
 * Commit, Push, Annuler —, et la ligne elle-même se déplie sur le sujet complet et sa commande.
 * Trait de 3 px et points de 10 px : les réglages choisis par l'utilisateur dans le /draft.
 * Points et trait sont des `background-image` : le thème clair force `background-color` sur toute
 * page du fil (theme-modes.css), pas l'image.
 */
const STYLE_DU_RAIL = [
  '.awp-rail{display:flex;flex-direction:column;margin-top:4px}',
  '.awp-et{display:flex;gap:10px;min-width:0}',
  '.awp-col{display:flex;flex-direction:column;align-items:center;flex:none;width:14px;padding-top:5px}',
  '.awp-pt{flex:none;width:10px;height:10px;border-radius:50%;background-image:linear-gradient(var(--ok),var(--ok))}',
  '.awp-vide{background-image:none;box-shadow:inset 0 0 0 1.5px var(--text-dim)}',
  '.awp-trait{flex:1;width:3px;margin-top:3px;border-radius:2px;background-image:linear-gradient(color-mix(in srgb,var(--gold-doux) 70%,transparent),color-mix(in srgb,var(--gold-doux) 70%,transparent))}',
  '.awp-corps{flex:1;min-width:0;padding-bottom:6px}',
  '.awp-corps>summary,.awp-ligne{display:flex;align-items:baseline;gap:8px;min-width:0}',
  '.awp-corps>summary{list-style:none;cursor:pointer}',
  '.awp-coupe{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.awp-sha{flex:none;white-space:nowrap}',
  '.awp-fl{flex:none;font-family:var(--mono);font-size:11px}',
  '.awp-corps[open]>summary .awp-fl{color:var(--gold-clair)}',
  '.awp-plie{display:flex;flex-direction:column;gap:4px;margin-top:4px}',
  '.awp-shell{margin:0;font-family:var(--mono);font-size:11.5px;line-height:1.45;white-space:pre-wrap;word-break:break-all;color:var(--text-dim)}',
  // Sans `color:inherit`, le lien sort dans le bleu par défaut du navigateur, illisible sur fond sombre.
  '.awp-annuler{display:inline-block;color:inherit;font-weight:600;text-decoration:none;cursor:pointer;border-style:dashed}'
].join('')

const OK = '<span class="aw-ok">ok</span>'
const DETAILS = '<span class="aw-discret awp-fl">détails ▸</span>'
const shaPuce = (sha: string): string => `<span class="aw-chip awp-sha">${echapper(sha)}</span>`

/** Une étape du rail : le point (plein, ou creux pour l'annulation) et la ligne, pliée ou non. */
function etapeDuRail(entete: string, plie: readonly string[], fin = false): string {
  const colonne = `<div class="awp-col"><span class="awp-pt${fin ? ' awp-vide' : ''}"></span>${fin ? '' : '<span class="awp-trait"></span>'}</div>`
  const corps = plie.length
    ? `<details class="awp-corps"><summary>${entete}${DETAILS}</summary><div class="awp-plie">${plie.join('')}</div></details>`
    : `<div class="awp-corps"><div class="awp-ligne">${entete}</div></div>`
  return `<div class="awp-et">${colonne}${corps}</div>`
}

/**
 * La note « publié » posée dans le fil, avec son bouton d'annulation. Le fil envoie le LIBELLÉ du
 * lien (`bouton-prompt-html.ts`) : ce qui sera annulé est écrit sur le bouton, et l'annulation est
 * un tour ordinaire, demandé par un clic. Un `git revert` direct depuis l'app buterait sur un arbre
 * partagé plein du travail des autres fils.
 */
export function bandeauPublie(
  commits: readonly CommitPublie[],
  lignesShell: readonly string[] = [],
  notes: readonly string[] = []
): string {
  const n = commits.length
  const cites = commits.slice(0, COMMITS_DANS_LE_BOUTON)
  // Une ligne qui pousse va sous Push ; tout le reste (lint, add, commit) sous Commit.
  const pousse = (ligne: string): boolean => /\bgit\s+push\b/.test(ligne)
  const shell = (ligne: string): string => `<pre class="awp-shell">${echapper(ligne)}</pre>`
  const destination = destinationDuPush(lignesShell)

  const enteteCommit =
    n === 1
      ? `<b>Commit</b>${shaPuce(cites[0]!.sha)}<span class="aw-discret awp-coupe">${echapper(cites[0]!.sujet)}</span>${OK}`
      : `<b>Commit</b><b class="aw-chiffre">${n} commits</b><span class="aw-discret awp-coupe">${echapper(cites.map((c) => c.sujet).join(' · '))}</span>${OK}`
  const plieCommit = [
    ...cites.map((c) => `<div>${shaPuce(c.sha)} ${echapper(c.sujet)}</div>`),
    ...(lignesShell.length
      ? lignesShell.filter((ligne) => !pousse(ligne)).map(shell)
      : ['<div class="aw-discret">Commande du shell non retrouvée dans le journal du tour.</div>'])
  ]
  // Sans ligne de push lue, les commits sont « en ligne » (lus sur l'amont), sans destination inventée.
  const entetePush = `<b>Push</b><span class="aw-discret awp-coupe">${destination ? `vers ${echapper(destination.replace(' ', '/'))}` : 'en ligne'}</span>${OK}`
  const annuler =
    n <= COMMITS_DANS_LE_BOUTON
      ? `<a class="aw-chip awp-annuler" href="#autowin-prompt">Annuler la publication (git revert ${commits.map((c) => c.sha).join(' ')}, puis push)</a>`
      : `<div class="aw-discret">Commits trop nombreux pour un bouton : demande leur annulation dans le fil.</div>`
  return [
    '```html-render',
    `<style>${STYLE_DU_RAIL}</style>`,
    // Titre = statut, « 1 commit et push origin main réussi ».
    `<div class="aw-kicker">${echapper(titreDuBandeau(n, lignesShell))}</div>`,
    // Ce que la passe sans tour n'a pas pu prouver (tests non joués, message de secours) : dit, pas tu.
    ...notes.map((note) => `<div class="aw-attention">${echapper(note)}</div>`),
    `<div class="awp-rail">${[
      etapeDuRail(enteteCommit, plieCommit),
      etapeDuRail(entetePush, lignesShell.filter(pousse).map(shell)),
      etapeDuRail(annuler, [], true)
    ].join('')}</div>`,
    '```'
  ].join('\n')
}

/**
 * Une commande qui commite ou pousse, pas une qui lit (`git log`, `git show`, `git status`).
 * `publier-isole.ps1` compte LANCÉ par PowerShell : une lecture qui le nomme (
 * `git hash-object scripts/publier-isole.ps1`) n'a rien publié.
 */
const ECRIT_DANS_GIT =
  /\bgit\s+(?:-C\s+\S+\s+)?(?:commit|push)\b|\b(?:powershell|pwsh)(?:\.exe)?\b[^;|&\n]*publier-isole\.ps1/i

/** Les commandes du tour qui commitent ou poussent, lues dans son journal d'actions (`Bash · …`). */
export function lignesGitDuTour(actionsLog: readonly string[]): string[] {
  return actionsLog.flatMap((ligne) => {
    const commande = /^Bash\s*·\s*(.+)$/s.exec(ligne)?.[1]?.trim()
    return commande && ECRIT_DANS_GIT.test(commande) ? [commande] : []
  })
}

/**
 * LE RAIL À CHAQUE PUBLICATION D'UN TOUR (« le style du bloc qu'on a drafté s'applique
 * jamais »). Seules la passe `/git` sans tour et la clôture d'un run posaient le bloc. Mesuré le
 * 05/11 : 136 commits sur main depuis la veille pour une douzaine de blocs, tous à l'ancien affichage.
 * Les autres partaient du fil lui-même (`publier-isole.ps1`, `git push` dans son tour) ou de
 * l'enchaînement auto du chat, sans un mot dans le fil.
 *
 * `commits` : ceux du fil arrivés en amont pendant le tour, enchaînement compris (`commitsPublies`).
 * Un commit déjà montré par un bloc (sa puce sha) ne revient pas ; le citer en prose ne compte pas.
 * La ligne de l'enchaînement auto est celle qu'envoie `run-autoclose.ts` (push direct de son commit,
 * le plus récent du fil puisqu'il part après le tour), comme dans `annonce-commit-local.ts`.
 */
export function blocDuTour(entree: {
  commits: readonly CommitPublie[]
  actionsLog: readonly string[]
  rapport: AutoCloseReport | undefined
  contenusDuFil: readonly string[]
}): string | undefined {
  const montre = (sha: string): boolean =>
    entree.contenusDuFil.some((contenu) => contenu.includes(`awp-sha">${echapper(sha)}</span>`))
  const nouveaux = entree.commits.filter((commit) => !montre(commit.sha))
  if (!nouveaux.length) return undefined
  const lignes = lignesGitDuTour(entree.actionsLog)
  const projet = entree.rapport?.project
  if (projet?.status === 'pushed' && projet.mode === 'direct')
    lignes.push(`ALLOW_MAIN_PUSH=1 git push origin ${nouveaux[0]!.sha}:refs/heads/${projet.branch}`)
  return bandeauPublie(nouveaux, lignes)
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

/** Ce que la passe confie à l'app (`git-apres-fil-sans-tour.ts`). */
export interface PasseGit {
  fichiers: string[]
  /** Le fil de la passe, plus les lots du plan quand il en est le chef. */
  fils: string[]
  travaux: TravailDAgent[]
}

export interface DepsGitApresFil {
  /**
   * Publie SANS tour de modèle ni message dans le fil : seul le message de commit part
   * au petit modèle d'Agent Studio.
   */
  publier(conversationId: string, passe: PasseGit): Promise<IssueDePasse>
  filOccupe(conversationId: string): boolean
  lireAmont(conversationId: string): Promise<string | undefined>
  /** `fils` : le fil de la passe, plus les lots du plan quand il en est le chef. */
  commitsDepuis(
    conversationId: string,
    depuis: string,
    fils: readonly string[]
  ): Promise<CommitPublie[]>
  annoncer(conversationId: string, contenu: string): void
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
 * Le calme qui vaut « fini ». Un mode auto enchaîne ses tours en quelques secondes ; un
 * humain qui lit la réponse puis répond reste souvent sous trois minutes. Au-delà, le fil est posé.
 */
export const CALME_AVANT_PUBLICATION_MS = 3 * 60_000

/**
 * UNE PASSE À LA FOIS, tous fils confondus : deux `/git` simultanés dans le même dossier se marchent
 * dessus (index, push, réalignement de l'arbre). La file vit en mémoire : un redémarrage la vide sans
 * rien perdre, le travail attend dans l'arbre comme avant, et le tour suivant du fil le reproposera.
 *
 * CHAQUE FIL ATTEND SON CALME : chaque fin de tour relance son minuteur, et un fil occupé
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
   * lot, quand la passe tourne dans le chef de son plan.
   */
  ajouter(conversationId: string, fichiers: readonly string[], origine = conversationId): void {
    const entree = this.#entree(conversationId)
    for (const fichier of fichiers) entree.fichiers.add(fichier)
    entree.fils.add(origine)
    this.#armer(conversationId)
  }

  /** Les travaux d'agents finis d'un fil, restés hors de la branche. */
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
    const issue = await this.#deps.publier(fil, {
      fichiers: [...entree.fichiers],
      fils,
      travaux
    })
    // Le seul message de la passe dans le fil : le bloc git, ou la note de ce qui reste à trier.
    const commits = issue.publie && avant ? await this.#deps.commitsDepuis(fil, avant, fils) : []
    if (commits.length)
      this.#deps.annoncer(fil, bandeauPublie(commits, issue.lignesShell, issue.notes))
    if (issue.aTrier.length) {
      this.#deps.journal?.(`passe sans publication complète pour ${fil}`, issue.aTrier)
      this.#deps.annoncer(fil, noteATrier(fil, issue.aTrier))
    }
  }
}

/** Au-delà, les plus anciens sortent : un travail si vieux a quitté le bandeau depuis longtemps. */
const TENTES_GARDES = 500

/**
 * LES TRAVAUX D'AGENTS DÉJÀ TENTÉS, sur le disque : la liste survit au redémarrage, sinon
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
