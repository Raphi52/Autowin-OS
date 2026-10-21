/**
 * « ESSAIE 3 FAÇONS » : COMPARER LES FAÇONS, PUIS « GARDER CELLE-CI » (conv-1038, 2026-10-21 —
 * idée 6 du scout : « une carte compare les écarts, les tests et le coût, et fusionne la gagnante »).
 *
 * Chaque façon travaille dans sa copie séparée, ouverte à une PHOTO du code (`photo-du-code.ts`,
 * `ouvrirCopiesDEssai`). La photo prend le dossier partagé TEL QUEL, travail non commité des autres
 * fils compris. Ce que la façon a changé est donc l'écart entre SA copie et SA photo — jamais entre
 * sa copie et `main`, qui compterait (et publierait) le travail en cours des autres comme le sien.
 *
 * GARDER passe par le chemin de publication d'une copie, celui des commandes (`os.worktrees`,
 * `beginAsync` puis `endAsync(…, { merge: true })`) : une copie NEUVE sur la base, l'écart de la
 * façon fusionné dedans à trois voies (`git merge-tree`, base = la photo), puis la publication
 * ordinaire — avec sa garde des fichiers non commités du dossier partagé, son attente et son
 * repêchage automatique. Ce module n'écrit RIEN dans le dossier partagé, et n'y lance ni remise de
 * côté, ni retour en arrière, ni extraction de fichiers.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { refDePhoto } from './photo-du-code'
import { MARQUE_DEMANDE_DESSAI, nomDeCopieDEssai } from '../shared/essai-trois-facons'
import { defaultGitRunner, type GitRunner } from './run-autoclose'
import type { FinalizeResult } from './store/worktree-manager'

/** L'auteur du commit de la façon : jamais l'identité de l'utilisateur, qui n'a rien commité. */
const AUTEUR = {
  GIT_AUTHOR_NAME: 'Autowin',
  GIT_AUTHOR_EMAIL: 'autowin@localhost',
  GIT_COMMITTER_NAME: 'Autowin',
  GIT_COMMITTER_EMAIL: 'autowin@localhost'
}

export interface EssaiNomme {
  fil: string
  quand: number
  rang: number
  /** La référence de la photo de départ, établie une seule fois ici (jamais `null`). */
  ref: string
}

function memeChemin(a: string, b: string): boolean {
  const forme = (chemin: string): string => {
    const nu = resolve(chemin).replace(/[\\/]+$/u, '')
    return process.platform === 'win32' ? nu.toLowerCase() : nu
  }
  return forme(a) === forme(b)
}

/**
 * Une copie d'essai n'est reconnue que DIRECTEMENT dans le dossier des essais, sous le nom que pose
 * `ouvrirCopiesDEssai`. Sans cette garde, le canal publierait l'écart de n'importe quel dossier.
 */
export function lireNomDEssai(copie: string, dossierDesRetours: string): EssaiNomme | null {
  if (!copie.trim() || !isAbsolute(copie)) return null
  if (!memeChemin(dirname(resolve(copie)), dossierDesRetours)) return null
  // Le nom que pose `ouvrirCopiesDEssai`, lu par la même fonction que l'interface.
  const nom = nomDeCopieDEssai(basename(resolve(copie)))
  if (!nom) return null
  // fix-ok: conv-1038, 2026-10-21 — l'écart puis « Garder » relisaient la photo par
  // `refDePhoto(...) as string` et `lireNomDEssai(...) as EssaiNomme`, deux conversions qui ne
  // tenaient que par cette garde, invisible au typage. La référence est portée ici, une fois.
  // Test : garder-un-essai.test.ts (fil avec espace ou `..`, référence portée) — rouge puis vert.
  const ref = refDePhoto(nom.fil, nom.quand)
  if (!ref) return null
  return { ...nom, ref }
}

export interface BilanDeLaFacon {
  etat: 'pas-parti' | 'en-cours' | 'fini' | 'echec' | 'arrete'
  /** Vérifications (`verify`) rendues vertes par la façon. */
  vertes: number
  /** Vérifications rouges ou interrompues : aucune n'est passée sous silence. */
  rouges: number
}

type MessageDeBranche = {
  role?: unknown
  content?: unknown
  status?: unknown
  parts?: ReadonlyArray<{ kind?: unknown; name?: unknown; ok?: unknown; interrupted?: unknown }>
}

/**
 * OÙ EN EST UNE FAÇON, et ce que ses vérifications ont RENDU (un code de sortie, pas ce que l'agent
 * en dit). Une branche porte aussi les messages copiés du fil d'origine : seul ce qui suit la
 * DERNIÈRE demande marquée (`MARQUE_DEMANDE_DESSAI`) est le travail de la façon.
 * check: garder-un-essai.bilan.test.ts — 3 cas rouges avant cette fonction, dont la vérification
 * copiée du fil d'origine qui ne doit pas compter.
 */
export function bilanDeLaFacon(messages: readonly MessageDeBranche[]): BilanDeLaFacon {
  let debut = -1
  for (let rang = messages.length - 1; rang >= 0; rang -= 1) {
    const message = messages[rang]
    if (
      message?.role === 'user' &&
      typeof message.content === 'string' &&
      MARQUE_DEMANDE_DESSAI.test(message.content)
    ) {
      debut = rang
      break
    }
  }
  if (debut === -1) return { etat: 'pas-parti', vertes: 0, rouges: 0 }
  const reponses = messages.slice(debut + 1).filter((message) => message.role === 'assistant')
  let vertes = 0
  let rouges = 0
  for (const reponse of reponses)
    for (const part of reponse.parts ?? []) {
      if (part.kind !== 'action' || part.name !== 'verify') continue
      if (part.ok === true) vertes += 1
      else if (part.ok === false || part.interrupted === true) rouges += 1
    }
  const statut = reponses.at(-1)?.status
  const etat: BilanDeLaFacon['etat'] =
    statut === undefined
      ? 'pas-parti'
      : statut === 'streaming'
        ? 'en-cours'
        : statut === 'completed'
          ? 'fini'
          : statut === 'failed'
            ? 'echec'
            : 'arrete'
  return { etat, vertes, rouges }
}

export interface FichierDeLEcart {
  chemin: string
  /** `null` pour un fichier binaire : git ne compte pas ses lignes. */
  ajouts: number | null
  retraits: number | null
}

export type EcartDeLEssai =
  | {
      ok: true
      /** L'essai lu dans le nom de la copie : « Garder » s'en sert sans le relire. */
      nom: EssaiNomme
      /** La photo de départ de la façon. */
      photo: string
      /** L'arbre de ce que la copie porte maintenant (fichiers ignorés exclus). */
      arbre: string
      fichiers: FichierDeLEcart[]
      ajouts: number
      retraits: number
    }
  | { ok: false; raison: string }

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
 * CE QUE LA FAÇON A CHANGÉ depuis sa photo : fichiers et lignes. La mesure passe par une COPIE de
 * l'index de la copie (`GIT_INDEX_FILE`) : son propre index n'est pas touché, et seuls les fichiers
 * modifiés sont relus.
 */
export async function ecartDeLEssai(entree: {
  copie: string
  dossierDesRetours: string
  runGit?: GitRunner
}): Promise<EcartDeLEssai> {
  const nom = lireNomDEssai(entree.copie, entree.dossierDesRetours)
  if (!nom) return { ok: false, raison: 'Ce dossier n’est pas une copie d’« Essaie 3 façons ».' }
  const git = entree.runGit ?? (await defaultGitRunner())
  const photo = (
    await git(['rev-parse', '--verify', '-q', `${nom.ref}^{commit}`], entree.copie).catch(() => '')
  ).trim()
  if (!photo)
    return {
      ok: false,
      raison:
        'La photo de départ de cet essai n’existe plus (une photo est gardée 14 jours, 10 par fil) : impossible de dire ce que cette façon a changé.'
    }
  const indexBrut = (await git(['rev-parse', '--git-path', 'index'], entree.copie)).trim()
  const indexReel = isAbsolute(indexBrut) ? indexBrut : resolve(entree.copie, indexBrut)
  const temporaire = mkdtempSync(join(tmpdir(), 'autowin-ecart-'))
  try {
    const env = { GIT_INDEX_FILE: join(temporaire, 'index') }
    if (existsSync(indexReel)) copyFileSync(indexReel, env.GIT_INDEX_FILE)
    await git(['add', '-A', '--', '.'], entree.copie, { env })
    const arbre = (await git(['write-tree'], entree.copie, { env })).trim()
    const fichiers = lireNumstat(
      await git(['diff', '--numstat', '--no-renames', '-z', photo, arbre], entree.copie)
    )
    return {
      ok: true,
      nom,
      photo,
      arbre,
      fichiers,
      ajouts: fichiers.reduce((somme, fichier) => somme + (fichier.ajouts ?? 0), 0),
      retraits: fichiers.reduce((somme, fichier) => somme + (fichier.retraits ?? 0), 0)
    }
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

export type ResultatGarder =
  | { ok: true; etat: 'publie'; sha?: string; fichiers: string[] }
  | { ok: true; etat: 'en-attente'; fichiers: string[]; detail: string }
  | { ok: true; etat: 'differe'; fichiers: string[]; detail: string }
  | { ok: false; raison: string }

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

/**
 * « GARDER CELLE-CI » : l'écart de la façon, fusionné dans une copie neuve de la base, puis publié
 * par le chemin ordinaire. Un conflit avec ce que la base a reçu depuis l'essai est NOMMÉ et rien
 * n'est publié : l'arbitrer, c'est décider à la place de l'utilisateur.
 */
export async function garderLEssai(entree: {
  copie: string
  dossierDesRetours: string
  publication: PublicationDUneCopie
  /** Identité de la copie de publication ; tirée de l'essai et de l'instant par défaut. */
  runId?: string
  runGit?: GitRunner
}): Promise<ResultatGarder> {
  const ecart = await ecartDeLEssai(entree)
  if (!ecart.ok) return ecart
  if (ecart.fichiers.length === 0)
    return { ok: false, raison: 'Cette façon n’a rien changé au code : il n’y a rien à garder.' }
  const nom = ecart.nom
  const git = entree.runGit ?? (await defaultGitRunner())
  const facon = (
    await git(
      [
        'commit-tree',
        ecart.arbre,
        '-p',
        ecart.photo,
        '-m',
        `Autowin — façon ${nom.rang} de l’essai (${nom.fil})`
      ],
      entree.copie,
      { env: AUTEUR }
    )
  ).trim()
  const runId = entree.runId ?? `essai-${nom.quand}-${nom.rang}-${Date.now().toString(36)}`
  const copie = await entree.publication.ouvrir(runId)
  if (!copie) return { ok: false, raison: 'Aucune copie de publication n’a pu être ouverte.' }

  /** Rend la copie neuve sans rien publier ; un échec de ce rendu est DIT, jamais avalé. */
  const rendre = async (raison: string): Promise<ResultatGarder> => {
    try {
      await entree.publication.fermer(runId, false)
      return { ok: false, raison }
    } catch (erreur) {
      const cause = erreur instanceof Error ? erreur.message : String(erreur)
      return {
        ok: false,
        raison: `${raison} (la copie de publication n’a pas pu être rendue : ${cause})`
      }
    }
  }

  let fusion: string
  try {
    fusion = await git(
      ['merge-tree', '--write-tree', '--name-only', `--merge-base=${ecart.photo}`, 'HEAD', facon],
      copie
    )
  } catch (erreur) {
    const { code, stdout } = erreur as { code?: unknown; stdout?: unknown }
    // `merge-tree` rend 1 sur un conflit de contenu, et nomme les fichiers après l'arbre.
    if (code === 1 && typeof stdout === 'string')
      return rendre(
        `Cette façon change les mêmes lignes que la base depuis l’essai : ${liste(fichiersEnConflit(stdout))}. Rien n’a été publié ; la copie de la façon reste là.`
      )
    return rendre(
      `La fusion de cette façon a échoué : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    )
  }
  const arbreFusionne = fusion.split(/\r?\n/u)[0]?.trim() ?? ''
  try {
    // La copie neuve passe de la base à l'arbre fusionné : ajouts, retraits et suppressions.
    await git(['read-tree', '-m', '-u', 'HEAD', arbreFusionne], copie)
  } catch (erreur) {
    return rendre(
      `L’écart de cette façon n’a pas pu être posé dans la copie de publication : ${erreur instanceof Error ? erreur.message : String(erreur)}`
    )
  }
  return traduire(
    await entree.publication.fermer(runId, true),
    ecart.fichiers.map((fichier) => fichier.chemin)
  )
}
