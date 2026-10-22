/**
 * PHOTO DU CODE AU DÉBUT DE CHAQUE TOUR, ET RETOUR À CETTE PHOTO DANS UNE COPIE SÉPARÉE
 * (conv-1038, 2026-10-21).
 *
 * Constat du scout : la branche depuis un message ne copiait que les MESSAGES
 * (`store/conversations.ts`, `fork`), jamais l'état des fichiers ; le `/rewind` de claude.exe ne sert
 * pas en mode `claude -p` et ignore ce que les commandes écrivent. Décision de l'utilisateur
 * (« branches-rewind », 2026-07-20, Opt D) : d'abord la conversation seule — fait par « Modifier et
 * relancer » —, ensuite le retour du code DANS UNE COPIE ISOLÉE, jamais dans le dossier partagé.
 *
 * LA PHOTO ne touche ni l'index ni les fichiers du dossier partagé : elle passe par une COPIE de
 * l'index (`GIT_INDEX_FILE`), puis `write-tree` + `commit-tree`, rangée sous une référence privée
 * `refs/autowin/tour/<fil>/<instant>`. Elle prend le contenu réel — commandes comprises —, y compris
 * le travail non commité des autres fils : c'est l'état du dossier à cet instant, tel quel. Aucun
 * `git stash` (la pile est partagée par tous les fils et toutes les copies).
 *
 * LE RETOUR ouvre une copie git détachée à la photo. Volontairement SANS lien vers `node_modules` :
 * retirer une copie qui porte une jonction a déjà menacé les vraies dépendances (mémoire « jonction
 * node_modules avant worktree remove »). Lire, comparer et éditer y marchent ; lancer les tests y
 * demande d'abord d'installer ou de relier les dépendances.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { defaultGitRunner, type GitRunner } from './run-autoclose'

export const PREFIXE_PHOTOS = 'refs/autowin/tour/'

/** Un identifiant de fil ne devient un segment de référence que s'il ne peut rien désigner d'autre. */
const ID_SUR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * Garde par défaut : les 10 dernières photos d'un fil, et rien de plus vieux que 14 jours. Sans
 * plafond, chaque tour de chaque fil laisserait une référence pour toujours — le relevé du
 * 2026-09-08 en comptait déjà 208 invisibles de `git branch`.
 */
export const GARDE_PAR_DEFAUT = { parFil: 10, ageMaxMs: 14 * 24 * 60 * 60 * 1000 }

/** Un fichier nouveau plus gros reste hors de la photo : il gonflerait le dépôt à chaque tour. */
export const LIMITE_OCTETS_PAR_DEFAUT = 5 * 1024 * 1024

/** Même budget que la photo des fichiers modifiés (`photographierDebutDeTour`) : jamais bloquant. */
const DELAI_MAX_MS = 5_000

/**
 * « Essaie 3 façons » est un CLIC : l'utilisateur attend ses copies, rien ne part sans elles. Le budget
 * du début de tour (5 s, fait pour ne jamais retenir un tour) faisait échouer le bouton dès que la
 * machine était chargée, avec un message qui accusait le dépôt (conv-1038, 2026-10-21 :
 * garder-un-essai.test.ts rouge en suite de 30 fichiers, vert 3 fois sur 3 seul).
 */
const DELAI_PHOTO_ESSAIS_MS = 30_000

/** L'auteur des photos : jamais l'identité de l'utilisateur, qui n'a rien commité. */
const AUTEUR = {
  GIT_AUTHOR_NAME: 'Autowin',
  GIT_AUTHOR_EMAIL: 'autowin@localhost',
  GIT_COMMITTER_NAME: 'Autowin',
  GIT_COMMITTER_EMAIL: 'autowin@localhost'
}

export function refDePhoto(conversationId: string, quand: number): string | null {
  if (!ID_SUR.test(conversationId) || conversationId.includes('..')) return null
  if (!Number.isSafeInteger(quand) || quand < 0) return null
  return `${PREFIXE_PHOTOS}${conversationId}/${quand}`
}

function lirePhoto(ligne: string): { ref: string; sha: string; fil: string; quand: number } | null {
  const [ref, sha] = ligne.trim().split(' ')
  if (!ref?.startsWith(PREFIXE_PHOTOS) || !sha) return null
  const [fil, instant] = ref.slice(PREFIXE_PHOTOS.length).split('/')
  const quand = Number(instant)
  if (!fil || !Number.isSafeInteger(quand)) return null
  return { ref, sha, fil, quand }
}

async function racineDuDepot(dossier: string, git: GitRunner): Promise<string | null> {
  if (!dossier.trim()) return null
  const racine = (await git(['rev-parse', '--show-toplevel'], dossier).catch(() => '')).trim()
  return racine || null
}

async function photographier(
  entree: {
    dossier: string
    conversationId: string
    quand: number
    limiteOctets: number
    conserver: { parFil: number; ageMaxMs: number }
  },
  git: GitRunner
): Promise<{ ref: string; sha: string } | null> {
  const ref = refDePhoto(entree.conversationId, entree.quand)
  if (!ref) return null
  const repo = await racineDuDepot(entree.dossier, git)
  if (!repo) return null

  // L'index COPIÉ garde le cache des dates de fichiers : seuls les fichiers changés sont relus.
  const indexBrut = (await git(['rev-parse', '--git-path', 'index'], repo)).trim()
  const indexReel = isAbsolute(indexBrut) ? indexBrut : resolve(repo, indexBrut)
  const temporaire = mkdtempSync(join(tmpdir(), 'autowin-photo-'))
  const index = join(temporaire, 'index')
  try {
    if (existsSync(indexReel)) copyFileSync(indexReel, index)
    const env = { ...AUTEUR, GIT_INDEX_FILE: index }

    const nouveaux = (await git(['ls-files', '--others', '--exclude-standard', '-z'], repo))
      .split('\0')
      .filter(Boolean)
    const tropGros = nouveaux.filter((chemin) => {
      try {
        return statSync(join(repo, chemin)).size > entree.limiteOctets
      } catch {
        return false
      }
    })
    await git(
      ['add', '-A', '--', '.', ...tropGros.map((chemin) => `:(exclude,literal)${chemin}`)],
      repo,
      { env }
    )
    const arbre = (await git(['write-tree'], repo, { env })).trim()
    const parent = (await git(['rev-parse', '--verify', '-q', 'HEAD'], repo).catch(() => '')).trim()
    const sha = (
      await git(
        [
          'commit-tree',
          arbre,
          ...(parent ? ['-p', parent] : []),
          '-m',
          `Autowin — photo du code au début d'un tour (${entree.conversationId})`
        ],
        repo,
        { env }
      )
    ).trim()
    await git(['update-ref', ref, sha], repo)
    await elaguer(repo, entree.conversationId, entree.quand, entree.conserver, git)
    return { ref, sha }
  } finally {
    rmSync(temporaire, { recursive: true, force: true })
  }
}

/**
 * Retire les photos au-delà de la garde, en UNE commande. Seules les références de CETTE
 * fonctionnalité sont visées (`refs/autowin/tour/`) : ni branche, ni remise de côté, ni copie.
 */
async function elaguer(
  repo: string,
  conversationId: string,
  maintenant: number,
  conserver: { parFil: number; ageMaxMs: number },
  git: GitRunner
): Promise<void> {
  const photos = (
    await git(['for-each-ref', '--format=%(refname) %(objectname)', PREFIXE_PHOTOS], repo)
  )
    .split(/\r?\n/u)
    .map(lirePhoto)
    .filter((photo): photo is NonNullable<typeof photo> => photo !== null)
  const aRetirer = new Set(
    photos.filter((photo) => maintenant - photo.quand > conserver.ageMaxMs).map((p) => p.ref)
  )
  const duFil = photos
    .filter((photo) => photo.fil === conversationId)
    .sort((a, b) => b.quand - a.quand)
  for (const photo of duFil.slice(Math.max(0, conserver.parFil))) aRetirer.add(photo.ref)
  if (aRetirer.size === 0) return
  for (const ref of aRetirer) await git(['update-ref', '-d', ref], repo)
}

/**
 * Photographie le code du dossier d'un tour. `null` sans dépôt git, sur un identifiant invalide, sur
 * une panne ou au-delà du délai : le tour part alors sans photo, il n'est JAMAIS retenu.
 */
export async function photographierLeCode(entree: {
  dossier: string
  conversationId: string
  quand?: number
  runGit?: GitRunner
  limiteOctets?: number
  conserver?: { parFil: number; ageMaxMs: number }
  delaiMaxMs?: number
}): Promise<{ ref: string; sha: string } | null> {
  let minuteur: ReturnType<typeof setTimeout> | undefined
  try {
    const git = entree.runGit ?? (await defaultGitRunner())
    return await Promise.race([
      photographier(
        {
          dossier: entree.dossier,
          conversationId: entree.conversationId,
          quand: entree.quand ?? Date.now(),
          limiteOctets: entree.limiteOctets ?? LIMITE_OCTETS_PAR_DEFAUT,
          conserver: entree.conserver ?? GARDE_PAR_DEFAUT
        },
        git
      ),
      new Promise<null>((resolveDelai) => {
        minuteur = setTimeout(() => resolveDelai(null), entree.delaiMaxMs ?? DELAI_MAX_MS)
      })
    ])
  } catch {
    return null
  } finally {
    if (minuteur) clearTimeout(minuteur)
  }
}

/**
 * La photo prise au début du tour d'un message : la DERNIÈRE prise jusqu'à `jusqua` (l'heure du
 * message), et après `apres` (l'heure du message précédent) quand il y en a un.
 *
 * Pourquoi AVANT le message (conv-1050, 2026-10-22) : la photo est prise avant le tour
 * (`index.ts`, `photographierLeCode` puis `lancerTour`), et l'heure du message n'est posée
 * qu'ensuite, par `beginTurn` (`store/conversations.ts`). Mesuré sur 5 vrais tours : photo 393 à
 * 613 ms avant son message. L'ancienne règle (« la première à partir du message ») ne trouvait donc
 * jamais la photo du tour, et rendait celle du tour SUIVANT dès qu'il y en avait un. La DERNIÈRE de
 * la fenêtre, parce qu'une photo d'« Essaie 3 façons » prise entre deux tours y tombe aussi.
 */
export async function photoDuTour(entree: {
  dossier: string
  conversationId: string
  jusqua: number
  apres?: number
  runGit?: GitRunner
}): Promise<{ ref: string; sha: string; quand: number } | null> {
  const prefixe = refDePhoto(entree.conversationId, 0)?.replace(/0$/u, '')
  if (!prefixe) return null
  const git = entree.runGit ?? (await defaultGitRunner())
  const repo = await racineDuDepot(entree.dossier, git)
  if (!repo) return null
  const sortie = await git(
    ['for-each-ref', '--format=%(refname) %(objectname)', prefixe],
    repo
  ).catch(() => '')
  const candidates = sortie
    .split(/\r?\n/u)
    .map(lirePhoto)
    .filter(
      (photo): photo is NonNullable<typeof photo> =>
        photo !== null &&
        photo.fil === entree.conversationId &&
        photo.quand <= entree.jusqua &&
        (entree.apres === undefined || photo.quand > entree.apres)
    )
    .sort((a, b) => b.quand - a.quand)
  const derniere = candidates[0]
  return derniere ? { ref: derniere.ref, sha: derniere.sha, quand: derniere.quand } : null
}

/*
 * L'ÉCHEC DE LA COPIE EN UNE PHRASE (conv-1050, 2026-10-22). L'erreur d'execFile porte
 * `Command failed: git worktree add …` puis TOUTE la sortie de git : en « Filename too long », une
 * ligne par fichier mêlée aux « Updating files: NN% ». L'avis du chat (« Revenir à ce tour »,
 * « Essaie 3 façons ») en faisait un écran entier, la cause noyée dedans. On n'en garde que la
 * cause, en mots courants ; la sortie brute reste dans `cause` de l'erreur levée.
 */
const CAUSES_D_ECHEC_DE_COPIE: ReadonlyArray<readonly [RegExp, string]> = [
  /*
   * Même avec `core.longpaths`, git pour Windows refuse une DESTINATION de 216 caractères ou plus :
   * son GIT_DIR (destination + « /.git ») est borné à PATH_MAX − 40 = 220. Mesuré le 2026-10-22
   * (git 2.54.0.windows.1). Avant les chemins longs, ce cas se disait « Filename too long ».
   */
  [/\$GIT_DIR'? too big/iu, 'dossier de la copie trop long pour git (215 caractères au plus)'],
  [/filename too long/iu, 'chemin trop long pour Windows (plus de 260 caractères)'],
  [/no space left on device|not enough space/iu, 'disque plein'],
  [/permission denied|access is denied/iu, 'accès refusé à l’emplacement de la copie'],
  [
    /\.lock\b[^\n]*file exists|another git process/iu,
    'un autre processus git verrouille le dépôt (fichier .lock)'
  ],
  [
    /invalid reference|not a valid object name|unknown revision|bad object/iu,
    'la photo n’existe plus dans le dépôt'
  ],
  [/already exists/iu, 'le dossier de la copie existe déjà']
]

/** Une cause inconnue se dit par la ligne de git qui l'explique, bornée : jamais toute la sortie. */
const LONGUEUR_MAX_LIGNE_GIT = 160

/** La cause d'un `git worktree add` en échec, en quelques mots. Pure. */
function causeDEchecDeCopie(erreur: unknown): string {
  const message = erreur instanceof Error ? erreur.message : String(erreur)
  const stderr = (erreur as { stderr?: unknown } | null)?.stderr
  const sortie = typeof stderr === 'string' && stderr.trim() ? stderr : message
  // La sortie de git, pas la ligne de commande : le chemin de destination n'est pas une cause.
  const connue = CAUSES_D_ECHEC_DE_COPIE.find(([motif]) => motif.test(sortie))
  if (connue) return connue[1]
  const lignes = sortie
    .split(/\r?\n/u)
    .map((ligne) => ligne.trim())
    .filter(Boolean)
  const ligne = (
    lignes.find((candidate) => /^(fatal|error):/iu.test(candidate)) ??
    lignes.find(
      (candidate) => !/^(command failed:|preparing worktree|updating files:)/iu.test(candidate)
    )
  )?.replace(/^(fatal|error):\s*/iu, '')
  if (!ligne) return 'git a échoué sans dire pourquoi'
  const bornee =
    ligne.length > LONGUEUR_MAX_LIGNE_GIT ? `${ligne.slice(0, LONGUEUR_MAX_LIGNE_GIT - 1)}…` : ligne
  return `git a répondu « ${bornee} »`
}

/**
 * Ouvre une copie git DÉTACHÉE à la photo. Déjà ouverte au même endroit : rendue telle quelle
 * (`deja`), jamais recréée par-dessus — elle peut porter du travail. Un échec de git se lève en UNE
 * phrase qui nomme sa cause (voir `causeDEchecDeCopie`), la sortie brute en `cause`.
 */
export async function ouvrirCopieDeLaPhoto(entree: {
  dossier: string
  sha: string
  destination: string
  runGit?: GitRunner
}): Promise<{ chemin: string; deja: boolean }> {
  const git = entree.runGit ?? (await defaultGitRunner())
  const repo = await racineDuDepot(entree.dossier, git)
  if (!repo)
    throw new Error('Le dossier de ce fil n’est pas un dépôt git : aucune photo à rouvrir.')
  if (existsSync(entree.destination)) {
    const head = (await git(['rev-parse', 'HEAD'], entree.destination).catch(() => '')).trim()
    if (head === entree.sha) return { chemin: entree.destination, deja: true }
    throw new Error(`Le dossier ${entree.destination} existe déjà et ne porte pas cette photo.`)
  }
  try {
    /*
     * `core.longpaths` par la LIGNE DE COMMANDE, comme toutes les copies d'Autowin
     * (store/worktree-manager.ts, comparaison-a-la-base.ts), jamais dans la config de l'utilisateur.
     * Sans elle, git pour Windows refuse tout fichier de la copie à plus de 260 caractères
     * (« Filename too long ») : « Revenir à ce tour » et « Essaie 3 façons » échouaient sur un dépôt
     * aux chemins profonds (conv-1050, 2026-10-22).
     */
    await git(
      ['-c', 'core.longpaths=true', 'worktree', 'add', '--detach', entree.destination, entree.sha],
      repo
    )
  } catch (erreur) {
    throw new Error(
      `La copie séparée du code n’a pas pu être créée : ${causeDEchecDeCopie(erreur)}.`,
      { cause: erreur }
    )
  }
  return { chemin: entree.destination, deja: false }
}

export type RetourAuTour =
  { ok: true; chemin: string; deja: boolean; quand: number } | { ok: false; raison: string }

/**
 * « REVENIR À CE TOUR » sur un message de l'utilisateur : la photo prise au début de SON tour — la
 * dernière avant l'heure du message, après celle du message précédent —, rouverte dans une copie séparée
 * sous `dossierDesRetours`. Un tour sans photo (antérieur au 2026-10-21, dossier hors git, photo
 * coupée par le délai) le DIT, sans rien créer.
 */
export async function revenirAuCodeDuTour(entree: {
  conversationId: string
  messages: ReadonlyArray<{ role: string; ts?: number; messageId?: string }>
  messageId: string
  dossier: string
  dossierDesRetours: string
  runGit?: GitRunner
}): Promise<RetourAuTour> {
  const rang = entree.messages.findIndex((message) => message.messageId === entree.messageId)
  const message = entree.messages[rang]
  if (!message || message.role !== 'user' || typeof message.ts !== 'number')
    return { ok: false, raison: 'Seul un message de ta part marque le début d’un tour.' }
  const precedent = entree.messages
    .slice(0, rang)
    .reverse()
    .find((candidat) => candidat.role === 'user' && typeof candidat.ts === 'number')
  const photo = await photoDuTour({
    dossier: entree.dossier,
    conversationId: entree.conversationId,
    jusqua: message.ts,
    apres: precedent?.ts,
    runGit: entree.runGit
  })
  if (!photo)
    return {
      ok: false,
      raison:
        'Aucune photo du code pour ce tour : il est antérieur à la photo automatique (21/10/2026), son dossier n’est pas un dépôt git, ou la photo n’a pas pu être prise à temps.'
    }
  const copie = await ouvrirCopieDeLaPhoto({
    dossier: entree.dossier,
    sha: photo.sha,
    destination: join(entree.dossierDesRetours, `retour__${entree.conversationId}-${photo.quand}`),
    runGit: entree.runGit
  })
  return { ok: true, chemin: copie.chemin, deja: copie.deja, quand: photo.quand }
}

export type CopiesDEssai =
  { ok: true; quand: number; chemins: string[] } | { ok: false; raison: string }

/**
 * « ESSAIE 3 FAÇONS » (conv-1038, 2026-10-21) : UNE photo du code maintenant, puis `nombre` copies
 * séparées à cette photo — une par branche du fil. Chaque façon travaille dans la sienne : aucune
 * n'écrit dans le dossier partagé ni dans la copie d'une autre, et rien n'est fusionné ici.
 */
export async function ouvrirCopiesDEssai(entree: {
  dossier: string
  conversationId: string
  dossierDesRetours: string
  nombre: number
  quand?: number
  runGit?: GitRunner
}): Promise<CopiesDEssai> {
  const quand = entree.quand ?? Date.now()
  const photo = await photographierLeCode({
    dossier: entree.dossier,
    conversationId: entree.conversationId,
    quand,
    runGit: entree.runGit,
    delaiMaxMs: DELAI_PHOTO_ESSAIS_MS
  })
  if (!photo)
    return {
      ok: false,
      raison:
        'Impossible de photographier le code de ce fil : son dossier n’est pas un dépôt git, ou la photo n’a pas pu être prise à temps. Aucune copie n’a été ouverte.'
    }
  const chemins: string[] = []
  for (let rang = 1; rang <= entree.nombre; rang += 1) {
    const copie = await ouvrirCopieDeLaPhoto({
      dossier: entree.dossier,
      sha: photo.sha,
      destination: join(
        entree.dossierDesRetours,
        `essai__${entree.conversationId}-${quand}-${rang}`
      ),
      runGit: entree.runGit
    })
    chemins.push(copie.chemin)
  }
  return { ok: true, quand, chemins }
}
