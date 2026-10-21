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
 * La photo prise au début du tour d'un message : la première à partir de `depuis` (l'heure du
 * message), et avant `avant` (l'heure du message suivant) quand il y en a un.
 */
export async function photoDuTour(entree: {
  dossier: string
  conversationId: string
  depuis: number
  avant?: number
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
        photo.quand >= entree.depuis &&
        (entree.avant === undefined || photo.quand < entree.avant)
    )
    .sort((a, b) => a.quand - b.quand)
  const premiere = candidates[0]
  return premiere ? { ref: premiere.ref, sha: premiere.sha, quand: premiere.quand } : null
}

/**
 * Ouvre une copie git DÉTACHÉE à la photo. Déjà ouverte au même endroit : rendue telle quelle
 * (`deja`), jamais recréée par-dessus — elle peut porter du travail.
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
  await git(['worktree', 'add', '--detach', entree.destination, entree.sha], repo)
  return { chemin: entree.destination, deja: false }
}

export type RetourAuTour =
  { ok: true; chemin: string; deja: boolean; quand: number } | { ok: false; raison: string }

/**
 * « REVENIR À CE TOUR » sur un message de l'utilisateur : la photo prise au début de SON tour — à
 * partir de l'heure du message, avant celle du message suivant —, rouverte dans une copie séparée
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
  const suivant = entree.messages
    .slice(rang + 1)
    .find((candidat) => candidat.role === 'user' && typeof candidat.ts === 'number')
  const photo = await photoDuTour({
    dossier: entree.dossier,
    conversationId: entree.conversationId,
    depuis: message.ts,
    avant: suivant?.ts,
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
    runGit: entree.runGit
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
