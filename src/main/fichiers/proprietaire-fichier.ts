import { execFile } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { ensureAutowinAppData } from '../app/app-data'
import { filDUneCopieDeFil, runDUneCopieDeRun } from '../copies/chemins-de-copies'
import { readGitState } from '../git/git-read-main'
import {
  normalizeWorkspaceTracePath,
  readCurrentPathOwners,
  workspaceTracePathKey,
  type CurrentPathOwner
} from '../activity/conversation-file-trace-spool'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from '../providers/workspace-mutation-evidence'

/**
 * « À QUI EST CE FICHIER ? » — le réflexe 14 de la constitution (ne pas écrire sur le travail d'un
 * autre fil) en UN appel, en lecture seule.
 *
 * Scout (2026-10-22) : 514 appels git faits à la main dans 143 journaux (`status`, `diff`,
 * `log`, `fetch`) et un vrai conflit dans les traces (`>>>>>>> 05a597f5 (conv-1074`). L'app SAVAIT
 * déjà quel fil avait touché quel fichier (`conversation-file-trace-spool.ts`) ; seule l'interface
 * le lisait, et seulement pour le fil affiché. Trois questions, trois sources :
 * - un AUTRE FIL a modifié ce fichier sans le commiter → journal des fichiers, recoupé avec le diff
 *   actuel exactement comme l'onglet Fichiers (`conversation-git-state.ts`, `stillOwned`) ;
 * - un RUN ou un autre FIL le change dans sa copie → `git worktree list`, copies de run (`agent__run-*`,
 *   `copies-de-taches/run-*`) et copies de fil (`copies-de-taches/conv-*`, `copies-de-fil/<fil>`,
 *   `essai__<fil>-…`) seulement : une copie `agent__command-verify-*` est un INSTANTANÉ du dossier de
 *   l'utilisateur, la signaler dénoncerait chaque fichier en cours une seconde fois. Une copie de fil
 *   revient dans le même main que les autres : deux fils qui changent un fichier ne s'écrasent plus,
 *   ils se heurtent à la fusion ;
 * - il a changé EN AMONT → `HEAD..@{u}`, SANS `git fetch` : la commande ne sort pas du poste et
 *   rend la date du dernier fetch, pour que l'agent sache de quand date la réponse.
 */

const CHEMINS_MAX = 50
const COPIES_EN_PARALLELE = 6
const ETAT_COPIE_NON_COMMITE = 'non commité'
const ETAT_COPIE_COMMITE = 'commité dans la copie, pas encore intégré'

export interface FilProprietaire {
  conversation: string
  tour?: string
  /** Horodatage ISO de la DERNIÈRE trace de ce fil sur ce chemin. */
  le: string
  /** Le fil qui pose la question. */
  toi: boolean
  /** Vrai si le diff actuel est encore exactement celui que ce fil a laissé. */
  diffInchange: boolean
  /** Ce fil l'a seulement VU changer à sa fin de tour, sans l'écrire avec un outil. */
  vuSeulement?: true
}

export interface ProprietaireDeFichier {
  chemin: string
  refus?: string
  nonCommite?: boolean
  fils: FilProprietaire[]
  copiesDeRun: { run: string; etat: string }[]
  /** `toi` : la copie du fil qui pose la question, vue d'un autre dossier (la copie d'un run de ses lots). */
  copiesDeFil: { conversation: string; etat: string; toi?: true }[]
  amont: { branche?: string; commits: string[] }
  resume: string
}

export interface ReponseProprietaire {
  fichiers: ProprietaireDeFichier[]
  /** Date ISO du dernier `git fetch`, ou `jamais` : la réponse « en amont » n'est pas plus fraîche. */
  dernierFetch?: string
  copiesDeRunLues: number
  copiesDeRunIllisibles: number
  copiesDeFilLues: number
  copiesDeFilIllisibles: number
}

const executer = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const r = await executer('git', args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  return r.stdout
}

function cle(path: string): string {
  return workspaceTracePathKey(path)
}

/**
 * Le vrai chemin sur le disque : `git worktree list` écrit les noms longs, le dossier qui pose la
 * question peut arriver en nom court Windows (8.3, avec un `~1`) et ne plus se reconnaître.
 */
function cheminReel(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

function dossierCle(path: string): string {
  const normalise = cheminReel(path).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalise.toLowerCase() : normalise
}

/** Chemins touchés d'un `git status --porcelain=v1 -z` — l'ORIGINE d'un renommage comprise. */
function cheminsDuStatut(sortie: string): string[] {
  const morceaux = sortie.split('\0').filter(Boolean)
  const chemins: string[] = []
  for (let i = 0; i < morceaux.length; i += 1) {
    const entree = morceaux[i] as string
    chemins.push(entree.slice(3))
    if (entree[0] === 'R' || entree[0] === 'C') {
      const origine = morceaux[i + 1]
      if (origine) chemins.push(origine)
      i += 1
    }
  }
  return chemins
}

async function enParallele<T, R>(
  elements: readonly T[],
  limite: number,
  tache: (element: T) => Promise<R>
): Promise<R[]> {
  const resultats = new Array<R>(elements.length)
  let suivant = 0
  const ouvrier = async (): Promise<void> => {
    while (suivant < elements.length) {
      const index = suivant++
      resultats[index] = await tache(elements[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, elements.length) }, ouvrier))
  return resultats
}

/** Heure LOCALE lisible, « le 22/10 à 14:02 » — c'est ce que l'utilisateur lit sur son horloge. */
function quand(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'à une date inconnue'
  const deux = (n: number): string => String(n).padStart(2, '0')
  return `le ${deux(date.getDate())}/${deux(date.getMonth() + 1)} à ${deux(date.getHours())}:${deux(date.getMinutes())}`
}

function decrireFil(fil: FilProprietaire): string {
  const tour = fil.tour ? `, tour ${fil.tour}` : ''
  return `${fil.conversation}${tour}, ${quand(fil.le)}`
}

async function filsDuChemin(
  workspace: string,
  owners: readonly CurrentPathOwner[],
  empreintesActuelles: ReadonlyMap<string, string>,
  conversationId: string | undefined
): Promise<FilProprietaire[]> {
  const fils = await Promise.all(
    owners.map(async (owner): Promise<FilProprietaire> => {
      // Même contrôle que l'onglet Fichiers (`stillOwned`) : empreinte du diff ET marqueur physique.
      const marqueur = owner.generationMarker
        ? await captureWorkspacePathGenerationMarker(workspace, owner.path)
        : undefined
      const diffInchange =
        Boolean(owner.fingerprint) &&
        Boolean(owner.generationMarker) &&
        empreintesActuelles.get(cle(owner.path)) === owner.fingerprint &&
        marqueur === owner.generationMarker
      return {
        conversation: owner.conversationId,
        ...(owner.turnId ? { tour: owner.turnId } : {}),
        le: owner.timestamp,
        toi: owner.conversationId === conversationId,
        diffInchange,
        ...(owner.vuSeulement ? { vuSeulement: true as const } : {})
      }
    })
  )
  return fils.sort((a, b) => b.le.localeCompare(a.le))
}

/** Une copie à lire : celle d'un run (`run`) ou celle d'un fil (`fil`), jamais les deux. */
interface CopieALire {
  dossier: string
  run?: string
  fil?: string
}

interface CopiesDuDepot {
  copies: CopieALire[]
  /** Le dossier principal du dépôt, où toutes les copies reviennent : sa tête et sa branche. */
  principal: { tete?: string; branche?: string }
}

async function copiesDuDepot(workspace: string): Promise<CopiesDuDepot> {
  const sortie = await git(workspace, ['worktree', 'list', '--porcelain']).catch(() => '')
  const ici = dossierCle(workspace)
  // `git worktree list` rend le dossier principal en premier, puis un bloc par copie.
  const blocs = sortie
    .split(/\r?\n\r?\n/)
    .map((bloc) => bloc.split(/\r?\n/))
    .filter((lignes) => lignes[0]?.startsWith('worktree '))
  const champ = (lignes: string[] | undefined, nom: string): string | undefined =>
    lignes
      ?.find((ligne) => ligne.startsWith(`${nom} `))
      ?.slice(nom.length + 1)
      .trim()
  const premier = blocs[0]
  const branche = champ(premier, 'branch')?.replace(/^refs\/heads\//, '')
  const copies = blocs.slice(1).flatMap((lignes): CopieALire[] => {
    const dossier = champ(lignes, 'worktree') ?? ''
    if (dossierCle(dossier) === ici) return []
    // Une copie se reconnaît à son dossier ; une copie de commande n'est jamais signalée.
    const run = runDUneCopieDeRun(dossier)
    if (run !== undefined) return [{ dossier, run }]
    const fil = filDUneCopieDeFil(dossier)
    return fil === undefined ? [] : [{ dossier, fil }]
  })
  return { copies, principal: { tete: champ(premier, 'HEAD'), ...(branche ? { branche } : {}) } }
}

/**
 * Chemins demandés que CETTE copie change (clé → état), ou `null` si la copie est illisible.
 * `connus` = les têtes dont le travail n'est PAS celui du run : le HEAD de l'utilisateur et sa
 * branche distante. fix-ok: une copie part souvent d'origin/main, en avance sur le main local
 * (mesuré le 2026-10-22, 3 commits) ; un diff depuis la base commune comptait cet amont comme
 * travail du run.
 */
async function cheminsChangesDansLaCopie(
  copie: CopieALire,
  relatifs: readonly string[],
  connus: readonly string[]
): Promise<Map<string, string> | null> {
  try {
    const etats = new Map<string, string>()
    if (connus.length > 0) {
      // Travail commité dans la copie et atteignable depuis AUCUNE des têtes connues.
      const commites = await git(copie.dossier, [
        'log',
        '--name-only',
        '--format=',
        '-z',
        'HEAD',
        '--not',
        ...connus,
        '--',
        ...relatifs
      ])
      for (const chemin of commites.split(/[\0\n]/).filter(Boolean)) {
        etats.set(cle(chemin), ETAT_COPIE_COMMITE)
      }
    }
    const statut = await git(copie.dossier, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--',
      ...relatifs
    ])
    for (const chemin of cheminsDuStatut(statut)) etats.set(cle(chemin), ETAT_COPIE_NON_COMMITE)
    return etats
  } catch {
    return null
  }
}

async function brancheAmont(workspace: string): Promise<string | undefined> {
  try {
    const branche = (
      await git(workspace, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    ).trim()
    return branche || undefined
  } catch {
    return undefined
  }
}

async function dateDuDernierFetch(workspace: string): Promise<string> {
  try {
    const chemin = (await git(workspace, ['rev-parse', '--git-path', 'FETCH_HEAD'])).trim()
    return statSync(resolve(workspace, chemin)).mtime.toISOString()
  } catch {
    return 'jamais'
  }
}

/**
 * `copieQuiDemande` : le run ou le fil dont le dossier interrogé est la copie. Seul son agent y écrit,
 * et ses écritures n'ont de trace qu'en fin d'appel : un changement non commité sans fil tracé y est
 * son travail en cours, pas une retouche à la main.
 */
function resumer(f: Omit<ProprietaireDeFichier, 'resume'>, copieQuiDemande?: string): string {
  if (f.refus) return `refusé : ${f.refus}`
  const constats: string[] = []
  const tenus = f.fils.filter((fil) => fil.diffInchange)
  const autres = tenus.filter((fil) => !fil.toi)
  const miens = tenus.filter((fil) => fil.toi)
  if (f.nonCommite) {
    if (autres.length > 0) {
      constats.push(
        `modifié et non commité par ${autres.map(decrireFil).join(' ; ')} — c'est le travail ` +
          "d'un AUTRE fil : relis-le juste avant d'écrire, remplacements ciblés, jamais de réécriture entière"
      )
    }
    if (miens.length > 0) {
      constats.push(`modifié et non commité par ce fil (${miens.map(decrireFil).join(' ; ')})`)
    }
    if (tenus.length === 0 && f.fils.length > 0) {
      constats.push(
        `touché par ${f.fils.map(decrireFil).join(' ; ')}, puis retouché depuis hors de tout fil ` +
          "tracé : le diff actuel n'est plus le sien (l'utilisateur à la main, ou un outil hors journal)"
      )
    }
    if (f.fils.length === 0) {
      constats.push(
        copieQuiDemande
          ? `modifié et non commité, le travail en cours de cette copie (${copieQuiDemande})`
          : "modifié et non commité, sans aucun fil tracé : l'utilisateur à la main, ou un outil hors journal"
      )
    }
  }
  for (const copie of f.copiesDeRun) {
    constats.push(`en cours dans la copie du run ${copie.run} (${copie.etat})`)
  }
  for (const copie of f.copiesDeFil) {
    constats.push(
      copie.toi
        ? `en cours dans la copie de ce fil, ${copie.conversation} (${copie.etat})`
        : `en cours dans la copie du fil ${copie.conversation} (${copie.etat}) — le travail ` +
            "d'un AUTRE fil, qui reviendra dans main : pars de sa version ou attends-le"
    )
  }
  if (f.amont.commits.length > 0) {
    constats.push(
      `changé en amont sur ${f.amont.branche} (${f.amont.commits.length} commit(s) : ` +
        `${f.amont.commits.slice(0, 3).join(' ; ')}) — pars de cette version`
    )
  }
  if (constats.length > 0) return constats.join(' · ')
  const dernier = f.fils[0]
  return dernier
    ? `libre : aucun changement non commité ; dernier fil tracé : ${decrireFil(dernier)}`
    : 'libre : aucun changement non commité, aucun fil, aucune copie de run ni de fil, rien en amont'
}

/**
 * Les chemins tels que les envoient les DEUX voies d'appel. La voie <cmd> passe un vrai tableau ;
 * l'outil direct ne peut passer qu'une CHAÎNE, car `schemaEntree` (skill-node-mcp.ts) déclare tout
 * argument en `type: 'string'` — et la description de l'outil donne elle-même l'exemple
 * `["src/main/commands/commands.ts"]`. Lue comme UN chemin, cette liste rendait un seul fichier « libre » à
 * tort (23/10/2026). Même règle que `listeEnvoyee` (commands.ts) : une chaîne
 * qui commence par `[` est une liste JSON, mal formée elle est REFUSÉE en le disant ; toute autre
 * chaîne reste un chemin unique.
 */
function cheminsEnvoyes(brut: unknown): unknown[] {
  if (Array.isArray(brut)) return brut
  if (typeof brut !== 'string' || !brut.trimStart().startsWith('[')) return [brut]
  let lu: unknown
  try {
    lu = JSON.parse(brut)
  } catch {
    lu = undefined
  }
  if (!Array.isArray(lu)) {
    throw new Error(
      'proprietaire_fichier : `chemins` ressemble à une liste mais n’est pas un tableau JSON valide ' +
        '(ex. ["src/a.ts", "src/b.ts"])'
    )
  }
  return lu
}

export async function lireProprietairesDeFichiers(entree: {
  workspace: string
  chemins: unknown
  conversationId?: string
  spoolBase?: string
}): Promise<ReponseProprietaire> {
  const bruts = cheminsEnvoyes(entree.chemins).filter(
    (chemin): chemin is string => typeof chemin === 'string' && chemin.trim() !== ''
  )
  if (bruts.length === 0) {
    throw new Error('proprietaire_fichier : donne `chemins`, un chemin ou une liste de chemins')
  }
  if (bruts.length > CHEMINS_MAX) {
    throw new Error(`proprietaire_fichier : ${CHEMINS_MAX} chemins au plus par appel`)
  }
  const workspace = entree.workspace
  const demandes = bruts.map((chemin) => ({
    chemin,
    relatif: normalizeWorkspaceTracePath(chemin, workspace)
  }))
  const relatifs = [...new Set(demandes.flatMap((d) => (d.relatif === null ? [] : [d.relatif])))]
  const sha = (reference: string): Promise<string | undefined> =>
    git(workspace, ['rev-parse', '--verify', '--quiet', reference])
      .then((s) => s.trim() || undefined)
      .catch(() => undefined)
  const [etatGit, instantane, depot, amont, dernierFetch, tete, teteAmont] = await Promise.all([
    readGitState(workspace, 0),
    captureWorkspaceMutationSnapshot(workspace),
    copiesDuDepot(workspace),
    brancheAmont(workspace),
    dateDuDernierFetch(workspace),
    sha('HEAD'),
    sha('@{u}')
  ])
  const { copies, principal } = depot
  const copieQuiDemande = runDUneCopieDeRun(workspace) ?? filDUneCopieDeFil(workspace)
  // Le main du dossier principal et sa branche distante sont connus AUSSI : posée depuis une copie de
  // fil mise à jour plus tôt, la question prenait pour leur travail les commits de main que les autres
  // copies avaient reçus depuis.
  const amontPrincipal = principal.branche ? await sha(`${principal.branche}@{u}`) : undefined
  const connus = [
    ...new Set(
      [tete, teteAmont, principal.tete, amontPrincipal].filter((s): s is string => Boolean(s))
    )
  ]
  const nonCommites = new Set((etatGit.state?.changes ?? []).map((c) => cle(c.path)))
  const empreintes = new Map([...instantane].map(([path, empreinte]) => [cle(path), empreinte]))
  const owners = readCurrentPathOwners(
    workspace,
    relatifs,
    entree.spoolBase ?? ensureAutowinAppData()
  )
  const ownersParCle = new Map(relatifs.map((relatif, i) => [cle(relatif), owners[i] ?? []]))
  const parCopie =
    relatifs.length === 0
      ? []
      : await enParallele(copies, COPIES_EN_PARALLELE, async (copie) => ({
          copie,
          etats: await cheminsChangesDansLaCopie(copie, relatifs, connus)
        }))
  const commitsAmont = new Map<string, string[]>(
    await Promise.all(
      relatifs.map(async (relatif): Promise<[string, string[]]> => {
        if (!amont) return [cle(relatif), []]
        const sortie = await git(workspace, [
          'log',
          '--format=%h %s',
          'HEAD..@{u}',
          '--',
          relatif
        ]).catch(() => '')
        return [cle(relatif), sortie.split(/\r?\n/).filter(Boolean)]
      })
    )
  )
  const fichiers = await Promise.all(
    demandes.map(async ({ chemin, relatif }): Promise<ProprietaireDeFichier> => {
      if (relatif === null) {
        const refuse = {
          chemin,
          refus: 'chemin hors du dossier de travail, ou dans .git',
          fils: [],
          copiesDeRun: [],
          copiesDeFil: [],
          amont: { commits: [] }
        }
        return { ...refuse, resume: resumer(refuse) }
      }
      const k = cle(relatif)
      const fichier = {
        chemin,
        nonCommite: nonCommites.has(k),
        fils: await filsDuChemin(
          workspace,
          ownersParCle.get(k) ?? [],
          empreintes,
          entree.conversationId
        ),
        copiesDeRun: parCopie.flatMap(({ copie, etats }) => {
          const etat = etats?.get(k)
          return etat && copie.run !== undefined ? [{ run: copie.run, etat }] : []
        }),
        copiesDeFil: parCopie.flatMap(({ copie, etats }) => {
          const etat = etats?.get(k)
          if (!etat || copie.fil === undefined) return []
          const toi = copie.fil === entree.conversationId
          return [{ conversation: copie.fil, etat, ...(toi ? { toi: true as const } : {}) }]
        }),
        amont: { ...(amont ? { branche: amont } : {}), commits: commitsAmont.get(k) ?? [] }
      }
      return { ...fichier, resume: resumer(fichier, copieQuiDemande) }
    })
  )
  return {
    fichiers,
    ...(amont ? { dernierFetch } : {}),
    copiesDeRunLues: parCopie.filter(({ copie, etats }) => copie.run && etats !== null).length,
    copiesDeRunIllisibles: parCopie.filter(({ copie, etats }) => copie.run && etats === null)
      .length,
    copiesDeFilLues: parCopie.filter(({ copie, etats }) => copie.fil && etats !== null).length,
    copiesDeFilIllisibles: parCopie.filter(({ copie, etats }) => copie.fil && etats === null).length
  }
}
