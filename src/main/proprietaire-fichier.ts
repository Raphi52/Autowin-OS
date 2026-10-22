import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import { ensureAutowinAppData } from './app-data'
import { readGitState } from './git-read-main'
import {
  normalizeWorkspaceTracePath,
  readCurrentPathOwners,
  workspaceTracePathKey,
  type CurrentPathOwner
} from './activity/conversation-file-trace-spool'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from './providers/workspace-mutation-evidence'

/**
 * « À QUI EST CE FICHIER ? » — le réflexe 14 de la constitution (ne pas écrire sur le travail d'un
 * autre fil) en UN appel, en lecture seule.
 *
 * Scout conv-1086 (2026-10-22) : 514 appels git faits à la main dans 143 journaux (`status`, `diff`,
 * `log`, `fetch`) et un vrai conflit dans les traces (`>>>>>>> 05a597f5 (conv-1074`). L'app SAVAIT
 * déjà quel fil avait touché quel fichier (`conversation-file-trace-spool.ts`) ; seule l'interface
 * le lisait, et seulement pour le fil affiché. Trois questions, trois sources :
 * - un AUTRE FIL a modifié ce fichier sans le commiter → journal des fichiers, recoupé avec le diff
 *   actuel exactement comme l'onglet Fichiers (`conversation-git-state.ts`, `stillOwned`) ;
 * - un RUN le change dans sa copie → `git worktree list`, copies `agent__run-*` seulement : une copie
 *   `agent__command-verify-*` est un INSTANTANÉ du dossier de l'utilisateur, la signaler dénoncerait
 *   chaque fichier en cours une seconde fois ;
 * - il a changé EN AMONT → `HEAD..@{u}`, SANS `git fetch` : la commande ne sort pas du poste et
 *   rend la date du dernier fetch, pour que l'agent sache de quand date la réponse.
 */

const CHEMINS_MAX = 50
const COPIES_EN_PARALLELE = 6
const ETAT_COPIE_NON_COMMITE = 'non commité'
const ETAT_COPIE_COMMITE = 'commité dans la copie, pas encore intégré'
const PREFIXE_COPIE_DE_RUN = 'agent__run-'

export interface FilProprietaire {
  conversation: string
  tour?: string
  /** Horodatage ISO de la DERNIÈRE trace de ce fil sur ce chemin. */
  le: string
  /** Le fil qui pose la question. */
  toi: boolean
  /** Vrai si le diff actuel est encore exactement celui que ce fil a laissé. */
  diffInchange: boolean
}

export interface ProprietaireDeFichier {
  chemin: string
  refus?: string
  nonCommite?: boolean
  fils: FilProprietaire[]
  copiesDeRun: { run: string; etat: string }[]
  amont: { branche?: string; commits: string[] }
  resume: string
}

export interface ReponseProprietaire {
  fichiers: ProprietaireDeFichier[]
  /** Date ISO du dernier `git fetch`, ou `jamais` : la réponse « en amont » n'est pas plus fraîche. */
  dernierFetch?: string
  copiesDeRunLues: number
  copiesDeRunIllisibles: number
}

const executer = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  const r = await executer('git', args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  return r.stdout
}

function cle(path: string): string {
  return workspaceTracePathKey(path)
}

function dossierCle(path: string): string {
  const normalise = resolve(path).replaceAll('\\', '/').replace(/\/+$/, '')
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
        diffInchange
      }
    })
  )
  return fils.sort((a, b) => b.le.localeCompare(a.le))
}

interface CopieDeRun {
  run: string
  dossier: string
}

async function copiesDeRun(workspace: string): Promise<CopieDeRun[]> {
  const sortie = await git(workspace, ['worktree', 'list', '--porcelain']).catch(() => '')
  const ici = dossierCle(workspace)
  return sortie
    .split(/\r?\n/)
    .filter((ligne) => ligne.startsWith('worktree '))
    .map((ligne) => ligne.slice('worktree '.length).trim())
    .filter((dossier) => basename(dossier).startsWith(PREFIXE_COPIE_DE_RUN))
    .filter((dossier) => dossierCle(dossier) !== ici)
    .map((dossier) => ({ run: basename(dossier).slice('agent__'.length), dossier }))
}

/**
 * Chemins demandés que CETTE copie change (clé → état), ou `null` si la copie est illisible.
 * `connus` = les têtes dont le travail n'est PAS celui du run : le HEAD de l'utilisateur et sa
 * branche distante. fix-ok: une copie part souvent d'origin/main, en avance sur le main local
 * (mesuré le 2026-10-22, 3 commits) ; un diff depuis la base commune comptait cet amont comme
 * travail du run.
 */
async function cheminsChangesDansLaCopie(
  copie: CopieDeRun,
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

function resumer(f: Omit<ProprietaireDeFichier, 'resume'>): string {
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
        "modifié et non commité, sans aucun fil tracé : l'utilisateur à la main, ou un outil hors journal"
      )
    }
  }
  for (const copie of f.copiesDeRun) {
    constats.push(`en cours dans la copie du run ${copie.run} (${copie.etat})`)
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
    : 'libre : aucun changement non commité, aucun fil, aucune copie de run, rien en amont'
}

export async function lireProprietairesDeFichiers(entree: {
  workspace: string
  chemins: unknown
  conversationId?: string
  spoolBase?: string
}): Promise<ReponseProprietaire> {
  const bruts = (Array.isArray(entree.chemins) ? entree.chemins : [entree.chemins]).filter(
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
  const [etatGit, instantane, copies, amont, dernierFetch, tete, teteAmont] = await Promise.all([
    readGitState(workspace, 0),
    captureWorkspaceMutationSnapshot(workspace),
    copiesDeRun(workspace),
    brancheAmont(workspace),
    dateDuDernierFetch(workspace),
    sha('HEAD'),
    sha('@{u}')
  ])
  const connus = [tete, teteAmont].filter((s): s is string => Boolean(s))
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
          return etat ? [{ run: copie.run, etat }] : []
        }),
        amont: { ...(amont ? { branche: amont } : {}), commits: commitsAmont.get(k) ?? [] }
      }
      return { ...fichier, resume: resumer(fichier) }
    })
  )
  return {
    fichiers,
    ...(amont ? { dernierFetch } : {}),
    copiesDeRunLues: parCopie.filter(({ etats }) => etats !== null).length,
    copiesDeRunIllisibles: parCopie.filter(({ etats }) => etats === null).length
  }
}
