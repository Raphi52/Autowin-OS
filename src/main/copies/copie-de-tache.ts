/**
 * LA PRIMITIVE DES COPIES DE TÂCHE : quatre gestes sur une copie git d'un dépôt, pour un fil ou un run.
 *
 *  - `ouvrirLaCopieDeTache` : une copie détachée à la photo du dépôt, rangée sous la racine unique
 *    (`copies-de-taches\<tâche>`), avec sa base posée.
 *  - `entrerLeTravailDeLaCopie` : ce que la copie a changé depuis sa base entre dans la branche par une
 *    fusion à trois voies. Refus, copie gardée, si un fichier visé est modifié et non commité dans le
 *    dossier partagé, si la fusion a un conflit, ou si le contrôle des noms d'entreprise refuse ce qui
 *    entrerait. Ces refus arrivent avant que la branche avance : rien n'est alors écrit. Seule une base qui ne
 *    suit pas l'avance laisse le travail dans la branche, et le refus le dit.
 *  - `retirerLaCopieDeTache` : la copie part seulement si elle ne porte aucun écart et qu'aucune tâche ne
 *    l'utilise. Elle est d'abord renommée `a-supprimer__<tâche>`, puis supprimée.
 *  - `reprendreLesSuppressionsCoupees` : finit ce qu'un retrait ou une création interrompus ont laissé sur le
 *    disque.
 *
 * La primitive ne pousse jamais rien vers un distant : aucun de ses gestes ne l'atteint. Chaque geste exige
 * `sansDistant: true` pour que l'appelant le dise à chaque appel, au lieu de le supposer.
 *
 * Les fonctions reprises (photo, base, porte, ménage, retrait) restent en service à leur place : ce module
 * ne les remplace pas encore, et ne les modifie pas.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { raisonDeLErreur as message } from '../../shared/raison-de-l-erreur'
import { supprimerArbreAsync } from '../fichiers/fs-supprimer'
import {
  avancerLaBaseDuFil,
  LONGUEUR_MAX_CHEMIN_DE_COPIE,
  lireLaBaseDuFil,
  ouvrirCopieDeLaPhoto,
  photographierLeCode,
  refDeBaseDuFil
} from '../git/photo-du-code'
import { controleDeSeparation, type ResultatDeSeparation } from '../git/controle-de-separation'
import { arbreDeLaCopie } from '../orchestration/garder-un-essai'
import { defaultGitRunner, type GitRunner, parsePorcelainPaths } from '../runs/run-autoclose'
import {
  delierLesDependances,
  lierLesDependances,
  type LiaisonDependances
} from '../store/dependances-copie-agent'
import { dossierDeCopieDeTache, racineDesCopiesDeTaches } from './chemins-de-copies'

/** Le préfixe d'une copie décrochée : un retrait interrompu la reprend au passage suivant. */
export const PREFIXE_A_SUPPRIMER = 'a-supprimer__'

/** Le dossier où une copie se crée avant de prendre son nom : il n'a jamais été remis à une tâche. */
export const PREFIXE_EN_CREATION = 'en-creation__'

/**
 * La photo d'une ouverture attend son résultat : rien ne part sans la copie. Un budget de tour (5 s)
 * la ferait échouer sur une machine chargée, avec un message qui accuserait le dépôt.
 */
const DELAI_PHOTO_MS = 30_000

/**
 * Au-delà de ce délai, un appel git est tenu pour muet : le geste refuse au lieu de tenir la file de la racine.
 * Créer une copie sur un grand dépôt peut légitimement prendre plusieurs dizaines de secondes.
 */
const DELAI_PAR_APPEL_GIT_MS = 120_000

/** L'auteur des commits de la primitive : jamais l'identité de l'utilisateur, qui n'a rien commité. */
const AUTEUR = {
  GIT_AUTHOR_NAME: 'Autowin',
  GIT_AUTHOR_EMAIL: 'autowin@localhost',
  GIT_COMMITTER_NAME: 'Autowin',
  GIT_COMMITTER_EMAIL: 'autowin@localhost'
}

/**
 * Les gestes d'une même racine passent un à un : deux appels sur une même tâche ne se marchent pas dessus. Sinon
 * la seconde trouverait la base ou le dossier provisoire de la première à moitié posés.
 */
const filesParRacine = new Map<string, Promise<void>>()

function enFile<T>(dossierDeDonnees: string, geste: () => Promise<T>): Promise<T> {
  const cle = racineDesCopiesDeTaches(dossierDeDonnees)
  const precedent = filesParRacine.get(cle) ?? Promise.resolve()
  const resultat = precedent.then(geste)
  const fin = resultat.then(
    () => undefined,
    () => undefined
  )
  filesParRacine.set(cle, fin)
  void fin.then(() => {
    if (filesParRacine.get(cle) === fin) filesParRacine.delete(cle)
  })
  return resultat
}

/** Ce que chaque geste reçoit : le dépôt partagé, la tâche, et la déclaration qu'il ne pousse rien. */
export interface EntreeDeCopie {
  /** Le dossier de données de l'app : la racine unique des copies y vit. */
  dossierDeDonnees: string
  /** Le dépôt partagé dont la copie est tirée, par sa racine. */
  depot: string
  /** L'identifiant de la tâche (fil ou run) : il nomme la copie et sa base. */
  tache: string
  /** Déclaration explicite : la primitive ne pousse jamais rien vers un distant. */
  sansDistant: true
  /** Le délai accordé à chaque appel git ; au-delà, le geste refuse. Par défaut, 120 s. */
  delaiGitMs?: number
  runGit?: GitRunner
}

export type MotifDeRefusCopie =
  | 'identifiant-invalide'
  | 'chemin-trop-long'
  | 'dossier-occupe'
  | 'copie-absente'
  | 'pas-la-copie'
  | 'base-absente'
  | 'enregistrement-absent'
  | 'modifie-non-commite'
  | 'conflit'
  | 'separation'
  | 'ecart'
  | 'utilisee'
  | 'suppression-en-cours'
  | 'echec'

/**
 * Une copie reprise se rend telle quelle, son lien de dépendances vérifié à chaque ouverture : posé s'il manque,
 * laissé s'il est là. Une copie qu'on ouvre se lie au dépôt, et le dit.
 */
export type OuvertureDeCopie =
  | { ok: true; chemin: string; base: string; deja: false; dependances: LiaisonDependances }
  | { ok: true; chemin: string; base: string; deja: true; dependances: LiaisonDependances }
  | { ok: false; motif: MotifDeRefusCopie; raison: string }

export type ResultatEntree =
  | {
      ok: true
      etat: 'entree'
      commit: string
      base: string
      fichiers: string[]
      /** Un profil d'entreprise mal formé : l'entrée passe, et l'appelant doit le voir (comme `garder`). */
      avertissement?: string
    }
  | { ok: true; etat: 'rien-a-entrer'; base: string }
  | { ok: false; motif: MotifDeRefusCopie; raison: string; fichiers?: string[] }

export type ResultatRetrait =
  | { ok: true; etat: 'retiree' | 'deja-absente' }
  | { ok: false; motif: MotifDeRefusCopie; raison: string; fichiers?: string[] }

export interface BilanDeReprise {
  reprises: string[]
  echecs: Array<{ chemin: string; raison: string }>
}

/**
 * OUVRIR : la base de la tâche posée à la photo du dépôt, puis la copie détachée à cette même photo. La base
 * passe d'abord : une ouverture coupée entre les deux ne laisse qu'une base sans copie, que l'ouverture suivante
 * avance à sa photo. L'ordre inverse laisserait une copie sans base, que rien ne répare.
 *
 * Une copie déjà ouverte se rend telle quelle, à une condition : le dépôt la reconnaît comme sa copie. Une copie
 * renommée sans être recalée répond encore aux commandes git, mais le refus la nomme au lieu de la rendre ouverte.
 * Un dossier qui occupe la place sans être la copie de cette tâche n'est jamais écrit par-dessus : il peut porter
 * du travail. La photo prend le dépôt tel quel, travail non commité des autres compris ; la base n'avance donc que
 * sur ce que la copie a changé depuis.
 */
export function ouvrirLaCopieDeTache(
  entree: EntreeDeCopie & { quand?: number }
): Promise<OuvertureDeCopie> {
  return enFile(entree.dossierDeDonnees, () =>
    ouvrirSansFile(entree).catch((erreur: unknown) => echecDeGit(erreur))
  )
}

async function ouvrirSansFile(
  entree: EntreeDeCopie & { quand?: number }
): Promise<OuvertureDeCopie> {
  const copie = emplacementDeLaCopie(entree.dossierDeDonnees, entree.tache)
  if (!copie)
    return refus(
      'identifiant-invalide',
      `« ${entree.tache} » ne peut pas nommer une copie ni sa base : aucune copie n’a été ouverte.`
    )
  if (copie.length > LONGUEUR_MAX_CHEMIN_DE_COPIE)
    return refus(
      'chemin-trop-long',
      `Le dossier de la copie ferait ${copie.length} caractères : git pour Windows en accepte ${LONGUEUR_MAX_CHEMIN_DE_COPIE} au plus. Aucune copie n’a été ouverte.`
    )
  const git = await gitDeLaPrimitive(entree)

  if (existsSync(copie) || estUnLien(copie)) {
    const pasLaCopie = await raisonSiPasLaCopie(copie, git)
    if (pasLaCopie)
      return refus(
        'dossier-occupe',
        `Le dossier ${copie} existe déjà sans être la copie de cette tâche : rien n’a été écrit par-dessus.`
      )
    const base = await lireLaBaseDuFil({
      dossier: copie,
      conversationId: entree.tache,
      runGit: git
    })
    // La copie est bien la sienne, sans base : une ouverture interrompue entre la copie et sa base, ou une
    // base supprimée. Rien n'est posé à la main : une base sur une copie dont l'historique est inconnu
    // pourrait cacher du travail.
    if (!base)
      return refus(
        'base-absente',
        `La copie ${copie} existe, mais sa base de tâche manque. Rien n’a été réparé ni écrit.`
      )
    if (!(await copieReconnueParLeDepot(copie, entree.depot, git)))
      return refus(
        'enregistrement-absent',
        `La copie ${copie} existe, mais le dépôt ne la reconnaît pas comme sa copie. Rien n’a été réparé ni écrit. ${commandeDeReparation(entree.depot, copie)}`
      )
    // Le lien repasse à chaque ouverture : laissé s'il est là, posé s'il manque.
    const dependances = lierLesDependances(entree.depot, copie)
    return { ok: true, chemin: copie, base, deja: true, dependances }
  }

  // Le dossier provisoire porte le même nom, avec un préfixe : c'est lui qui doit tenir sous la limite.
  const provisoire = join(dirname(copie), `${PREFIXE_EN_CREATION}${entree.tache}`)
  if (provisoire.length > LONGUEUR_MAX_CHEMIN_DE_COPIE)
    return refus(
      'chemin-trop-long',
      `Le dossier provisoire de la copie ferait ${provisoire.length} caractères : git pour Windows en accepte ${LONGUEUR_MAX_CHEMIN_DE_COPIE} au plus. Aucune copie n’a été ouverte.`
    )
  if (estUnLien(provisoire))
    return refus('dossier-occupe', `« ${provisoire} » est un lien : rien n’a été écrit par-dessus.`)
  if (existsSync(provisoire)) {
    // Une création interrompue : son dossier n'a jamais été remis à une tâche, il se défait avant d'en refaire un.
    const defait = await finirLeRetrait(provisoire, entree.depot, git)
    if (!defait.ok)
      return refus(
        'echec',
        `Une création précédente de cette copie est restée coupée : ${defait.raison}`
      )
  }

  const photo = await photographierLeCode({
    dossier: entree.depot,
    conversationId: entree.tache,
    quand: entree.quand ?? Date.now(),
    runGit: git,
    delaiMaxMs: DELAI_PHOTO_MS
  })
  if (!photo)
    return refus(
      'echec',
      'Impossible de photographier le dépôt : il n’est pas un dépôt git, ou la photo n’a pas pu être prise à temps. Aucune copie n’a été ouverte.'
    )
  // La base d'abord, à la photo ; la copie en sort ensuite, à cette même photo. Une base déjà là (copie
  // précédente retirée) avance jusqu'ici : sinon le prochain passage republierait ce que la copie précédente a
  // déjà fait entrer. Une pose de base interrompue ne laisse jamais de copie sans base.
  const lue = await lireLaBaseDuFil({
    dossier: entree.depot,
    conversationId: entree.tache,
    runGit: git
  })
  const posee = await avancerLaBaseDuFil({
    dossier: entree.depot,
    conversationId: entree.tache,
    depuis: lue,
    vers: photo.sha,
    runGit: git
  })
  if (!posee.ok)
    return refus(
      'echec',
      `La base de la tâche n’a pas été posée : ${posee.raison}. Aucune copie n’a été ouverte.`
    )

  // La copie se crée sous le nom provisoire et ne prend son nom qu'une fois entière : un dossier à moitié rempli
  // n'est jamais rendu comme la copie d'une tâche.
  try {
    mkdirSync(racineDesCopiesDeTaches(entree.dossierDeDonnees), { recursive: true })
    await ouvrirCopieDeLaPhoto({
      dossier: entree.depot,
      sha: photo.sha,
      destination: provisoire,
      runGit: git
    })
    renameSync(provisoire, copie)
  } catch (erreur) {
    return refus(
      'echec',
      `La copie n’a pas pu être ouverte : ${message(erreur)}. Sa base est posée à la photo : l’ouverture suivante reprend d’ici.`
    )
  }

  // Sans ce lien, la copie ne peut lancer aucun test : il passe avant le recalage. Un lien raté n'annule pas la
  // copie, il est rendu pour que l'appelant le dise.
  const dependances = lierLesDependances(entree.depot, copie)
  // Le renommage a déplacé la copie : son enregistrement git doit suivre avant qu'elle soit rendue ouverte.
  const raisonDuRecalage = await recalerLEnregistrement(copie, entree.depot, git)
  if (raisonDuRecalage)
    return refus(
      'echec',
      `La copie est posée, mais le dépôt ne la reconnaît pas encore : ${raisonDuRecalage}. Elle n’est pas rendue ouverte. ${commandeDeReparation(entree.depot, copie)}`
    )
  return { ok: true, chemin: copie, base: posee.sha, deja: false, dependances }
}

/**
 * ENTRER : ce que la copie a changé depuis sa base entre dans la branche du dépôt, par une fusion à trois
 * voies calculée à blanc (`merge-tree`) puis appliquée en avance rapide seulement. La base avance ensuite
 * jusqu'au travail entré, si bien qu'un second passage sans changement n'ajoute rien.
 *
 * Le dossier partagé n'est touché qu'à la fin, et seulement sur les fichiers visés, qui ont été vérifiés
 * non modifiés. Un refus avant l'avance de la branche laisse la branche, le dossier partagé et la copie tels
 * qu'ils étaient. Après cette avance, le seul refus possible est une base qui ne suit pas : le travail est
 * alors dans la branche, le refus le dit, et une nouvelle entrée ne l'ajoute pas une seconde fois.
 */
export function entrerLeTravailDeLaCopie(
  entree: EntreeDeCopie & { messageDuCommit?: string }
): Promise<ResultatEntree> {
  return enFile(entree.dossierDeDonnees, () =>
    entrerSansFile(entree).catch((erreur: unknown) => echecDeGit(erreur))
  )
}

async function entrerSansFile(
  entree: EntreeDeCopie & { messageDuCommit?: string }
): Promise<ResultatEntree> {
  const copie = emplacementDeLaCopie(entree.dossierDeDonnees, entree.tache)
  if (!copie)
    return refus(
      'identifiant-invalide',
      `« ${entree.tache} » ne peut pas nommer une copie : rien n’est entré.`
    )
  if (!existsSync(copie) && !estUnLien(copie))
    return refus('copie-absente', 'Aucune copie pour cette tâche : rien à entrer.')
  const git = await gitDeLaPrimitive(entree)
  const pasLaCopie = await raisonSiPasLaCopie(copie, git)
  if (pasLaCopie) return refus('pas-la-copie', pasLaCopie)

  const base = await lireLaBaseDuFil({ dossier: copie, conversationId: entree.tache, runGit: git })
  if (!base)
    return refus(
      'base-absente',
      'Aucune base posée pour cette copie : impossible de savoir ce qui est à entrer. La copie reste.'
    )

  let ecart: EcartDeLaCopie
  try {
    ecart = await ecartDeLaCopie(copie, base, git)
  } catch (erreur) {
    return refus(
      'echec',
      `Le travail de la copie n’a pas pu être lu : ${message(erreur)}. Rien n’est entré.`
    )
  }
  if (ecart.fichiers.length === 0) return { ok: true, etat: 'rien-a-entrer', base }

  // La tête est lue une seule fois : la fusion à blanc, le contrôle et l'avance portent sur la même. Si elle bouge
  // entre-temps, l'avance en fusion rapide refuse au lieu d'annuler le travail venu d'ailleurs.
  const teteDuDepot = (await git(['rev-parse', 'HEAD'], entree.depot)).trim()
  const arbreDeLaTete = (await git(['rev-parse', `${teteDuDepot}^{tree}`], entree.depot)).trim()

  // La fusion se calcule à blanc : le travail de la copie devient un commit rangé hors de la branche, puis git
  // donne l'arbre fusionné avec la tête lue plus haut, sans rien écrire dans le dossier partagé.
  let passage: string
  let arbreFusionne: string
  try {
    passage = (
      await git(
        [
          '-c',
          'commit.gpgsign=false',
          'commit-tree',
          ecart.arbreCopie,
          '-p',
          base,
          '-m',
          `Passage de ${entree.tache}`
        ],
        entree.depot,
        { env: AUTEUR }
      )
    ).trim()
    const fusion = await git(
      ['merge-tree', '--write-tree', '--name-only', `--merge-base=${base}`, teteDuDepot, passage],
      entree.depot
    )
    arbreFusionne = fusion.split(/\r?\n/u)[0]?.trim() ?? ''
  } catch (erreur) {
    // `merge-tree` rend 1 sur un conflit de contenu, et nomme les fichiers après la ligne d'arbre.
    const { code, stdout } = erreur as { code?: unknown; stdout?: unknown }
    if (code === 1 && typeof stdout === 'string') {
      const enConflit = fichiersEnConflit(stdout)
      return refus(
        'conflit',
        `Conflit avec la branche sur ${liste(enConflit)} : rien n’est entré, la copie reste.`,
        enConflit
      )
    }
    return refus(
      'echec',
      `La fusion n’a pas pu être calculée : ${message(erreur)}. Rien n’est entré.`
    )
  }

  if (arbreFusionne === arbreDeLaTete) {
    // La branche contient déjà tout ce que la copie apporte : rien à ajouter, la base avance seulement.
    const avance = await avancerLaBaseDuFil({
      dossier: copie,
      conversationId: entree.tache,
      depuis: base,
      vers: passage,
      runGit: git
    })
    if (!avance.ok)
      return refus(
        'echec',
        `La branche contient déjà ce travail, mais la base n’a pas avancé : ${avance.raison}.`
      )
    return { ok: true, etat: 'rien-a-entrer', base: avance.sha }
  }

  // Un fichier visé modifié et non commité dans le dossier partagé : refus, et rien n'y est écrit.
  const sales = fichiersNonCommites(
    await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], entree.depot)
  )
  const bloquants = ecart.fichiers.filter((chemin) => sales.has(chemin))
  if (bloquants.length > 0)
    return refus(
      'modifie-non-commite',
      `Modifié et non commité dans le dossier partagé : ${liste(bloquants)}. Rien n’y a été écrit ; la copie reste.`,
      bloquants
    )
  // `status` ne montre pas les fichiers ignorés par git : ceux que la fusion écrirait sont vérifiés à part.
  const ignores = await fichiersIgnoresQueLaFusionEcraserait(
    ecart.fichiers,
    teteDuDepot,
    entree.depot,
    git
  )
  if (ignores.length > 0)
    return refus(
      'modifie-non-commite',
      `Ignoré par git et non suivi dans le dossier partagé : ${liste(ignores)}. La fusion l’écraserait sans prévenir : rien n’y a été écrit ; la copie reste.`,
      ignores
    )

  // Le commit qui porte ce travail est posé sans crochet : le contrôle des noms d'entreprise passe avant
  // lui, sur ce qu'il emporte (de la tête du dépôt à l'arbre fusionné). Un refus n'écrit rien.
  const messageDuCommit = entree.messageDuCommit ?? `Entrée du travail de ${entree.tache}`
  let separation: ResultatDeSeparation
  try {
    separation = await controleDeSeparation({
      copie,
      base: teteDuDepot,
      arbre: arbreFusionne,
      message: messageDuCommit,
      git
    })
  } catch (erreur) {
    return refus(
      'echec',
      `Le contrôle des noms d’entreprise n’a pas pu tourner : ${message(erreur)}. Rien n’est entré.`
    )
  }
  if (!separation.ok) return refus('separation', separation.raison)

  // Avance rapide seulement, depuis la tête lue plus haut : git refuse si la tête a bougé, et refuse de toucher un
  // fichier modifié localement ou ignoré au moment même de l'écriture. Un `update-ref` seul laisserait l'index et
  // les fichiers du dossier partagé sur l'ancienne version : le travail entré y paraîtrait modifié à l'envers.
  let commit: string
  try {
    commit = (
      await git(
        [
          '-c',
          'commit.gpgsign=false',
          'commit-tree',
          arbreFusionne,
          '-p',
          teteDuDepot,
          '-m',
          messageDuCommit
        ],
        entree.depot,
        { env: AUTEUR }
      )
    ).trim()
    await git(
      ['-c', 'merge.autoStash=false', 'merge', '--ff-only', '--no-overwrite-ignore', '-q', commit],
      entree.depot
    )
  } catch (erreur) {
    return refus(
      'echec',
      `La branche n’a pas avancé : ${message(erreur)}. Rien n’est entré ; la copie reste.`,
      ecart.fichiers
    )
  }

  const avance = await avancerLaBaseDuFil({
    dossier: copie,
    conversationId: entree.tache,
    depuis: base,
    vers: passage,
    runGit: git
  })
  if (!avance.ok)
    return refus(
      'echec',
      `Le travail est entré dans la branche (${commit}), mais la base de la copie n’a pas avancé : ${avance.raison}. Relancer l’entrée ne l’ajoutera pas une seconde fois.`,
      ecart.fichiers
    )
  return {
    ok: true,
    etat: 'entree',
    commit,
    base: avance.sha,
    fichiers: ecart.fichiers,
    ...(separation.avertissement ? { avertissement: separation.avertissement } : {})
  }
}

/**
 * RETIRER : la copie part seulement si elle ne porte aucun écart à sa base, et si aucune tâche ne l'utilise.
 * Un écart, même minime, garde la copie : fichier suivi ou non suivi, ajouté, modifié ou supprimé. Les fichiers
 * ignorés par git (node_modules, par exemple) ne comptent pas : ils partent avec la copie.
 * La copie est d'abord renommée, dans le même geste synchrone que la dernière lecture des utilisateurs : une
 * tâche qui démarre ensuite ouvre une copie neuve au lieu de tomber sur un dossier qui disparaît.
 */
export function retirerLaCopieDeTache(
  entree: EntreeDeCopie & { tachesQuiLUtilisent: () => readonly string[] }
): Promise<ResultatRetrait> {
  return enFile(entree.dossierDeDonnees, () =>
    retirerSansFile(entree).catch((erreur: unknown) => echecDeGit(erreur))
  )
}

async function retirerSansFile(
  entree: EntreeDeCopie & { tachesQuiLUtilisent: () => readonly string[] }
): Promise<ResultatRetrait> {
  const copie = emplacementDeLaCopie(entree.dossierDeDonnees, entree.tache)
  if (!copie)
    return refus(
      'identifiant-invalide',
      `« ${entree.tache} » ne peut pas nommer une copie : rien n’est retiré.`
    )
  const decroche = join(dirname(copie), `${PREFIXE_A_SUPPRIMER}${entree.tache}`)
  if (existsSync(decroche))
    return refus(
      'suppression-en-cours',
      'Une suppression précédente de cette copie est restée coupée : la reprendre d’abord.'
    )
  if (!existsSync(copie) && !estUnLien(copie)) return { ok: true, etat: 'deja-absente' }

  const git = await gitDeLaPrimitive(entree)
  const pasLaCopie = await raisonSiPasLaCopie(copie, git)
  if (pasLaCopie) return refus('pas-la-copie', pasLaCopie)
  const utilisatrices = entree.tachesQuiLUtilisent()
  if (utilisatrices.length > 0)
    return refus('utilisee', `Encore utilisée par ${utilisatrices.join(', ')} : la copie reste.`)

  const base = await lireLaBaseDuFil({ dossier: copie, conversationId: entree.tache, runGit: git })
  if (!base)
    return refus(
      'base-absente',
      'Aucune base posée : impossible de prouver que rien ne serait perdu. La copie reste.'
    )
  let ecart: EcartDeLaCopie
  try {
    ecart = await ecartDeLaCopie(copie, base, git)
  } catch (erreur) {
    return refus(
      'echec',
      `L’écart de la copie n’a pas pu être mesuré : ${message(erreur)}. La copie reste.`
    )
  }
  if (ecart.fichiers.length > 0)
    return refus(
      'ecart',
      `Elle porte du travail non publié : ${liste(ecart.fichiers)}. La copie reste.`,
      ecart.fichiers
    )

  // Dernière lecture des utilisateurs, puis renommage, sans rien entre les deux.
  const encore = entree.tachesQuiLUtilisent()
  if (encore.length > 0)
    return refus('utilisee', `Encore utilisée par ${encore.join(', ')} : la copie reste.`)
  try {
    renameSync(copie, decroche)
  } catch (erreur) {
    return refus(
      'echec',
      `La copie est encore utilisée (${message(erreur)}) : elle reste en place.`
    )
  }
  return finirLeRetrait(decroche, entree.depot, git)
}

/**
 * REPRENDRE : finit les suppressions coupées, et défait les créations coupées (`en-creation__…`, jamais remises à
 * une tâche). Un dossier `a-supprimer__…` existe seulement après une lecture qui a prouvé la copie vide d'écart,
 * donc il se finit sans nouvelle lecture. Un lien posé à sa place n'est jamais suivi : il n'est pas une copie, et
 * rien n'est supprimé.
 */
export function reprendreLesSuppressionsCoupees(
  entree: Pick<
    EntreeDeCopie,
    'dossierDeDonnees' | 'depot' | 'sansDistant' | 'runGit' | 'delaiGitMs'
  >
): Promise<BilanDeReprise> {
  return enFile(entree.dossierDeDonnees, () =>
    reprendreSansFile(entree).catch((erreur: unknown) => ({
      reprises: [],
      echecs: [
        {
          chemin: racineDesCopiesDeTaches(entree.dossierDeDonnees),
          raison: message(erreur)
        }
      ]
    }))
  )
}

async function reprendreSansFile(
  entree: Pick<
    EntreeDeCopie,
    'dossierDeDonnees' | 'depot' | 'sansDistant' | 'runGit' | 'delaiGitMs'
  >
): Promise<BilanDeReprise> {
  const racine = racineDesCopiesDeTaches(entree.dossierDeDonnees)
  const bilan: BilanDeReprise = { reprises: [], echecs: [] }
  if (!existsSync(racine)) return bilan
  const git = await gitDeLaPrimitive(entree)
  let noms: string[]
  try {
    noms = readdirSync(racine)
  } catch (erreur) {
    bilan.echecs.push({ chemin: racine, raison: message(erreur) })
    return bilan
  }
  for (const nom of noms.filter(
    (n) => n.startsWith(PREFIXE_A_SUPPRIMER) || n.startsWith(PREFIXE_EN_CREATION)
  )) {
    const chemin = join(racine, nom)
    if (estUnLien(chemin)) {
      bilan.echecs.push({ chemin, raison: 'c’est un lien, pas une copie : rien n’est supprimé' })
      continue
    }
    const resultat = await finirLeRetrait(chemin, entree.depot, git)
    if (resultat.ok) bilan.reprises.push(chemin)
    else bilan.echecs.push({ chemin, raison: resultat.raison })
  }
  return bilan
}

/** Le dossier de la copie d'une tâche, ou `null` si la tâche ne peut nommer ni copie ni base. */
function emplacementDeLaCopie(dossierDeDonnees: string, tache: string): string | null {
  if (refDeBaseDuFil(tache) === null) return null
  return dossierDeCopieDeTache(racineDesCopiesDeTaches(dossierDeDonnees), tache)
}

/** Chaque geste passe ses appels git par ici : un appel muet refuse le geste au lieu de tenir la file. */
async function gitDeLaPrimitive(
  entree: Pick<EntreeDeCopie, 'runGit' | 'delaiGitMs'>
): Promise<GitRunner> {
  const git = entree.runGit ?? (await defaultGitRunner())
  return avecDelai(git, entree.delaiGitMs ?? DELAI_PAR_APPEL_GIT_MS)
}

/**
 * Un appel qui ne répond pas dans le délai est refusé. Le processus git reste en vie après le refus : un geste
 * suivant peut le trouver encore en cours.
 */
function avecDelai(git: GitRunner, delaiMs: number): GitRunner {
  return (args, cwd, options) => {
    let minuterie: ReturnType<typeof setTimeout> | undefined
    const sansReponse = new Promise<never>((_, rejette) => {
      minuterie = setTimeout(
        () =>
          rejette(new Error(`une commande git n’a pas répondu en ${Math.round(delaiMs / 1000)} s`)),
        delaiMs
      )
    })
    return Promise.race([git(args, cwd, options), sansReponse]).finally(() =>
      clearTimeout(minuterie)
    )
  }
}

/** Une commande git qui échoue ou se tait devient un refus du geste, jamais une exception qui sort de la primitive. */
const echecDeGit = (erreur: unknown): ReturnType<typeof refus> =>
  refus('echec', `Une commande git a échoué ou n’a pas répondu à temps : ${message(erreur)}.`)

/** La commande à taper pour rendre à une copie son enregistrement git. */
const commandeDeReparation = (depot: string, copie: string): string =>
  `Pour la réparer : git -C "${depot}" worktree repair "${copie}".`

interface EcartDeLaCopie {
  arbreCopie: string
  fichiers: string[]
}

/**
 * Ce que la copie porte de plus ou de moins que sa base, fichiers non suivis compris (les ignorés
 * exclus). Un écart vide veut dire que la copie n'apporte rien à la branche.
 */
async function ecartDeLaCopie(
  copie: string,
  base: string,
  git: GitRunner
): Promise<EcartDeLaCopie> {
  const arbreCopie = await arbreDeLaCopie(copie, git)
  const arbreBase = (await git(['rev-parse', `${base}^{tree}`], copie)).trim()
  const fichiers =
    arbreCopie === arbreBase
      ? []
      : (
          await git(
            ['diff-tree', '-r', '--name-only', '--no-renames', '-z', arbreBase, arbreCopie],
            copie
          )
        )
          .split('\0')
          .filter(Boolean)
  return { arbreCopie, fichiers }
}

/**
 * Les chemins modifiés, ajoutés, supprimés ou non suivis du dossier partagé. La sortie doit venir de
 * `status --untracked-files=all` : sans `all`, git replie un dossier non suivi en une seule entrée.
 */
function fichiersNonCommites(sortie: string): Set<string> {
  return new Set(parsePorcelainPaths(sortie))
}

/**
 * Les chemins que la fusion écrirait et qui existent déjà dans le dossier partagé sans être suivis par la tête :
 * ce sont des fichiers ignorés (les non ignorés non suivis sont déjà refusés par `status`). Rien n'est lu dans
 * l'arbre de la tête tant qu'aucun de ces chemins n'existe sur le disque.
 */
async function fichiersIgnoresQueLaFusionEcraserait(
  chemins: readonly string[],
  tete: string,
  depot: string,
  git: GitRunner
): Promise<string[]> {
  const presents = chemins.filter((chemin) => {
    const sur = join(depot, chemin)
    return existsSync(sur) || estUnLien(sur)
  })
  if (presents.length === 0) return []
  const suivis = new Set(
    (await git(['ls-tree', '-r', '-z', '--name-only', tete], depot)).split('\0').filter(Boolean)
  )
  return presents.filter((chemin) => !suivis.has(chemin))
}

/** Les fichiers en conflit, lus dans la sortie de `merge-tree --name-only` (après la ligne d'arbre). */
function fichiersEnConflit(sortie: string): string[] {
  const lignes = sortie.split(/\r?\n/u).slice(1)
  const fin = lignes.indexOf('')
  return (fin === -1 ? lignes : lignes.slice(0, fin)).filter(Boolean)
}

/**
 * Le dépôt tient le dossier pour sa copie : son enregistrement git y pointe. Une copie renommée sans recalage
 * répond encore aux commandes git, mais le dépôt ne la reconnaît plus, et son ménage l'emporterait.
 */
async function copieReconnueParLeDepot(
  copie: string,
  depot: string,
  git: GitRunner
): Promise<boolean> {
  const sortie = await git(['worktree', 'list', '--porcelain'], depot)
  return sortie
    .split(/\r?\n/u)
    .some(
      (ligne) =>
        ligne.startsWith('worktree ') && memeDossier(ligne.slice('worktree '.length), copie)
    )
}

/**
 * Recale l'enregistrement git d'une copie sur son chemin actuel : sans effet sur une copie juste. Rend la raison
 * de l'échec, ou `null`.
 */
async function recalerLEnregistrement(
  copie: string,
  depot: string,
  git: GitRunner
): Promise<string | null> {
  try {
    await git(['worktree', 'repair', copie], depot)
    return null
  } catch (erreur) {
    return message(erreur)
  }
}

/**
 * Retire un dossier déjà décroché : le lien des modules d'abord (il mène aux modules du dépôt), puis l'arbre
 * par une suppression qui ne suit jamais un lien, puis l'enregistrement git. Un dossier qui reste sur le
 * disque n'est pas un retrait conclu : il est dit, et la reprise le finira.
 */
async function finirLeRetrait(
  decroche: string,
  depot: string,
  git: GitRunner
): Promise<ResultatRetrait> {
  const lien = delierLesDependances(decroche)
  if (lien.fait === 'echec')
    return refus(
      'echec',
      `Le lien des modules n’a pas pu être retiré (${lien.raison}) : la copie sera reprise.`
    )
  try {
    await supprimerArbreAsync(decroche)
  } catch (erreur) {
    return refus(
      'echec',
      `La copie n’a pas pu être supprimée entièrement : ${message(erreur)}. Elle sera reprise.`
    )
  }
  if (existsSync(decroche))
    return refus('echec', `Le dossier ${decroche} reste sur le disque. Il sera repris.`)
  try {
    await git(['worktree', 'prune'], depot)
  } catch (erreur) {
    return refus(
      'echec',
      `La copie est retirée, mais git garde son enregistrement : ${message(erreur)}.`
    )
  }
  return { ok: true, etat: 'retiree' }
}

/**
 * Refus si `copie` n'est pas une copie git à soi : un lien (une jonction ne se suit jamais), ou un dossier
 * qui n'est pas la racine de son propre dépôt, comme un dossier posé à l'intérieur d'un autre dépôt.
 */
async function raisonSiPasLaCopie(copie: string, git: GitRunner): Promise<string | null> {
  if (estUnLien(copie)) return `« ${copie} » est un lien, pas une copie : rien n’est touché.`
  let racine = ''
  try {
    racine = (await git(['rev-parse', '--show-toplevel'], copie)).trim()
  } catch {
    racine = ''
  }
  if (!racine || !memeDossier(racine, copie))
    return `« ${copie} » n’est pas une copie git : rien n’est touché.`
  return null
}

function estUnLien(chemin: string): boolean {
  try {
    return lstatSync(chemin).isSymbolicLink()
  } catch {
    return false
  }
}

/** Deux chemins désignent le même dossier : Windows compare sans casse et suit le vrai chemin. */
function memeDossier(a: string, b: string): boolean {
  return normaliserChemin(a) === normaliserChemin(b)
}

function normaliserChemin(chemin: string): string {
  let reel = resolve(chemin)
  try {
    reel = realpathSync.native(reel)
  } catch {
    // Absent : on compare le chemin tel quel.
  }
  return reel.replace(/[\\/]+$/u, '').toLowerCase()
}

function liste(fichiers: readonly string[]): string {
  return fichiers.length > 0 ? fichiers.join(', ') : 'fichiers non nommés'
}

const refus = (
  motif: MotifDeRefusCopie,
  raison: string,
  fichiers?: readonly string[]
): { ok: false; motif: MotifDeRefusCopie; raison: string; fichiers?: string[] } => ({
  ok: false,
  motif,
  raison,
  ...(fichiers ? { fichiers: [...fichiers] } : {})
})
