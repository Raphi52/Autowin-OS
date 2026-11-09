import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { memeCheminSurDisque } from '../fichiers/meme-chemin'
import { ouvrirLaCopieDeTache, type OuvertureDeCopie } from '../copies/copie-de-tache'
import { dossierDeCopieDeTache, racineDesCopiesDeTaches } from '../copies/chemins-de-copies'
import { LONGUEUR_MAX_CHEMIN_DE_COPIE } from '../git/photo-du-code'
import type { GitRunner } from '../runs/run-autoclose'
import { DOSSIER_DES_COPIES_DE_FIL } from '../../shared/copie-du-fil'

/**
 * POURQUOI un rangement ne pilote PAS le dossier de travail (regle du 2026-09-08).
 *
 * Un rangement peut ne pas piloter le dossier pour plusieurs raisons, dont deux sont des DEFAUTS
 * silencieux : un libelle pris pour un chemin, et un dossier disparu. Dans ces deux cas le modele
 * travaillait dans le depot d'Autowin sans que rien ne le dise. Ce diagnostic nomme le motif pour
 * que le fil puisse l'AFFICHER, au lieu du silence.
 *
 * Regle posee par l'utilisateur : le dossier range sur la conversation et le dossier de travail ne
 * doivent JAMAIS differer — toute divergence est un defaut, pas un cas a rattraper.
 */
/**
 * La condition d'entree COMMUNE aux deux fonctions publiques : un rangement ne designe un dossier
 * utilisable que s'il est renseigne, absolu, et present sur ce poste. Rend le chemin resolu, ou
 * `null` quand l'une des trois conditions manque. Factorise pour que les deux reponses (le motif
 * affiche a l'utilisateur, et le dossier du tour) ne puissent pas diverger.
 */
function dossierRangeUtilisable(
  projectPath: string | undefined | null,
  dossierExiste: (chemin: string) => boolean
): string | null {
  const range = projectPath?.trim()
  if (!range) return null
  if (!isAbsolute(range)) return null
  const cible = resolve(range)
  return dossierExiste(cible) ? cible : null
}

export type MotifDossierConversation =
  'bascule-requise' | 'deja-aligne' | 'non-range' | 'libelle-non-absolu' | 'dossier-absent'

export function diagnostiqueDossierConversation(
  projectPath: string | undefined | null,
  workspaceActif: string,
  dossierExiste: (chemin: string) => boolean = existsSync
): MotifDossierConversation {
  const range = projectPath?.trim()
  if (!range) return 'non-range'
  if (!isAbsolute(range)) return 'libelle-non-absolu'
  const cible = dossierRangeUtilisable(projectPath, dossierExiste)
  if (!cible) return 'dossier-absent'
  if (memeCheminSurDisque(cible, workspaceActif)) return 'deja-aligne'
  return 'bascule-requise'
}

/** Les DEUX motifs qui font travailler le modele ailleurs que la ou l'utilisateur croit. */
export function avertissementDossierConversation(
  motif: MotifDossierConversation,
  projectPath: string | undefined | null,
  workspaceActif: string
): string | null {
  const range = projectPath?.trim() ?? ''
  if (motif === 'libelle-non-absolu') {
    return `⚠️ Le dossier de cette conversation (« ${range} ») n'est pas un chemin de dossier, juste un libellé de rangement : il ne pilote donc pas le dossier de travail. Je travaille dans ${workspaceActif}, et c'est son AGENTS.md qui est lu. Mets le chemin complet du projet pour y basculer.`
  }
  if (motif === 'dossier-absent') {
    return `⚠️ Le dossier de cette conversation (${range}) est introuvable sur ce poste : il ne pilote donc pas le dossier de travail. Je travaille dans ${workspaceActif}, et c'est son AGENTS.md qui est lu.`
  }
  return null
}

/**
 * LE DOSSIER DE TRAVAIL DU TOUR — resolu a CHAQUE tour depuis la conversation courante.
 *
 * Le dossier de travail etait GLOBAL et fige au demarrage (`os.ts`, `executionWorkspace`) : deux
 * conversations rangees dans deux projets differents travaillaient dans le MEME dossier, et le seul
 * moyen d'aligner etait un redemarrage de l'app (qui coupe le tour en cours). Cette fonction rend le
 * dossier a utiliser POUR CE TOUR : le rangement de la conversation quand il designe un dossier reel,
 * sinon le repli global. Elle ne mute rien — la valeur est PASSEE en argument, jamais posee dans
 * `process.env` : plusieurs tours tournent en parallele et se voleraient le dossier.
 */
export function dossierDeTravailDuTour(
  projectPath: string | undefined | null,
  repli: string,
  dossierExiste: (chemin: string) => boolean = existsSync
): string {
  const disparu = dossierRangeDisparu(projectPath, dossierExiste)
  if (disparu !== null) throw new DossierRangeDisparuError(disparu)
  return dossierRangeUtilisable(projectPath, dossierExiste) ?? repli
}

/**
 * Le refus d'un tour dont le dossier rangé a disparu. Le fil AFFICHE `message` tel quel : il nomme
 * le chemin perdu et le geste pour en choisir un autre. Rien ne se replie sur le dossier partagé :
 * un fil rangé dans sa propre copie qui travaillerait là écrirait dans le dépôt d'où tourne l'app.
 */
export class DossierRangeDisparuError extends Error {
  constructor(readonly dossierRange: string) {
    super(
      `⛔ Le dossier de travail rangé sur cette conversation (${dossierRange}) a disparu de ce poste. Je n'ai lancé aucun tour, pour ne pas travailler à sa place dans le dépôt partagé. Choisis un autre dossier pour cette conversation (la pastille du dossier, en haut du fil), puis renvoie ton message.`
    )
    this.name = 'DossierRangeDisparuError'
  }
}

/** Le chemin rangé quand il est absolu mais absent du poste ; `null` dans tous les autres cas. */
function dossierRangeDisparu(
  projectPath: string | undefined | null,
  dossierExiste: (chemin: string) => boolean
): string | null {
  const range = projectPath?.trim()
  if (!range || !isAbsolute(range)) return null
  const cible = resolve(range)
  return dossierExiste(cible) ? null : cible
}

/** La raison du refus d'un tour, ou `null` si le tour peut partir. Ne lève pas. */
export function refusDossierDuTour(
  projectPath: string | undefined | null,
  dossierExiste: (chemin: string) => boolean = existsSync
): string | null {
  const disparu = dossierRangeDisparu(projectPath, dossierExiste)
  return disparu === null ? null : new DossierRangeDisparuError(disparu).message
}

/**
 * Entrée d'un tour : si le dossier rangé du fil a disparu, écrit la raison dans le fil puis LÈVE,
 * pour que le tour ne parte jamais dans le dépôt partagé. L'écriture dans le fil est best-effort :
 * le refus est levé même si elle échoue. Sans dossier rangé, ne fait rien (comportement inchangé).
 */
export function refuserTourSiDossierDisparu(
  projectPath: string | undefined | null,
  ecrireDansLeFil: (raison: string) => void,
  dossierExiste: (chemin: string) => boolean = existsSync
): void {
  const raison = refusDossierDuTour(projectPath, dossierExiste)
  if (!raison) return
  try {
    ecrireDansLeFil(raison)
  } catch {
    // Le refus compte plus que son affichage : il reste levé.
  }
  throw new Error(raison)
}

/**
 * Le dossier à LIRE pour un fil hors tour (fichiers, terminal, carte, contexte) : même résolution
 * que le tour, mais un dossier disparu retombe sur le repli au lieu de lever, pour qu'un écran ne
 * plante pas. Ne sert JAMAIS à lancer un tour : le refus se décide à l'entrée du tour.
 */
export function dossierDeLectureDuFil(
  projectPath: string | undefined | null,
  repli: string,
  dossierExiste: (chemin: string) => boolean = existsSync
): string {
  return dossierRangeUtilisable(projectPath, dossierExiste) ?? repli
}

/*
 * UNE COPIE PAR FIL D'AUTOWINOS. Tous les fils écrivaient dans le dépôt d'où tourne l'app de dev :
 * il fallait prouver, fichier par fichier, quel fil avait écrit quoi, et cette preuve échouait
 * souvent. Dans sa copie, tout ce qu'un fil écrit est à lui ; son travail entre dans main par la
 * porte de fin de tour (« Garder », fusion à trois voies depuis la base du fil).
 *
 * LE PASSAGE SE FAIT AU DÉBUT D'UN TOUR, jamais au milieu : un fil déjà commencé y passe à son tour
 * suivant, un fil neuf à son premier. Le dossier rangé DEVIENT la copie (le dossier rangé et le
 * dossier de travail ne diffèrent jamais). Le passage garde la session de l'agent : elle est
 * recopiée sous la copie au tour, et rapatriée sous le dossier d'avant au retour
 * (`session-du-tour.ts`, `suivreSessionEntreDossiers`).
 *
 * Seuls les fils du dépôt partagé (rangés dedans, ou sans dossier) sont concernés. Un fil rangé
 * ailleurs — un autre projet, la copie d'un essai, celle d'un retour à un tour — ne change pas.
 */

/** La copie qu'un fil a déjà reçue (voir `Conversation.copieDuFil`). */
export interface CopieDuFilNotee {
  chemin: string
  depot: string
  dossierAvant?: string
}

/** La copie notée sur un fil, si elle a une forme utilisable ; tout le reste vaut « aucune ». */
export function copieNotee(fil: { copieDuFil?: unknown } | undefined): CopieDuFilNotee | null {
  const copie = fil?.copieDuFil as Partial<CopieDuFilNotee> | undefined
  if (!copie || typeof copie.chemin !== 'string' || typeof copie.depot !== 'string') return null
  if (!isAbsolute(copie.chemin) || !isAbsolute(copie.depot)) return null
  return {
    chemin: copie.chemin,
    depot: copie.depot,
    ...(typeof copie.dossierAvant === 'string' ? { dossierAvant: copie.dossierAvant } : {})
  }
}

/**
 * Le fil travaille DANS SA copie : sa copie notée, ou `null`. Sert à tout ce qui doit voir, à
 * travers la copie, le projet dont elle est la copie (bascule par chemin cité, rangement au premier
 * message).
 */
export function copieOuTravailleLeFil(
  fil: { projectPath?: string; copieDuFil?: unknown } | undefined
): CopieDuFilNotee | null {
  const copie = copieNotee(fil)
  const range = fil?.projectPath?.trim()
  return copie && range && memeCheminSurDisque(range, copie.chemin) ? copie : null
}

/**
 * LE DOSSIER D'UN FIL OUVERT PAR UN AUTRE FIL (le lot d'un plan, ouvert par son chef). Un chef
 * dans SA copie y garde son travail à lui : un lot rangé dans cette même copie écrirait par-dessus,
 * sans copie à lui, car le passage du début de tour ne vise que les fils rangés dans le dépôt
 * partagé. Le lot va donc dans le dépôt dont la copie du chef est la copie, et y reçoit la sienne
 * à son premier tour. Un chef rangé ailleurs transmet son dossier tel quel.
 */
export function dossierDuFilOuvertPar(
  parent: { projectPath?: string; copieDuFil?: unknown } | undefined
): string | undefined {
  return copieOuTravailleLeFil(parent)?.depot ?? (parent?.projectPath?.trim() || undefined)
}

/**
 * LA COPIE DU FIL A DISPARU — retirée par le ménage des copies de fil (`menage-des-copies-de-fil.ts`)
 * pendant que le fil était archivé, ou effacée à la main. Le fil revient à son dossier d'avant AVANT
 * le refus « dossier rangé disparu » : sa copie n'était pas un dossier de l'utilisateur, et le passage
 * du début de tour lui en rouvre une neuve. Rend `true` quand il est revenu.
 */
export function revenirSiSaCopieADisparu(
  fil: { projectPath?: string; copieDuFil?: unknown } | undefined,
  revenir: () => void,
  dossierExiste: (chemin: string) => boolean = existsSync
): boolean {
  const copie = copieOuTravailleLeFil(fil)
  if (!copie || dossierExiste(resolve(copie.chemin))) return false
  revenir()
  return true
}

// copie d'avant déjà là : la primitive ne la voit pas (racine unique), la garde la refuse avant elle.
/**
 * LA COPIE NEUVE D'UN FIL, ouverte par la primitive sous la racine unique. Une copie d'avant
 * (`copies-de-fil/<fil>`) déjà là n'est jamais écrite par-dessus : la racine unique ne la voit pas, et elle peut
 * porter du travail. Les refus gardent les phrases que l'utilisateur voit.
 */
export async function ouvrirLaCopieDuFilPourLeTour(entree: {
  dossierDeDonnees: string
  depot: string
  conversationId: string
  /** Le lanceur git de la primitive ; les tests y mettent une panne ou une lenteur. */
  // sans lanceur injectable, un test ne peut pas simuler une panne de base ni une photo lente.
  runGit?: GitRunner
}): Promise<OuvertureDeCopie> {
  const copieDAvant = join(
    entree.dossierDeDonnees,
    DOSSIER_DES_COPIES_DE_FIL,
    entree.conversationId
  )
  if (existsSync(copieDAvant))
    return {
      ok: false,
      motif: 'dossier-occupe',
      raison: `Le dossier ${copieDAvant} existe déjà sans être la copie notée sur ce fil : rien n’a été écrit par-dessus.`
    }
  const ouverte = await ouvrirLaCopieDeTache({
    dossierDeDonnees: entree.dossierDeDonnees,
    depot: entree.depot,
    tache: entree.conversationId,
    sansDistant: true,
    runGit: entree.runGit
  }).catch((erreur: unknown): OuvertureDeCopie => ({
    ok: false,
    motif: 'echec',
    raison: erreur instanceof Error ? erreur.message : String(erreur)
  }))
  if (ouverte.ok) return ouverte
  return { ...ouverte, raison: annonceDuRefusDOuverture(ouverte, entree) }
}

/** Le refus de la primitive, dit dans les phrases d'avant pour les motifs que l'utilisateur voyait. */
function annonceDuRefusDOuverture(
  refus: { motif: string; raison: string },
  entree: { dossierDeDonnees: string; conversationId: string }
): string {
  const copie = dossierDeCopieDeTache(
    racineDesCopiesDeTaches(entree.dossierDeDonnees),
    entree.conversationId
  )
  // La phrase d'avant nomme le chemin de la copie : la primitive ne le fait pas pour la limite de longueur.
  if (refus.motif === 'chemin-trop-long' && copie && copie.length > LONGUEUR_MAX_CHEMIN_DE_COPIE)
    return `Le dossier de la copie ferait ${copie.length} caractères (${copie}) : git pour Windows en accepte ${LONGUEUR_MAX_CHEMIN_DE_COPIE} caractères au plus. Aucune copie n’a été ouverte.`
  if (refus.motif === 'dossier-occupe' && copie)
    return `Le dossier ${copie} existe déjà sans être la copie notée sur ce fil : rien n’a été écrit par-dessus.`
  if (refus.motif === 'identifiant-invalide')
    return `« ${entree.conversationId} » ne peut pas nommer un dossier de copie : aucune copie n’a été ouverte.`
  if (refus.motif === 'photo-impossible')
    return 'Impossible de photographier le code de ce fil : son dossier n’est pas un dépôt git, ou la photo n’a pas pu être prise à temps. Aucune copie n’a été ouverte.'
  return refus.raison
}

export type IssueDuPassage = 'rien' | 'ouverte' | 'reprise' | 'revenu' | 'refusee'

/**
 * LE DOSSIER DU FIL, DÉCIDÉ AU DÉBUT DE SON TOUR, avant que le dossier du tour soit lu.
 *  - réglage allumé, fil du dépôt partagé : il reprend sa copie si elle existe encore, sinon il en
 *    reçoit une (`ouvrirCopie`) ; une ouverture refusée le laisse où il était, raison dite ;
 *  - une question seule (`questionSeule`) n'ouvre pas de copie NEUVE : elle n'a rien à écrire, et la
 *    copie coûtait une annonce, un dossier sur le disque et la session du modèle. Le fil la reçoit à
 *    sa première demande d'action ; une copie déjà ouverte est reprise comme d'habitude ;
 *  - réglage éteint, fil dans sa copie : il revient à son dossier d'avant, la copie reste intacte ;
 *  - tout autre cas : rien ne change.
 * `depotPartage` : le dépôt d'Autowin d'où tourne l'app, ou `null` quand l'app travaille sur un autre
 * dépôt (le mécanisme ne vise que le sien). Chaque geste fait est annoncé en UNE ligne.
 */
export async function preparerLeDossierDuTour(entree: {
  fil: { projectPath?: string; copieDuFil?: unknown } | undefined
  depotPartage: string | null
  actif: boolean
  /** Le message du tour est une question sans action (`estUneQuestionSansAction`). */
  questionSeule?: boolean
  /** L'ouverture de la primitive (`ouvrirLaCopieDeTache`), câblée par `chat.ts` : son résultat exact, motif compris. */
  ouvrirCopie: () => Promise<OuvertureDeCopie>
  passer: (copie: { chemin: string; depot: string }) => void
  revenir: () => void
  annoncer: (ligne: string) => void
  dossierExiste?: (chemin: string) => boolean
}): Promise<IssueDuPassage> {
  const { fil, depotPartage } = entree
  if (!fil || !depotPartage) return 'rien'
  const existe = entree.dossierExiste ?? existsSync
  const dansSaCopie = copieOuTravailleLeFil(fil)
  if (!entree.actif) {
    if (!dansSaCopie) return 'rien'
    entree.revenir()
    entree.annoncer(
      `📂 La copie par fil est éteinte : ce fil revient au dossier partagé ${dansSaCopie.dossierAvant ?? depotPartage}. Sa copie reste intacte : ${dansSaCopie.chemin}.`
    )
    return 'revenu'
  }
  if (dansSaCopie) return 'rien'
  const range = fil.projectPath?.trim()
  if (range && !(isAbsolute(range) && memeCheminSurDisque(range, depotPartage))) return 'rien'
  const notee = copieNotee(fil)
  if (notee && memeCheminSurDisque(notee.depot, depotPartage) && existe(notee.chemin)) {
    entree.passer({ chemin: notee.chemin, depot: depotPartage })
    entree.annoncer(
      `📂 Ce fil reprend sa propre copie de ${basename(depotPartage)} (${notee.chemin}) : ses changements entrent dans ${basename(depotPartage)} à la fin de chaque tour.`
    )
    return 'reprise'
  }
  if (entree.questionSeule) return 'rien'
  const ouverte = await entree.ouvrirCopie()
  if (!ouverte.ok) {
    entree.annoncer(
      `⚠️ La copie de travail de ce fil n'a pas pu être ouverte : ${ouverte.raison} Ce tour travaille dans le dossier partagé ${depotPartage}.`
    )
    return 'refusee'
  }
  entree.passer({ chemin: ouverte.chemin, depot: depotPartage })
  // fix-ok: cause mesurée — l'ancienne annonce « repart de l'historique » ne tenait que parce que la clé
  // de session contenait le dossier de travail (session-du-tour.ts) : changer de dossier faisait oublier
  // la session. Mesuré sur le CLI Claude 2.1.319 : une session se reprend par son identifiant depuis un
  // autre dossier (réponse ANANAS-7, exit 0). La session suit donc le fil dans sa copie, au tour.
  entree.annoncer(
    `📂 Ce fil travaille maintenant dans sa propre copie de ${basename(depotPartage)} (${ouverte.chemin}) : ses changements entrent dans ${basename(depotPartage)} à la fin de chaque tour.`
  )
  return 'ouverte'
}

/**
 * LE RÉGLAGE « UNE COPIE PAR FIL ». Allumé par défaut : c'est le fonctionnement voulu. Seul un choix
 * écrit l'éteint ; un fichier absent ou illisible le laisse allumé. Relu au début de CHAQUE tour :
 * l'éteindre suffit à ce que les tours suivants reviennent au dossier partagé.
 */
export function lireReglageCopieParFil(fichier: string): boolean {
  try {
    if (!existsSync(fichier)) return true
    // Le BOM d'un fichier écrit à la main sous Windows ferait échouer `JSON.parse`.
    // fix-ok: cause mesurée — la 1re écriture posait le BOM en caractère brut dans l'expression
    // (eslint no-irregular-whitespace, ligne relue en octets EF BB BF) : comparé par son code ici.
    const lu = readFileSync(fichier, 'utf8')
    const brut = lu.charCodeAt(0) === 0xfeff ? lu.slice(1) : lu
    return (JSON.parse(brut) as { actif?: unknown } | null)?.actif !== false
  } catch {
    return true
  }
}

/** Écrit le réglage ; `false` si le disque ne le porte pas (l'appelant le dit, rien ne change). */
export function ecrireReglageCopieParFil(actif: boolean, fichier: string): boolean {
  try {
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(fichier, `${JSON.stringify({ actif }, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
