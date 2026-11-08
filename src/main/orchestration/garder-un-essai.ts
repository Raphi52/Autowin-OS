/**
 * LA PORTE D'UN FIL EN COPIE (`garderLeTravailDuFil`), en fin de tour : ce que la copie du fil porte
 * depuis la base du fil (`lireLaBaseDuFil`) entre dans main par le chemin de publication d'une copie,
 * celui des commandes (`os.worktrees`, `beginAsync` puis `endAsync(…, { merge: true })`) : une copie
 * NEUVE sur la base, l'écart fusionné dedans à trois voies (`git merge-tree`), puis la publication
 * ordinaire — avec sa garde des fichiers non commités du dossier partagé, son attente et son
 * repêchage automatique. La base AVANCE à chaque passage. Ce module n'écrit RIEN dans le dossier
 * partagé, et n'y lance ni remise de côté, ni retour en arrière, ni extraction de fichiers. Sans
 * cette porte, la fin de tour d'une copie détachée poussait une branche du tour vers le distant.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { avancerLaBaseDuFil, lireLaBaseDuFil, type AvanceeDeLaBase } from '../git/photo-du-code'
import { defaultGitRunner, type GitRunner } from '../runs/run-autoclose'
import type { FinalizeResult } from '../store/worktree-manager'

/** L'auteur du commit de la porte : jamais l'identité de l'utilisateur, qui n'a rien commité. */
const AUTEUR = {
  GIT_AUTHOR_NAME: 'Autowin',
  GIT_AUTHOR_EMAIL: 'autowin@localhost',
  GIT_COMMITTER_NAME: 'Autowin',
  GIT_COMMITTER_EMAIL: 'autowin@localhost'
}

export interface FichierDeLEcart {
  chemin: string
  /** `null` pour un fichier binaire : git ne compte pas ses lignes. */
  ajouts: number | null
  retraits: number | null
}

function lireNumstat(sortie: string): FichierDeLEcart[] {
  return sortie
    .split('\0')
    .filter(Boolean)
    .flatMap((ligne) => {
      const [ajouts, retraits, ...chemin] = ligne.split('\t')
      const nom = chemin.join('\t')
      if (!nom) return []
      const nombre = (brut: string | undefined): number | null =>
        brut === undefined || brut === '-' ? null : Number(brut)
      return [{ chemin: nom, ajouts: nombre(ajouts), retraits: nombre(retraits) }]
    })
}

/**
 * L'ARBRE DE CE QUE LA COPIE PORTE MAINTENANT (fichiers ignorés exclus). La mesure passe par une
 * COPIE de l'index de la copie (`GIT_INDEX_FILE`) : son propre index n'est pas touché, et seuls les
 * fichiers modifiés sont relus.
 */
export async function arbreDeLaCopie(copie: string, git: GitRunner): Promise<string> {
  return avecUneCopieDeLIndex(copie, git, async ({ env }) => {
    await git(['add', '-A', '--', '.'], copie, { env })
    return (await git(['write-tree'], copie, { env })).trim()
  })
}

/**
 * Lance `faire` sur une COPIE de l'index de la copie (`GIT_INDEX_FILE` dans `env`), retirée ensuite.
 * L'index réel n'est pas touché ; ses informations de fichiers déjà relus évitent de tout relire.
 * `indexReel` : son chemin, pour qui doit l'écrire une fois le geste réussi.
 */
export async function avecUneCopieDeLIndex<T>(
  copie: string,
  git: GitRunner,
  faire: (index: { env: { GIT_INDEX_FILE: string }; indexReel: string }) => Promise<T>
): Promise<T> {
  const indexBrut = (await git(['rev-parse', '--git-path', 'index'], copie)).trim()
  const indexReel = isAbsolute(indexBrut) ? indexBrut : resolve(copie, indexBrut)
  const temporaire = mkdtempSync(join(tmpdir(), 'autowin-ecart-'))
  try {
    const env = { GIT_INDEX_FILE: join(temporaire, 'index') }
    if (existsSync(indexReel)) copyFileSync(indexReel, env.GIT_INDEX_FILE)
    return await faire({ env, indexReel })
  } finally {
    rmSync(temporaire, { recursive: true, force: true })
  }
}

/**
 * Le chemin de publication d'une copie, tel que `os.worktrees` l'offre aux commandes : ouvrir une
 * copie neuve sur la base, puis la fermer en publiant (ou en la rendant, sans publier).
 */
export interface PublicationDUneCopie {
  ouvrir: (runId: string) => Promise<string | undefined>
  fermer: (runId: string, publier: boolean) => Promise<FinalizeResult | undefined>
}

/** Les refus que l'appelant distingue : la fin de tour ne rapporte pas un « rien à garder ». */
export type MotifDeRefus = 'rien-a-garder' | 'conflit' | 'base-absente'

export type ResultatGarder =
  | {
      ok: true
      etat: 'publie'
      sha?: string
      fichiers: string[]
      /** Porte d'un fil : le commit de ce que la copie portait à ce passage, sa nouvelle base. */
      passage?: string
      /** Porte d'un fil : la base avancée jusqu'à `passage`, ou pourquoi elle n'a pas bougé. */
      base?: AvanceeDeLaBase
    }
  | { ok: true; etat: 'en-attente'; fichiers: string[]; detail: string }
  | { ok: true; etat: 'differe'; fichiers: string[]; detail: string }
  | { ok: false; raison: string; motif?: MotifDeRefus; fichiers?: string[] }

/** Les fichiers en conflit, lus dans la sortie de `merge-tree --name-only` (après l'arbre). */
function fichiersEnConflit(sortie: string): string[] {
  const lignes = sortie.split(/\r?\n/u).slice(1)
  const fin = lignes.indexOf('')
  return (fin === -1 ? lignes : lignes.slice(0, fin)).filter(Boolean)
}

function liste(fichiers: readonly string[]): string {
  return fichiers.length > 0 ? fichiers.join(', ') : 'fichiers non nommés'
}

function traduire(issue: FinalizeResult | undefined, fichiers: string[]): ResultatGarder {
  if (issue === undefined || issue.outcome === 'deferred')
    return {
      ok: true,
      etat: 'differe',
      fichiers,
      detail:
        issue?.detail ??
        'La publication reprendra d’elle-même dès que la copie de publication sera libre.'
    }
  switch (issue.outcome) {
    case 'merged':
    case 'cleanup-pending':
    case 'published-residue':
      return {
        ok: true,
        etat: 'publie',
        fichiers,
        ...(issue.publishedSha ? { sha: issue.publishedSha } : {})
      }
    case 'nothing':
      return { ok: false, raison: 'Rien à publier : la base contient déjà ces changements.' }
    case 'blocked':
      if (issue.reason === 'base-dirty')
        return {
          ok: true,
          etat: 'en-attente',
          fichiers: issue.files,
          detail: `${liste(issue.files)} : modifié${issue.files.length > 1 ? 's' : ''} et non commité${issue.files.length > 1 ? 's' : ''} dans le dossier partagé par un autre travail. Rien n’y a été écrit ; Autowin retentera la publication de lui-même quand ce travail sera commité.`
        }
      return {
        ok: false,
        raison: `Publication refusée (${issue.reason}) : ${issue.detail ?? liste(issue.files)}.`
      }
    case 'conflict':
      return {
        ok: false,
        raison: `Publication refusée : conflit avec la base sur ${liste(issue.files)}.`
      }
    default:
      // fix-ok: cause mesurée par `npm run typecheck` (TS2339) — le switch couvre toutes les issues
      // connues, `issue` vaut donc `never` ici ; une issue ajoutée plus tard au main reste nommée.
      return {
        ok: false,
        raison: `Publication non faite (${String((issue as { outcome?: unknown }).outcome)}).`
      }
  }
}

/** Les phrases d'un refus de la porte. */
interface TextesDeLaFusion {
  conflit: (fichiers: string) => string
  echec: (cause: string) => string
  pose: (cause: string) => string
}

const message = (erreur: unknown): string =>
  erreur instanceof Error ? erreur.message : String(erreur)

/**
 * LA FUSION À TROIS VOIES DE LA PORTE : une copie neuve de la base, l'écart `base → passage` fusionné
 * dedans (`git merge-tree`), puis la publication ordinaire. Un conflit avec ce que la base a reçu
 * depuis `base` est NOMMÉ et rien n'est publié : l'arbitrer, c'est décider à la place de l'utilisateur.
 *
 * `messageDuCommit` présent : le commit qui entre dans main est posé ICI, avec ce message — sans lui,
 * la publication le poserait sous le sien (`agent <copie>: …`) et la ligne `Porte:` serait perdue.
 * Absent : la publication le pose, comme avant.
 */
async function fusionnerEtPublier(entree: {
  base: string
  passage: string
  fichiers: string[]
  publication: PublicationDUneCopie
  runId: string
  git: GitRunner
  messageDuCommit?: string
  textes: TextesDeLaFusion
}): Promise<ResultatGarder> {
  const { git, runId, textes } = entree
  const copie = await entree.publication.ouvrir(runId)
  if (!copie) return { ok: false, raison: 'Aucune copie de publication n’a pu être ouverte.' }

  /** Rend la copie neuve sans rien publier ; un échec de ce rendu est DIT, jamais avalé. */
  const rendre = async (refus: Extract<ResultatGarder, { ok: false }>): Promise<ResultatGarder> => {
    try {
      await entree.publication.fermer(runId, false)
      return refus
    } catch (erreur) {
      return {
        ...refus,
        raison: `${refus.raison} (la copie de publication n’a pas pu être rendue : ${message(erreur)})`
      }
    }
  }

  let fusion: string
  try {
    fusion = await git(
      [
        'merge-tree',
        '--write-tree',
        '--name-only',
        `--merge-base=${entree.base}`,
        'HEAD',
        entree.passage
      ],
      copie
    )
  } catch (erreur) {
    const { code, stdout } = erreur as { code?: unknown; stdout?: unknown }
    // `merge-tree` rend 1 sur un conflit de contenu, et nomme les fichiers après l'arbre.
    if (code === 1 && typeof stdout === 'string') {
      const enConflit = fichiersEnConflit(stdout)
      return rendre({
        ok: false,
        motif: 'conflit',
        fichiers: enConflit,
        raison: textes.conflit(liste(enConflit))
      })
    }
    return rendre({ ok: false, raison: textes.echec(message(erreur)) })
  }
  const arbreFusionne = fusion.split(/\r?\n/u)[0]?.trim() ?? ''
  try {
    // La copie neuve passe de la base à l'arbre fusionné : ajouts, retraits et suppressions.
    await git(['read-tree', '-m', '-u', 'HEAD', arbreFusionne], copie)
  } catch (erreur) {
    return rendre({ ok: false, raison: textes.pose(message(erreur)) })
  }
  if (entree.messageDuCommit !== undefined) {
    // Main contient déjà tout l'écart : un commit vide n'entre pas dans main.
    if (arbreFusionne === (await git(['rev-parse', 'HEAD^{tree}'], copie)).trim())
      return rendre({
        ok: false,
        motif: 'rien-a-garder',
        raison: 'Main contient déjà ce que ce passage apporte : rien à garder.'
      })
    try {
      await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', entree.messageDuCommit], copie)
    } catch (erreur) {
      return rendre({ ok: false, raison: `Le commit de la porte a échoué : ${message(erreur)}` })
    }
  }
  return traduire(await entree.publication.fermer(runId, true), entree.fichiers)
}

/** La ligne finale de chaque commit de la porte : `git log --grep '^Porte: conv-NNN$'` les retrouve. */
export function ligneDePorte(conversationId: string): string {
  return `Porte: ${conversationId}`
}

/** L'identité de la copie de publication d'un passage de porte commence ainsi. */
const PREFIXE_PASSAGE_DE_PORTE = 'porte-'

/**
 * Cette copie de publication est-elle un passage de porte ? La porte fait entrer le travail d'un
 * fil dans main LOCAL, et rien de plus : la publication d'une copie ne doit pas, pour elle, enchaîner
 * l'envoi vers le distant (`os.ts`, `onRecoveredPublication`) — il reste celui d'après le fil.
 */
export function estUnPassageDePorte(runId: string): boolean {
  return runId.startsWith(PREFIXE_PASSAGE_DE_PORTE)
}

/**
 * LA PORTE D'UN FIL EN COPIE, en fin de tour : tout ce que la copie porte depuis la base du fil
 * appartient au fil — rien n'est à prouver fichier par fichier. Cet écart entre dans main par la
 * fusion à trois voies (`fusionnerEtPublier`), puis la base AVANCE jusqu'au commit de ce que la copie portait
 * (`avancerLaBaseDuFil`, depuis la base lue) : le passage suivant ne publie que ce qui a changé depuis.
 *
 * Refus, sans rien écrire dans main : base disparue (jamais la copie entière à la place — elle
 * emporterait tout ce que main a déjà), aucun changement, conflit avec main.
 * fix-ok: cause mesurée — la seule publication par copie ne lisait que les copies d’essai et leur
 * photo ; sans cette porte, la fin de tour d'une copie de fil (détachée) poussait
 * `auto/<fil>-<tour>` vers le distant (rouge de chat-turn-publication.test.ts, `push origin`).
 */
export async function garderLeTravailDuFil(entree: {
  copie: string
  conversationId: string
  /**
   * Première ligne du commit (`type(zone): phrase (conv-N)`), ou sa fabrique à partir des fichiers
   * du passage ; la porte y ajoute sa ligne finale.
   */
  titre: string | ((fichiers: readonly string[]) => string)
  publication: PublicationDUneCopie
  /** Identité de la copie de publication ; tirée du fil et de l'instant par défaut. */
  runId?: string
  runGit?: GitRunner
}): Promise<ResultatGarder> {
  const { copie, conversationId } = entree
  const git = entree.runGit ?? (await defaultGitRunner())
  const base = await lireLaBaseDuFil({ dossier: copie, conversationId, runGit: git })
  if (!base)
    return {
      ok: false,
      motif: 'base-absente',
      raison:
        'La base de ce fil n’existe plus : la porte ne peut pas dire ce que le fil a changé depuis son dernier passage. Rien n’est entré dans main, et jamais toute la copie à la place.'
    }
  const arbre = await arbreDeLaCopie(copie, git)
  const fichiers = lireNumstat(
    await git(['diff', '--numstat', '--no-renames', '-z', base, arbre], copie)
  ).map((fichier) => fichier.chemin)
  if (fichiers.length === 0)
    return {
      ok: false,
      motif: 'rien-a-garder',
      raison: 'Ce fil n’a rien changé depuis le dernier passage de la porte : rien à garder.'
    }
  const titre = typeof entree.titre === 'function' ? entree.titre(fichiers) : entree.titre
  const messageDuCommit = `${titre.trim()}\n\n${ligneDePorte(conversationId)}`
  const passage = (
    await git(['commit-tree', arbre, '-p', base, '-m', messageDuCommit], copie, { env: AUTEUR })
  ).trim()
  const issue = await fusionnerEtPublier({
    base,
    passage,
    fichiers,
    publication: entree.publication,
    runId:
      entree.runId ??
      `${PREFIXE_PASSAGE_DE_PORTE}${conversationId.replace(/[^A-Za-z0-9_-]+/gu, '-')}-${Date.now().toString(36)}`,
    git,
    messageDuCommit,
    textes: {
      conflit: (liste) =>
        `Ce fil change les mêmes lignes que main depuis son dernier passage : ${liste}. Rien n’est entré dans main ; le travail reste dans la copie du fil.`,
      echec: (cause) => `La fusion du travail de ce fil dans main a échoué : ${cause}`,
      pose: (cause) =>
        `Le travail de ce fil n’a pas pu être posé dans la copie de publication : ${cause}`
    }
  })
  // En attente ou différé : main n'a encore rien reçu, la base reste là où la porte l'a lue.
  if (!issue.ok || issue.etat !== 'publie') return issue
  const avancee = await avancerLaBaseDuFil({
    dossier: copie,
    conversationId,
    depuis: base,
    vers: passage,
    runGit: git
  })
  return { ...issue, passage, base: avancee }
}
