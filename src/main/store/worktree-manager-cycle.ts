// Acquisition, description et validation des copies : méthodes de WorktreeManager déplacées telles quelles depuis worktree-manager.ts
// (lot 3). Chacune reçoit l'instance en `this` ; elles sont rattachées au prototype
// par attacherMethodes dans worktree-manager.ts, donc les appels `this.x(...)` restent identiques.
import { causeGit } from './cause-git'
import { estCoquilleVide } from './coquilles-vides'
import { copiesVivantes, supprimerHistoriqueCli } from './historique-cli-copie'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { WorktreeConflictDiffResult } from '../../shared/worktree-activity-model'
import { parsePorcelainPaths } from '../runs/run-autoclose'
import { delierLesDependances, lierLesDependances, messageLiaison } from './dependances-copie-agent'
import type { WorktreeRecoveryContext, WorktreeRunContext } from './worktree-manager-types'
import {
  SAFE_ID,
  assertSafeId,
  canonicalPath,
  parseNullSeparatedPaths,
  ARGS_STATUT_DE_LA_BASE,
  argsDeRetraitDeCopie,
  DETAIL_POINT_DE_REPRISE_VIVANT,
  OptionsDeRetrait,
  RAISON_NON_NOMMEE,
  copieGardeeParUnPointDeReprise,
  tracerRetraitDeCopie,
  tracerRetraitDeCopieAsync
} from './worktree-manager-outils'
import { WorktreeManager } from './worktree-manager'

/**
 * LA REF QUE HEAD DESIGNE ET QUI N'EXISTE PLUS — sinon `undefined`.
 *
 * Quand la publication d'un bureau aboutit, sa branche de recuperation est SUPPRIMEE : cette
 * disparition EST le signal du succes. Le dossier, lui, peut survivre (un verrou de fichier
 * suffit sous Windows). Son HEAD designe alors une ref absente, et tout ce qui le relit ensuite
 * lit un bureau sans base : `git status` rend le depot ENTIER en nouveau.
 *
 * `symbolic-ref` continue de repondre quand `rev-parse HEAD` echoue — c'est ce qui permet de
 * distinguer « HEAD casse » d'un simple bureau vide.
 */
export function refManquanteDeHead(this: WorktreeManager, path: string): string | undefined {
  if (this.tryGitFn(path, ['rev-parse', '--verify', 'HEAD']).code === 0) return undefined
  const ref = this.tryGitFn(path, ['symbolic-ref', 'HEAD'])
  if (ref.code !== 0) return undefined
  const nom = ref.stdout.trim()
  return nom.length > 0 ? nom : undefined
}

/**
 * LE DERNIER COMMIT D'UN BUREAU DONT HEAD NE RESOUT PLUS, lu dans son propre reflog.
 *
 * C'est la SEULE preuve positive disponible pour decider si son travail est deja dans la base. On
 * ne se contente pas de l'absence de branche : une ref peut se perdre autrement, et « branche
 * disparue » ne prouve pas « travail publie ». Sans cette lecture, un correctif qui range les
 * bureaux publies rangerait aussi des bureaux irremplacables.
 *
 * Le fichier de reflog vit dans le repertoire git PROPRE au bureau, que son `.git` designe.
 */
export function shaDuReflog(this: WorktreeManager, path: string): string | undefined {
  try {
    const pointeur = readFileSync(join(path, '.git'), 'utf8').trim()
    const prefixe = 'gitdir:'
    if (!pointeur.startsWith(prefixe)) return undefined
    const gitdir = pointeur.slice(prefixe.length).trim()
    // Decoupage par le CODE du saut de ligne : un caractere de controle ecrit a la main dans un
    // patch a deja fige un defaut dans ce depot (voir `SAUT`, `ANTISLASH`). Le `trim` par ligne
    // absorbe le retour chariot de Windows.
    const lignes = readFileSync(join(gitdir, 'logs', 'HEAD'), 'utf8')
      .split(String.fromCharCode(10))
      .map((ligne) => ligne.trim())
      .filter((ligne) => ligne.length > 0)
    const derniere = lignes[lignes.length - 1]
    if (!derniere) return undefined
    const apres = derniere.split(' ')[1]
    return apres && /^[0-9a-f]{40}$/.test(apres) ? apres : undefined
  } catch {
    return undefined
  }
}

/** Le retrait ne part pas sans la note qui le rend reprenable : la copie est gardée telle quelle. */
const DETAIL_NOTE_REFUSEE = 'la note de retrait n’a pas pu être écrite : la copie est gardée'

/** git a rendu 0, mais le dossier reste sur le disque : la copie n'est pas partie. */
const DETAIL_DOSSIER_SURVIVANT = 'git a retiré la copie, mais son dossier reste sur le disque'

/**
 * LE PASSAGE COMMUN de tout retrait de copie : la garde du point de reprise s'applique ici, avant la
 * note et avant git, et la trace s'écrit ici, une fois le retrait réussi. Un retrait voulu qui ignore
 * la garde le déclare par `options.passeOutre` (son motif).
 */
export function cleanupWorktree(
  this: WorktreeManager,
  path: string,
  force = true,
  options: OptionsDeRetrait = {}
): { ok: boolean; detail?: string; traceManquante?: string } {
  // fix-ok: le retrait ne regardait pas le point de reprise : copie propre et inactive de 3 h retirée, reprise ensuite refusée « copie durable absente ».
  if (!options.passeOutre && copieGardeeParUnPointDeReprise(this.copiesProtegees, path)) {
    return { ok: false, detail: DETAIL_POINT_DE_REPRISE_VIVANT }
  }
  const voisines = this.preparerRetraitDeCopie(path)
  if (voisines === undefined) return { ok: false, detail: DETAIL_NOTE_REFUSEE }
  const remove = this.tryGitFn(this.baseRepo, argsDeRetraitDeCopie(path, force))
  const resultat = this.conclureRetraitDeCopie(
    path,
    force,
    remove,
    voisines,
    undefined,
    options.passeOutre
  )
  this.oublierSuppressionCommencee(path)
  if (!resultat.ok) return resultat
  const trace = tracerRetraitDeCopie(this.worktreeRoot, path, options.raison ?? RAISON_NON_NOMMEE)
  if (!trace) return resultat
  // fix-ok: seul le balayage notait la trace manquante ; un appelant direct (quarantaine, jet) la perdait.
  this.noterEchecDeBalayage(path, trace)
  return { ok: true, detail: `retrait fait ; ${trace}`, traceManquante: trace }
}

/**
 * LE MEME RETRAIT, SANS TENIR LA BOUCLE PENDANT `git worktree remove` — heal.
 *
 * Mesure du 2026-10-10 (`gels.jsonl`, 10:07) : le premier balayage horaire a retire trois copies
 * par la forme synchrone — 1 747, 1 444 et 4 253 ms de fenetre figee. Seul l'appel a git change
 * de forme : la preparation et la conclusion (coquille, historique CLI, escalade) sont PARTAGEES,
 * donc aucune protection du retrait ne peut diverger entre les deux chemins.
 *
 * heal : l'escalade disque (git en echec, `force`) changeait elle aussi de forme sans le
 * dire — elle restait synchrone. Elle est tentee ici en asynchrone, puis remise a la conclusion
 * partagee, qui ne la refait pas.
 */
export async function cleanupWorktreeAsync(
  this: WorktreeManager,
  path: string,
  force = true,
  options: OptionsDeRetrait = {}
): Promise<{ ok: boolean; detail?: string; traceManquante?: string }> {
  if (!options.passeOutre && copieGardeeParUnPointDeReprise(this.copiesProtegees, path)) {
    return { ok: false, detail: DETAIL_POINT_DE_REPRISE_VIVANT }
  }
  const voisines = this.preparerRetraitDeCopie(path)
  if (voisines === undefined) return { ok: false, detail: DETAIL_NOTE_REFUSEE }
  const remove = await this.tryGitAsyncFn(this.baseRepo, argsDeRetraitDeCopie(path, force))
  const detailDisque =
    remove.code !== 0 && force
      ? await this.tenterRetraitDisqueAsync(path, options.passeOutre)
      : undefined
  const resultat = this.conclureRetraitDeCopie(
    path,
    force,
    remove,
    voisines,
    detailDisque,
    options.passeOutre
  )
  this.oublierSuppressionCommencee(path)
  if (!resultat.ok) return resultat
  const trace = await tracerRetraitDeCopieAsync(
    this.worktreeRoot,
    path,
    options.raison ?? RAISON_NON_NOMMEE
  )
  if (!trace) return resultat
  // fix-ok: même cause que la forme synchrone : le blocage n'était noté que par le balayage.
  this.noterEchecDeBalayage(path, trace)
  return { ok: true, detail: `retrait fait ; ${trace}`, traceManquante: trace }
}

/**
 * `undefined` : la note de retrait n'a pas pu être écrite, et rien n'a été touché. Sans elle, un retrait
 * coupé ne serait reconnaissable nulle part.
 */
export function preparerRetraitDeCopie(this: WorktreeManager, path: string): string[] | undefined {
  // La note passe AVANT le lien git : c'est git qui le retire en premier, et un arrêt à ce moment-là
  // laisserait un dossier sans lien que personne ne reprendrait.
  if (!this.noterSuppressionCommencee(path)) return undefined
  /*
   * Les copies encore presentes sont relevees AVANT toute suppression : elles servent a proteger
   * leur propre historique CLI, et apres coup la copie visee aurait deja disparu de la liste.
   */
  const voisines = copiesVivantes(path)
  /*
   * On retire D'ABORD ce que NOUS avons ajouté : le lien vers les dépendances.
   *
   * Mesuré le 2026-08-25 : `git worktree remove --force` rend 0 mais ne touche pas au
   * `node_modules` qu'il ne suit pas. Le dossier de la copie SURVIT alors, ne contenant plus que
   * la jonction — et ce nettoyage, qui conclut `ok` dès que git a rendu 0, ne s'en aperçoit pas.
   * Chaque run laisserait une coquille orpheline, précisément ce qu'il doit empêcher.
   *
   * `delierLesDependances` refuse de toucher à un VRAI dossier de modules : seul un lien part.
   */
  delierLesDependances(path)
  return voisines
}

// fix-ok: cause mesurée — test rouge « git rend 0 mais le dossier garde des fichiers : pas de retrait conclu » (worktree-manager-copies.test.ts) : 1 échec avant correctif, `bilan.ok` valait true alors que le dossier et ses fichiers étaient là ; la conclusion ne regardait que le code de sortie de git.
export function conclureRetraitDeCopie(
  this: WorktreeManager,
  path: string,
  force: boolean,
  remove: { code: number; stdout: string; stderr: string },
  voisines: string[],
  /** Escalade disque DÉJÀ tentée par la forme asynchrone ; absente, elle est faite ici. */
  detailDisque?: string,
  /** Motif d'un retrait voulu : son repli disque suit la même garde que le passage commun. */
  passeOutre?: string
): { ok: boolean; detail?: string } {
  if (remove.code === 0) {
    /*
     * GIT A RENDU 0 — CA NE PROUVE PAS QUE LE DOSSIER EST PARTI.
     *
     * Mesure le 2026-08-25 : deux bureaux liberes par `git worktree remove --force` (code 0) ont
     * laisse leur dossier en place, zero fichier utile, un `.git` orphelin, ~1 Mo piece. Le
     * commentaire ci-dessus decrivait deja ce risque, mais ce `return` concluait `ok` sur le seul
     * code de sortie, sans jamais REGARDER. C'est tres probablement l'origine des douze coquilles
     * trouvees le meme jour dans ce depot.
     *
     * Et une coquille ne coute pas que du disque : un `git status` lance dedans ne repond pas
     * « vide », git remonte l'arborescence et rapporte l'etat du depot PARENT. Douze coquilles ont
     * ainsi paru porter du travail, et cette fausse lecture a ete propagee jusque dans un message
     * de commit avant d'etre rattrapee.
     *
     * On ne retire QUE ce dont l'absence de valeur est demontree : le dossier ne contient AUCUN
     * fichier hors `.git`. Un residu qui porte quoi que ce soit reste en place et fait echouer le
     * nettoyage, plutot que d'etre efface en silence.
     */
    if (existsSync(path) && estCoquilleVide(path)) {
      try {
        this.removeDirFn(path)
      } catch {
        /* Le disque refuse encore le retrait (verrou) : la coquille reste. La conclusion ci-dessous
           la rapporte alors comme un échec, au lieu de la conclure partie. */
      }
    }
    // fix-ok: cause mesurée — mutation de la garde `existsSync(path)` ci-dessous (retour ok:false retiré) : 3 tests rouges (git rend 0, coquille verrouillée, historique gardé) ; sans elle, une copie qui survit est conclue ok.
    /*
     * Un dossier qui survit n'est PAS une copie partie, qu'il porte des fichiers ou qu'il ne soit qu'une
     * coquille que le disque n'a pas pu retirer : la conclure `ok` la ferait oublier, et son historique CLI
     * partirait avec elle. La fiche de suppression posée avant le retrait fait reprendre ce dossier au
     * passage suivant.
     */
    if (existsSync(path)) return { ok: false, detail: DETAIL_DOSSIER_SURVIVANT }
    supprimerHistoriqueCli(path, voisines)
    return { ok: true }
  }
  if (!force) {
    return { ok: false, detail: causeGit(remove) || undefined }
  }

  // fix-ok: le repli disque ne recevait pas passeOutre ; la garde du point de reprise refusait le repli d'un retrait voulu.
  const filesystemDetail = detailDisque ?? this.tenterRetraitDisque(path, passeOutre)
  const prune = this.tryGitFn(this.baseRepo, ['worktree', 'prune'])
  if (!existsSync(path) && prune.code === 0) {
    supprimerHistoriqueCli(path, voisines)
    return { ok: true }
  }

  return {
    ok: false,
    detail: [causeGit(remove), filesystemDetail, causeGit(prune)].filter(Boolean).join('\n')
  }
}

/** Donne (ou réutilise) la copie isolée de l'agent. Idempotent. Ne touche pas le repo de base. */
export function acquire(
  this: WorktreeManager,
  agentId: string,
  context?: WorktreeRunContext
): string {
  const path = this.pathFor(agentId)
  if (existsSync(path)) {
    const ownershipIssue = this.ownershipIssue(path)
    if (ownershipIssue) throw new Error(ownershipIssue)
    // Un bureau périmé RAFRAÎCHI n'existe plus : on retombe volontairement sur la création
    // ci-dessous, qui le recrée sur la révision demandée.
    if (!this.rafraichirSiBasePerimee(agentId, path, context)) return path
  }
  if (
    context &&
    (canonicalPath(context.workspacePath) !== canonicalPath(this.baseRepo) ||
      canonicalPath(context.worktreePath) !== canonicalPath(path))
  ) {
    throw new Error('Contexte de bureau incohérent avec ce dépôt.')
  }
  if (
    context &&
    (!/^[0-9a-f]{40,64}$/i.test(context.baseSha) ||
      (context.sourceSha !== undefined && !/^[0-9a-f]{40,64}$/i.test(context.sourceSha)))
  ) {
    throw new Error('SHA de départ du bureau invalide.')
  }
  const startRevision = context?.sourceSha ?? context?.baseSha ?? this.currentBaseBranch()
  if (
    context &&
    this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${startRevision}^{commit}`]).code !== 0
  ) {
    throw new Error('La révision capturée du bureau n’est plus disponible.')
  }
  mkdirSync(this.worktreeRoot, { recursive: true })
  this.git(this.baseRepo, [
    '-c',
    'core.longpaths=true',
    'worktree',
    'add',
    '--detach',
    path,
    startRevision
  ])
  if (context && this.git(path, ['rev-parse', 'HEAD']) !== startRevision) {
    this.cleanupWorktree(path, true, {
      raison: 'copie créée non conforme',
      passeOutre: 'copie créée à l’instant : sa révision ne correspond pas'
    })
    throw new Error('La copie créée ne correspond pas à la révision capturée.')
  }
  /*
   * Les dépendances sont reliées AVANT que l'agent ne travaille, sinon il ne pourra rien prouver.
   *
   * Une copie agent est un `git worktree add` : elle ne porte que les fichiers suivis, et
   * `node_modules` est ignoré par git. Mesuré le 2026-08-25 dans une copie fraîche :
   * `npx vitest run` échoue sur « Cannot find module 'vitest/config' » — vitest ne charge même
   * pas sa configuration. Sans preuve exécutable, `etatDeCloture` rend `red` et le contrôle final
   * affiche « Échec déjà déclaré », sur un travail pourtant fait et prouvé.
   *
   * Le résultat n'est pas jeté : une copie sans dépendances reste utilisable pour lire et éditer.
   */
  this.derniereLiaisonDependances = lierLesDependances(this.baseRepo, path)
  return path
}

/**
 * UN BUREAU RETROUVÉ NE DOIT PAS RESTER SUR UNE BASE PÉRIMÉE.
 *
 * DÉFAUT MESURÉ (2026-08-29) : la clé de bureau d'`edit_file` est STABLE par tâche
 * (`cleDeBureau`). À la tentative suivante, ce point retrouvait le DOSSIER de la tentative
 * précédente et le rendait tel quel — sans jamais comparer sa tête à la révision demandée. Le
 * bureau restait accroché à une base vieille de plusieurs jours pendant que `read_file` lisait la
 * branche courante : `ChatView.css` montrait `16px` ligne 355 dans le dépôt et `13px` ligne 161
 * dans le bureau, MÊME après un commit propre de la base.
 *
 * LE CRITÈRE est l'ASCENDANCE, pas l'égalité : un bureau dont la tête est un commit posé par
 * l'agent AU-DESSUS de la révision demandée est légitime (c'est une reprise), et le recréer
 * détruirait ce travail. Seul un bureau qui NE DESCEND PAS de la révision demandée est périmé.
 *
 * Périmé ne veut pas dire jetable : on ne recrée que s'il n'y a RIEN à perdre (aucun fichier non
 * publié). Sinon on REFUSE en nommant la cause — un refus lisible vaut mieux que la publication
 * silencieuse d'une édition faite sur un contenu qui n'existe plus.
 */
export function rafraichirSiBasePerimee(
  this: WorktreeManager,
  agentId: string,
  path: string,
  context?: WorktreeRunContext
): boolean {
  const attendue = context?.sourceSha ?? context?.baseSha
  if (!attendue) return false
  if (this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${attendue}^{commit}`]).code !== 0) {
    return false
  }
  const tete = this.tryGitFn(path, ['rev-parse', 'HEAD'])
  if (tete.code !== 0) return false
  const descend =
    this.tryGitFn(path, ['merge-base', '--is-ancestor', attendue, tete.stdout.trim()]).code === 0
  if (descend) return false
  // UNE COPIE DE VERIFICATION NE PORTE QU'UN MIROIR (bulletin de maintenance, 2026-10-24) :
  // `verify` y recopie les fichiers non commites du depot (`synchroniserBureauDeVerification`).
  // Les compter comme du travail bloquait la copie a la premiere avancee de la base, et chaque
  // `verify` retombait sur le dossier partage (17 verdicts sur 37 le 23/10).
  const restes = WorktreeManager.COPIE_DE_VERIFICATION.test(agentId)
    ? []
    : this.unpublishedFiles(path)
  if (restes.length > 0) {
    throw new Error(
      `Bureau ${agentId} sur une base périmée : sa tête ne descend pas de ` +
        `${attendue.slice(0, 12)}, et il porte ${restes.length} fichier(s) non publié(s). ` +
        `Publiez ou rangez ce travail.`
    )
  }
  // La copie est propre (aucun fichier non publié, déjà vérifié plus haut) : recréée sur la base à jour.
  const nettoye = this.cleanupWorktree(path, true, {
    raison: 'base périmée : copie propre recréée',
    passeOutre: 'copie sans travail, recréée sur la base à jour par l’acquisition'
  })
  if (!nettoye.ok || existsSync(path)) {
    throw new Error(
      `Bureau ${agentId} sur une base périmée : impossible de le rafraîchir sur ` +
        `${attendue.slice(0, 12)}.`
    )
  }
  return true
}

/**
 * L'état des dépendances de la dernière copie créée, en une phrase destinée à la trace du run.
 *
 * `undefined` tant qu'aucune copie n'a été créée par cette instance : on ne rend pas une phrase
 * rassurante sur un geste qui n'a pas eu lieu.
 */
export function etatDesDependances(this: WorktreeManager): string | undefined {
  return this.derniereLiaisonDependances
    ? messageLiaison(this.derniereLiaisonDependances)
    : undefined
}

/** Contexte figé au début d'un run ; le coordinateur le persiste avant toute publication. */
export function describe(this: WorktreeManager, agentId: string): WorktreeRunContext {
  const baseBranch = this.currentBaseBranch()
  return {
    workspacePath: this.baseRepo,
    worktreePath: this.pathFor(agentId),
    baseBranch,
    // Résout la branche lue, pas HEAD : un changement de branche entre ces deux appels ne peut
    // plus produire une paire branche/SHA incohérente.
    baseSha: this.git(this.baseRepo, ['rev-parse', `refs/heads/${baseBranch}`])
  }
}

/**
 * Prépare le snapshot d'un NOUVEAU job : fetch distant sans toucher au workspace, puis choisit la
 * révision la plus fraîche tant que local et origin/main|master restent linéaires. Une divergence
 * ne bloque plus le lancement (décision user 14/08 : Autowin auto-gère, il ne bloque pas) : le job
 * part de la base de publication (origin) et les commits locaux non intégrés sont EXCLUS et
 * NOMMÉS dans le contexte — même philosophie que les fichiers sales, visible jamais silencieux.
 */
export function describeForLaunch(this: WorktreeManager, agentId: string): WorktreeRunContext {
  const local = this.describe(agentId)
  const remote = this.canonicalRemoteBase()
  let sourceSha = local.baseSha
  let excludedLocalCommits: string[] | undefined
  if (remote) {
    const localBeforeRemote =
      this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', local.baseSha, remote.sha])
        .code === 0
    const remoteBeforeLocal =
      this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', remote.sha, local.baseSha])
        .code === 0
    if (!localBeforeRemote && !remoteBeforeLocal) {
      sourceSha = remote.sha
      const listed = this.tryGitFn(this.baseRepo, [
        'rev-list',
        '--oneline',
        `${remote.sha}..${local.baseSha}`
      ])
      excludedLocalCommits =
        listed.code === 0 ? listed.stdout.split('\n').filter(Boolean) : undefined
    }
    if (localBeforeRemote) sourceSha = remote.sha
  }
  const excludedDirtyFiles = parsePorcelainPaths(
    this.git(this.baseRepo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  )
  const excludedDirtyFileLimit = 500
  return {
    ...local,
    sourceSha,
    ...(remote ? { canonicalBaseRef: remote.ref } : {}),
    excludedDirtyFiles: excludedDirtyFiles.slice(0, excludedDirtyFileLimit),
    excludedDirtyFileCount: excludedDirtyFiles.length,
    excludedDirtyFilesTruncated: excludedDirtyFiles.length > excludedDirtyFileLimit,
    ...(excludedLocalCommits
      ? {
          excludedLocalCommits: excludedLocalCommits.slice(0, 20),
          excludedLocalCommitCount: excludedLocalCommits.length
        }
      : {})
  }
}

/** Liste les fichiers modifiés (ajout/mod/suppr) dans la copie de l'agent. */
/**
 * Recoupe une autorisation durable avec l'état Git réel avant toute reprise automatique.
 * Un JSON valide ne suffit pas : la copie doit être celle de ce dépôt et ses révisions doivent
 * exister dans la branche capturée.
 */
export function validateRecoveryContext(
  this: WorktreeManager,
  agentId: string,
  context: WorktreeRecoveryContext
):
  | {
      ok: true
      decision?: 'resume-publication' | 'cleanup-only'
      publishedSha?: string
    }
  | {
      ok: false
      detail: string
      /*
       * VRAI quand le refus ne pourra JAMAIS reussir, quoi qu'on retente -- par opposition a un
       * refus transitoire (arbre occupe, base qui bouge) qui se repare tout seul.
       *
       * MESURE le 2026-08-24 sur l'app reelle : vingt-et-une copies occupaient le disque et
       * polluaient le Hub, toutes refusees pour ascendance rompue. Le systeme connaissait le
       * verdict et n'en faisait rien : il gardait la copie, et la RESTAURAIT meme au demarrage.
       *
       * Ce champ existe pour que l'appelant puisse AGIR sur le verdict sans avoir a reconnaitre
       * une phrase francaise dans `detail` -- ce qui serait une rustine, et casserait a la
       * premiere reformulation.
       */
      definitif?: true
    } {
  try {
    assertSafeId(agentId, 'agentId')
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
  const path = this.pathFor(agentId)
  if (canonicalPath(context.worktreePath) !== canonicalPath(path)) {
    return { ok: false, detail: 'Le contexte durable ne correspond pas à ce dépôt.' }
  }
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(context.baseSha)) {
    /*
     * DEFINITIF : une base absente ou illisible est une valeur STOCKEE, pas un aleas. Aucun
     * reessai ne la rendra valide. Depuis que la reconstruction cesse de FABRIQUER une base pour
     * un run sans fiche, ce refus est le chemin honnete de ces runs -- et le marquer definitif
     * fait ranger leur copie au lieu de la laisser occuper le disque indefiniment. Le travail,
     * lui, reste joignable sur `autowin/recovery/<id>`.
     */
    return { ok: false, detail: 'Le SHA de départ durable est invalide.', definitif: true }
  }
  const sourceSha = context.sourceSha ?? context.baseSha
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(sourceSha) || !this.revisionExists(sourceSha)) {
    return { ok: false, detail: 'Le SHA source durable est invalide ou indisponible.' }
  }
  const branchRef = `refs/heads/${context.baseBranch}`
  if (
    this.tryGitFn(this.baseRepo, ['check-ref-format', '--branch', context.baseBranch]).code !== 0 ||
    this.tryGitFn(this.baseRepo, ['show-ref', '--verify', '--quiet', branchRef]).code !== 0 ||
    !this.revisionExists(context.baseSha)
  ) {
    return { ok: false, detail: 'La branche ou le SHA durable n’existe plus dans ce dépôt.' }
  }
  if (
    this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', context.baseSha, branchRef])
      .code !== 0
  ) {
    return { ok: false, detail: 'Le SHA durable n’appartient plus à la branche capturée.' }
  }

  const publishedState =
    context.publication === 'published' || context.publication === 'cleanup-pending'
  const preparedAgentSha = context.agentSha ?? context.publishedSha
  const hasPreparedSha = Boolean(preparedAgentSha)
  const preparedShaIsValid =
    hasPreparedSha &&
    /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(preparedAgentSha!) &&
    this.revisionExists(preparedAgentSha!)
  const preparedShaIsPublished =
    preparedShaIsValid &&
    this.tryGitFn(this.baseRepo, [
      'merge-base',
      '--is-ancestor',
      context.publishedSha ?? preparedAgentSha!,
      branchRef
    ]).code === 0
  const publicationMarker = this.tryGitFn(this.baseRepo, [
    'rev-parse',
    '--verify',
    this.publicationMarkerRef(agentId)
  ])
  const markerSha = publicationMarker.code === 0 ? publicationMarker.stdout.trim() : undefined
  const markerIsValid =
    Boolean(markerSha) &&
    this.revisionExists(markerSha!) &&
    this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', context.baseSha, markerSha!])
      .code === 0 &&
    (!preparedAgentSha ||
      this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', preparedAgentSha, markerSha!])
        .code === 0)
  if (markerSha && !markerIsValid) {
    return { ok: false, detail: 'La transaction de publication durable est invalide.' }
  }
  const markerIsPublished =
    markerIsValid &&
    this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', markerSha!, branchRef]).code === 0
  if (!context.publishedSha && markerIsPublished) {
    return { ok: true, decision: 'cleanup-only', publishedSha: markerSha }
  }
  if (publishedState) {
    if (!preparedShaIsValid || !preparedShaIsPublished) {
      return {
        ok: false,
        detail: 'La publication durable ne peut pas être prouvée sur la branche capturée.'
      }
    }
    // `cleanupPublished` revérifie l'ownership juste avant toute mutation. Une copie devenue
    // étrangère ne doit pas effacer le fait déjà prouvé que la SHA est publiée.
    return { ok: true, decision: 'cleanup-only' }
  }
  if (hasPreparedSha && !preparedShaIsValid) {
    return { ok: false, detail: 'Le SHA préparé pour la publication est invalide.' }
  }
  if (preparedShaIsPublished) {
    if (!context.publishedSha) {
      const branchSha = this.tryGitFn(this.baseRepo, ['rev-parse', branchRef]).stdout.trim()
      if (branchSha !== preparedAgentSha) {
        return {
          ok: false,
          detail: 'La SHA exacte de la publication historique est indisponible.'
        }
      }
    }
    return {
      ok: true,
      decision: 'cleanup-only',
      publishedSha: context.publishedSha ?? preparedAgentSha
    }
  }

  if (!existsSync(path)) {
    return { ok: false, detail: 'La copie durable à reprendre n’existe plus.' }
  }
  const ownershipIssue = this.ownershipIssue(path)
  if (ownershipIssue) return { ok: false, detail: ownershipIssue }
  const head = this.tryGitFn(path, ['rev-parse', '--verify', 'HEAD'])
  if (
    head.code !== 0 ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(head.stdout.trim()) ||
    this.tryGitFn(path, ['merge-base', '--is-ancestor', sourceSha, head.stdout.trim()]).code !== 0
  ) {
    /*
     * DEFINITIF, et c'est le seul cas qu'on marque ainsi. Verifie a la main le 2026-08-24 sur
     * `agent__command-edit-04789dcc-...` : `git merge-base --is-ancestor <baseSha> <HEAD>` echoue
     * REELLEMENT -- la garde a raison, ce n'est pas un faux positif. Aucun reessai ne rendra la
     * copie descendante de sa base ; le travail, lui, reste joignable sur sa branche de secours.
     *
     * On reste CONSERVATEUR : les autres refus (propriete, copie absente, commit prepare qui a
     * bouge) ne sont PAS marques, parce qu'ils peuvent se reparer. Marquer trop large libererait
     * une copie encore publiable.
     */
    return {
      ok: false,
      detail: 'La copie ne descend pas du SHA de départ autorisé.',
      definitif: true
    }
  }
  if (preparedAgentSha && head.stdout.trim() !== preparedAgentSha) {
    return { ok: false, detail: 'La copie ne porte plus exactement le commit préparé.' }
  }
  if (preparedAgentSha) {
    const status = this.tryGitFn(path, ['status', '--porcelain=v1', '-z'])
    if (status.code !== 0 || status.stdout.trim()) {
      return { ok: false, detail: 'La copie préparée a changé avant la reprise.' }
    }
  }
  return { ok: true, decision: 'resume-publication' }
}

/**
 * PRÉ-VOL : fichiers non committés de la BASE, en LECTURE SEULE.
 *
 * `blockingDirtyFiles` répond à la même question mais à la FINALISATION, filtrée par les fichiers
 * que l'agent a touchés — impossible avant le run, où ces fichiers ne sont pas encore connus. Ce
 * pré-vol donne donc l'état brut de la base ; c'est l'appelant qui décide d'en faire un refus.
 *
 * Aucune écriture : un seul `git status`. Ni `stash`, ni `checkout`, ni ref. Une base illisible
 * rend une liste VIDE plutôt qu'une exception : un pré-vol en panne ne doit pas bloquer un run
 * qui, sans lui, serait parti (le refus de fin de course reste le filet).
 */
export function baseDirtyFiles(this: WorktreeManager): string[] {
  const status = this.tryGitFn(this.baseRepo, [...ARGS_STATUT_DE_LA_BASE])
  if (status.code !== 0) return []
  return parsePorcelainPaths(status.stdout)
}

/**
 * MÊME LECTURE, SANS TENIR LA BOUCLE — pour la vérification de fond des travaux en attente.
 *
 * Mesuré le 2026-10-21 à 20:14 (`gels.jsonl`) : UN `git status` synchrone de la base a figé la
 * fenêtre 60,1 s (`baseDirtyFiles`, appelé depuis `repecherLesTravauxEnAttente`, minuterie de
 * 5 min). Le travail n'a rien d'illégitime ; c'est sa forme synchrone qui gèle l'app.
 *
 * Contrat différent sur un point, à dessein : une base ILLISIBLE rend `undefined`, pas une liste
 * vide. « Rien de sale » et « je n'ai pas pu lire » ne mènent pas à la même décision : le premier
 * libère les travaux en attente, le second doit les laisser au plafond et au délai.
 */
export async function baseDirtyFilesAsync(this: WorktreeManager): Promise<string[] | undefined> {
  const status = await this.tryGitAsyncFn(this.baseRepo, [...ARGS_STATUT_DE_LA_BASE])
  if (status.code !== 0) return undefined
  return parsePorcelainPaths(status.stdout)
}

export function changedFiles(this: WorktreeManager, agentId: string): string[] {
  const path = this.pathFor(agentId)
  if (!existsSync(path)) return []
  /*
   * UN HEAD ILLISIBLE NE VEUT PAS DIRE « TOUT A CHANGE ».
   *
   * MESURE le 2026-08-25 : cinq bureaux dont la branche avait disparu se sont retrouves porteurs de
   * 1564 a 1572 fichiers « modifies » — le depot entier. `git status --untracked-files=all` sans
   * HEAD resoluble n'a aucune base de comparaison, donc il rend TOUT en nouveau. Ce lot fantome
   * repassait ensuite le bureau en attente de publication, et le repechage automatique le
   * reprenait trois fois.
   *
   * Rendre une liste VIDE est le seul verdict honnete : ce bureau n'a rien de publiable qu'on
   * puisse nommer. L'etat anormal, lui, n'est pas tu — `reconcileResidues` le NOMME.
   */
  if (this.refManquanteDeHead(path)) return []
  return [...new Set([...this.workingTreeFiles(path), ...this.preservedIgnoredFiles(path)])]
}

/**
 * TOUT CE QUE LA COPIE APPORTE A LA BASE : ses fichiers libres (`changedFiles`) ET ceux qu'elle a
 * deja commites au-dela de la base — le meme `HEAD...<copie>` que lit `finalizeSansSecours` pour
 * decider `base-dirty`.
 *
 * `changedFiles` ne lit que `git status`. Vecu le 2026-10-22 (run-bc699a65bae7-1) :
 * l'agent avait commite ses 35 fichiers DANS sa copie, `git status` y etait vide, et
 * l'orchestrateur, qui exige une copie vide pour accepter une livraison par Git externe, a declare
 * integre un run dont la fusion venait d'etre refusee. La cause `base-dirty` n'a jamais atteint le
 * RUN.md. `changedFiles` garde son sens (activite affichee, recensements) : cette mesure-ci sert
 * la question « la copie porte-t-elle du travail ? », et seulement elle.
 *
 * Une erreur git REMONTE (`this.git` leve) : l'appelant en deduirait sinon une copie vide.
 */
export function fichiersDuTravailDeLaCopie(this: WorktreeManager, agentId: string): string[] {
  const path = this.pathFor(agentId)
  if (!existsSync(path)) return []
  if (this.refManquanteDeHead(path)) return []
  const sha = this.git(path, ['rev-parse', 'HEAD'])
  const commites = parseNullSeparatedPaths(
    this.git(this.baseRepo, ['diff', '--name-only', '-z', `HEAD...${sha}`])
  )
  return [...new Set([...this.changedFiles(agentId), ...commites])]
}

/** Lit le diff figé d'un conflit sans accepter de cwd ou de révision venant du renderer. */
export function readConflictDiff(
  this: WorktreeManager,
  agentId: string,
  snapshot: { files: string[]; baseSha: string; agentSha: string }
): WorktreeConflictDiffResult {
  if (!SAFE_ID.test(agentId)) return { available: false, reason: 'invalid-agent' }
  const path = this.pathFor(agentId)
  if (!existsSync(path) || this.ownershipIssue(path)) {
    return { available: false, reason: 'ownership-unproven' }
  }
  const files = [...new Set(snapshot.files)]
  const validFiles =
    files.length > 0 &&
    files.every((file) => {
      if (!file || file.includes('\0') || isAbsolute(file) || file.split(/[\\/]/).includes('..'))
        return false
      const rel = relative(resolve(this.baseRepo), resolve(this.baseRepo, file))
      return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
    })
  if (!validFiles) return { available: false, reason: 'invalid-path' }
  for (const sha of [snapshot.baseSha, snapshot.agentSha]) {
    if (
      !/^[0-9a-f]{7,64}$/i.test(sha) ||
      this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${sha}^{commit}`]).code !== 0
    ) {
      return { available: false, reason: 'revision-unavailable' }
    }
  }
  const result = this.tryGitFn(this.baseRepo, [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    snapshot.baseSha,
    snapshot.agentSha,
    '--',
    ...files
  ])
  if (result.code !== 0) return { available: false, reason: 'read-failed' }
  return { available: true, agentId, paths: files, diff: result.stdout }
}
