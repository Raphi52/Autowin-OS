// Balayage des copies, processus actifs et retrait des copies : méthodes de WorktreeManager déplacées telles quelles depuis worktree-manager.ts
// (lot 3). Chacune reçoit l'instance en `this` ; elles sont rattachées au prototype
// par attacherMethodes dans worktree-manager.ts, donc les appels `this.x(...)` restent identiques.
import { causeGit } from './cause-git'
import { randomUUID } from 'node:crypto'
import { copiesVivantes, supprimerHistoriqueCli } from './historique-cli-copie'
import {
  type Dirent,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { delierLesDependances } from './dependances-copie-agent'
import { isSameProcessIdentity } from '../app/process-identity'
import { parsePorcelainPaths } from '../runs/run-autoclose'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { LIGNES, defaultProcessIdentity, empreinteConnue } from './worktree-manager-empreintes'
import type { FinalizeResult } from './worktree-manager-types'
import {
  SAFE_ID,
  assertSafeId,
  parseNullSeparatedPaths,
  SPAWN_INTENT_MAX_AGE_MS,
  ABANDONED_AGENT_MIN_AGE_MS,
  RESIDU_SANS_ENJEU_MIN_AGE_MS,
  DETAIL_POINT_DE_REPRISE_VIVANT,
  copieGardeeParUnPointDeReprise,
  estCopieDuDepot,
  tracerRetraitDeCopie,
  tracerRetraitDeCopieAsync,
  FETCH_ORIGIN_TIMEOUT_MS
} from './worktree-manager-outils'
import { WorktreeManager } from './worktree-manager'
import { raisonDeLErreur as message } from '../../shared/raison-de-l-erreur'
import {
  agentIdDeCopieHeritee,
  agentIdDeCopieNeuve,
  estUneCopieDAgent
} from '../copies/chemins-de-copies'

export function listAgentIds(this: WorktreeManager): string[] {
  const anciennes = existsSync(this.worktreeRoot)
    ? readdirSync(this.worktreeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('agent__'))
        .map((entry) => entry.name.slice('agent__'.length))
    : []
  // fix-ok: la racine unique porte les copies de fil et celles des autres dépôts : seules les copies d'agent de ce dépôt y sont listées.
  const commonDir = this.gitCommonDir(this.baseRepo)
  const racine = this.racineCopiesDeTaches
  const neuves = existsSync(racine)
    ? readdirSync(racine, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            estUneCopieDAgent(entry.name) &&
            estCopieDuDepot(join(racine, entry.name), commonDir)
        )
        .map((entry) => entry.name)
    : []
  const directories = [...anciennes, ...neuves].filter((agentId) => SAFE_ID.test(agentId))
  const recoveryRefs = this.git(this.baseRepo, [
    'for-each-ref',
    '--format=%(refname:strip=4)',
    'refs/heads/autowin/recovery/'
  ])
    .split('\n')
    .map((line) => line.trim())
    .filter((agentId) => SAFE_ID.test(agentId))
  return [...new Set([...directories, ...recoveryRefs])].sort()
}

/**
 * Converge les résidus créés par un crash au milieu d'une finalisation.
 * Les copies d'intégration ne sont jetables qu'après promotion durable d'une compensation éventuelle.
 * Une quarantaine est restaurée vers son bureau d'origine, sans jamais être publiée.
 */
/**
 * `reconcileResidues` en version non bloquante.
 *
 * Seul le balayage est rendu asynchrone, et c'est mesuré : sur 19,7 s de réconciliation, la boucle
 * des copies d'intégration pesait 0-1 ms et la quarantaine autant. Rendre le reste asynchrone
 * n'aurait rien acheté et aurait dupliqué du code pour rien.
 */
export async function reconcileResiduesAsync(
  this: WorktreeManager
): Promise<ReturnType<WorktreeManager['reconcileResidues']>> {
  const resultat = this.reconcileResidues({ balayer: false })
  const swept = await this.sweepAbandonedAgentCopiesAsync()
  if (swept.length > 0) resultat.swept = swept
  return resultat
}

/**
 * PRESERVE le travail d'une copie abandonnee dans sa branche de recuperation, puis LIBERE la copie.
 *
 * Le probleme mesure le 2026-08-14 sur l'installation de l'utilisateur : 49 copies pour 1 453 Mo,
 * alors que le travail unique qu'elles portent tient en 665 Ko de diff — deux megaoctets de copie
 * par kilooctet utile, et 16 copies sans la moindre modification. Elles survivent parce qu'un run
 * mort sans passer par `finalize` (app fermee, plantage, annulation) ne libere jamais sa copie, et
 * que le balayage refuse — a juste titre — de supprimer un travail qui n'existe nulle part ailleurs.
 *
 * Le mecanisme de sauvetage existait deja pour le travail COMMITTE : `cleanupAgentWorktree` attache
 * HEAD a `autowin/recovery/<agentId>` avant de supprimer, donc le commit survit comme reference.
 * Ce qui manquait, c'est le travail NON COMMITTE — precisement celui qui bloquait tout.
 *
 * On le committe donc sur cette meme branche avant de liberer. Rien n'est perdu : la branche se
 * restaure par `git worktree add <chemin> autowin/recovery/<agentId>`, et le commit satisfait
 * naturellement le critere de surete du balayage (« contenu dans une reference »). Rien n'est
 * publie non plus : cette branche n'est ni `main` ni une branche de travail.
 */
export function preserverEtLiberer(this: WorktreeManager, agentId: string): IssueDePreservation {
  assertSafeId(agentId, 'agentId')
  const path = this.pathFor(agentId)
  const garde = gardesDePreservation.call(this, agentId, path)
  if (garde) return garde
  const ownership = this.ownershipIssue(path)
  if (ownership) return { outcome: 'refuse', detail: ownership }
  return preserverPuisLiberer.call(this, agentId, path)
}

/**
 * `preserverEtLiberer` du balayage horaire : le controle d'appartenance, refait JUSTE AVANT
 * `switch -C` et `add -A`, est attendu sans tenir la boucle. Sa forme synchrone figeait la fenetre le
 * temps d'une sonde git (~400 ms simulees, `balayage-disque-async.test.ts`) pour chaque copie de
 * plus de 24 h qui portait du travail non publie.
 */
export async function preserverEtLibererAsync(
  this: WorktreeManager,
  agentId: string
): Promise<IssueDePreservation> {
  assertSafeId(agentId, 'agentId')
  const path = this.pathFor(agentId)
  const garde = gardesDePreservation.call(this, agentId, path)
  if (garde) return garde
  // fix-ok: test de battement rouge a 418 ms — `preserverEtLiberer` appelait `ownershipIssue`
  // (sonde `tryGitFn`, donc `execFileSync`) depuis le balayage horaire asynchrone.
  const ownership = await this.ownershipIssueAsync(path)
  if (ownership) return { outcome: 'refuse', detail: ownership }
  // L'attente laisse la boucle libre : la copie a pu disparaitre ou etre reprise par un run.
  const gardeApresAttente = gardesDePreservation.call(this, agentId, path)
  if (gardeApresAttente) return gardeApresAttente
  return preserverPuisLiberer.call(this, agentId, path)
}

type IssueDePreservation = {
  outcome: 'libere' | 'preserve-et-libere' | 'refuse' | 'absente'
  branche?: string
  detail?: string
}

/** Les gardes sans git de la preservation, partagees par la forme sync et async. */
function gardesDePreservation(
  this: WorktreeManager,
  agentId: string,
  path: string
): IssueDePreservation | undefined {
  if (!existsSync(path)) return { outcome: 'absente' }
  // Un run qui tourne encore garde sa copie : la liberer sous ses pieds casserait le run vivant.
  if (this.hasActiveProcesses(agentId)) {
    return { outcome: 'refuse', detail: 'des processus utilisent encore cette copie' }
  }
  return undefined
}

/** Les ecritures de la preservation, une fois l'appartenance prouvee — partagees sync/async. */
function preserverPuisLiberer(
  this: WorktreeManager,
  agentId: string,
  path: string
): IssueDePreservation {
  const branche = `autowin/recovery/${agentId}`
  const aDuTravail = this.unpublishedFiles(path).length > 0
  if (aDuTravail) {
    /*
     * `switch -C` DEPLACE la branche : meme ecrasement que `branch -f`, meme perte.
     *
     * L'identite d'un bureau etant stable par tache, cette adresse peut deja porter le travail
     * d'une tentative precedente. On la gare avant de la deplacer, sur la meme regle que
     * `ancrerAvantSuppression` : on n'ecrase que ce qui ne perd rien.
     */
    const teteAvant = this.tryGitFn(path, ['rev-parse', 'HEAD'])
    if (teteAvant.code === 0) this.mettreAlAbriSiDivergente(branche, teteAvant.stdout.trim())
    // `switch -C` : on se place sur la branche de recuperation SANS toucher aux fichiers, puis on
    // committe, crochet compris : un nom d'entreprise y fait refuser le commit. Un echec ici interrompt tout — mieux vaut garder la copie que perdre le travail.
    if (this.tryGitFn(path, ['switch', '-C', branche]).code !== 0) {
      return { outcome: 'refuse', detail: 'la branche de récupération n’a pas pu être créée' }
    }
    if (this.tryGitFn(path, ['add', '-A']).code !== 0) {
      return { outcome: 'refuse', detail: 'le travail n’a pas pu être indexé' }
    }
    const commit = this.tryGitFn(path, [
      'commit',
      '-m',
      `autowin: travail préservé de la copie ${agentId}`
    ])
    if (commit.code !== 0 && this.unpublishedFiles(path).length > 0) {
      return { outcome: 'refuse', detail: 'le travail n’a pas pu être préservé' }
    }
  }
  /*
   * LE TRAVAIL DEJA COMMITTE, l'angle mort de `aDuTravail`.
   *
   * `unpublishedFiles()` ne compte que le NON committe. Un bureau dont l'agent a deja committe son
   * travail en HEAD detache rend donc zero, se lit « rien a preserver », et son commit partait avec
   * le dossier. C'est la signature exacte des trois bureaux perdus le 2026-08-26.
   */
  if (!aDuTravail) this.ancrerAvantSuppression(agentId, path)
  if (!this.balayerLeChemin(path)) {
    return { outcome: 'refuse', detail: 'la copie n’a pas pu être supprimée' }
  }
  return aDuTravail ? { outcome: 'preserve-et-libere', branche } : { outcome: 'libere' }
}

export function reconcileResidues(
  this: WorktreeManager,
  options?: { balayer?: boolean }
): {
  cleaned: number
  recovered: string[]
  blocked: Array<{ path: string; detail: string }>
  swept?: string[]
} {
  const result: {
    cleaned: number
    recovered: string[]
    blocked: Array<{ path: string; detail: string }>
    swept?: string[]
  } = { cleaned: 0, recovered: [], blocked: [] }
  if (!existsSync(this.worktreeRoot)) return result

  for (const entry of readdirSync(this.worktreeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^integration__[A-Za-z0-9_-]+__/.test(entry.name)) continue
    const path = join(this.worktreeRoot, entry.name)
    const ownershipIssue = this.ownershipIssue(path)
    if (ownershipIssue) {
      result.blocked.push({ path, detail: ownershipIssue })
      continue
    }
    const promotion = this.promoteCompensationResidue(path)
    if (!promotion.ok) {
      result.blocked.push({
        path,
        detail: promotion.detail ?? 'La compensation du hook n’a pas pu être rendue durable.'
      })
      continue
    }
    const cleanup = this.cleanupWorktree(path, true, { raison: 'copie d’intégration orpheline' })
    if (cleanup.ok) result.cleaned += 1
    else {
      result.blocked.push({
        path,
        detail: cleanup.detail ?? 'La copie d’intégration orpheline n’a pas pu être nettoyée.'
      })
    }
  }

  // `balayer: false` est utilisé par la variante asynchrone, qui fait ce balayage en rendant la main.
  const swept = options?.balayer === false ? [] : this.sweepAbandonedAgentCopies()
  if (swept.length > 0) result.swept = swept

  // Un residu qui RESISTE au balayage doit remonter dans l'etat : sans cela il reste invisible et
  // revient a chaque demarrage (mesure : 10 copies, ~413 Mo, jamais signalees).
  for (const blocage of this.blocagesDeBalayage()) {
    if (result.blocked.some((b) => resolve(b.path) === resolve(blocage.path))) continue
    result.blocked.push({
      path: blocage.path,
      detail: `Balayage impossible (${blocage.echecs} echec(s)) : ${blocage.detail}`
    })
  }

  const quarantineRoot = join(this.worktreeRoot, '.quarantine')
  if (!existsSync(quarantineRoot)) return result
  for (const entry of readdirSync(quarantineRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const match = entry.name.match(/^([A-Za-z0-9_-]+)__/)
    if (!match) {
      result.blocked.push({
        path: join(quarantineRoot, entry.name),
        detail: 'Nom de quarantaine non reconnu : copie conservée.'
      })
      continue
    }
    const agentId = match[1]
    const quarantinedPath = join(quarantineRoot, entry.name)
    const originalPath = this.pathFor(agentId)
    if (existsSync(originalPath)) {
      result.blocked.push({
        path: quarantinedPath,
        detail: `Le bureau ${agentId} existe déjà : quarantaine conservée.`
      })
      continue
    }

    this.tryGitFn(this.baseRepo, ['worktree', 'repair', quarantinedPath])
    /*
     * UN BUREAU PUBLIE NE REDEVIENT PAS UN BUREAU EN ATTENTE.
     *
     * DEFAUT MESURE le 2026-08-25 sur cinq bureaux. La publication qui aboutit SUPPRIME la branche
     * de recuperation du bureau : cette disparition est son signal de succes. Mais le dossier de
     * quarantaine peut survivre au nettoyage (un verrou de fichier suffit) et ce balayage le
     * remettait alors en place comme un bureau ACTIF, sans jamais demander si sa branche existait
     * encore. Son HEAD ne resolvait plus, donc `git status` rendait le depot ENTIER en nouveau
     * (1564 a 1572 fichiers dans les manifestes), le bureau repassait « en attente de
     * publication », et le repechage automatique le reprenait trois fois en restaurant une copie a
     * chaque passage — la famille des « 682 Mo de copies recreees » du 2026-08-24.
     *
     * CE QUI EST DECIDE ICI, et la nuance est tout le sujet : une branche disparue ne PROUVE PAS
     * qu'un travail est publie (une ref peut se perdre autrement). On exige donc une preuve
     * POSITIVE — le dernier commit du bureau, lu dans son propre reflog, doit se retrouver dans la
     * base. Sans cette preuve, le bureau est CONSERVE et son motif est nomme : ce mecanisme existe
     * pour ne rien perdre, et « ne pas restaurer » ne doit jamais glisser vers « supprimer ».
     */
    const refManquante = this.refManquanteDeHead(quarantinedPath)
    if (refManquante) {
      const sha = this.shaDuReflog(quarantinedPath)
      const publie =
        sha !== undefined &&
        this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', sha, 'HEAD']).code === 0
      if (!publie) {
        result.blocked.push({
          path: quarantinedPath,
          detail: `Bureau conservé : ${refManquante} a disparu et son travail n’est pas prouvé publié.`
        })
        continue
      }
      const menage = this.cleanupWorktree(quarantinedPath, true, { raison: 'quarantaine' })
      if (menage.ok) result.cleaned += 1
      else {
        result.blocked.push({
          path: quarantinedPath,
          detail:
            menage.detail ??
            'Bureau publié, mais sa copie de quarantaine n’a pas pu être supprimée.'
        })
      }
      continue
    }
    const ownershipIssue = this.ownershipIssue(quarantinedPath)
    if (ownershipIssue) {
      result.blocked.push({ path: quarantinedPath, detail: ownershipIssue })
      continue
    }
    try {
      renameSync(quarantinedPath, originalPath)
    } catch (error) {
      result.blocked.push({
        path: quarantinedPath,
        detail: error instanceof Error ? error.message : String(error)
      })
      continue
    }
    const repair = this.tryGitFn(this.baseRepo, ['worktree', 'repair', originalPath])
    if (repair.code === 0) {
      result.recovered.push(agentId)
      continue
    }
    try {
      renameSync(originalPath, quarantinedPath)
      this.tryGitFn(this.baseRepo, ['worktree', 'repair', quarantinedPath])
    } catch {
      // Les deux chemins sont inventoriés juste après ; aucune suppression n'est tentée.
    }
    result.blocked.push({
      path: existsSync(originalPath) ? originalPath : quarantinedPath,
      detail: causeGit(repair) || 'Réparation Git impossible.'
    })
  }
  return result
}

/**
 * Supprime les copies d'agent des deux racines dont le run s'est terminé SANS publication (échec, abandon,
 * crash) : la finalisation ne range que le chemin `merged`, donc sans ce balayage chaque run
 * stérile laisse un worktree définitif (811 mesurés le 2026-08-05 sur ce dépôt).
 *
 * Une copie n'est supprimée QUE si elle ne peut rien faire perdre — les quatre conditions sont
 * cumulatives et chacune est vérifiée sur l'état Git réel, jamais sur un registre applicatif :
 *   1. aucun processus vivant ne la détient (lease PID + intention de spawn) ;
 *   2. son arborescence de travail est vide (fichiers suivis ET ignorés préservés) ;
 *   3. son HEAD est déjà contenu dans une référence — un commit propre à la copie la conserve ;
 *   4. elle est plus vieille que la fenêtre de spawn.
 * Le moindre doute conserve la copie : ce balayage ne remonte aucun blocage.
 */
/**
 * Le balayage d'UNE copie abandonnée. Rend l'identifiant balayé, ou `undefined`.
 *
 * Extrait de la boucle pour qu'un appelant puisse rendre la main entre deux copies — voir
 * {@link sweepAbandonedAgentCopiesAsync}. MESURÉ sur 52 copies : 19,5 s de travail synchrone qui
 * balayait 0 copie, soit ~375 ms par copie en sous-processus git.
 *
 * L'ORDRE des gardes est délibéré : du moins cher au plus cher. Mesuré par garde, par copie :
 * âge ~0,1 ms · processus actifs ~0,1 ms · appartenance ~167 ms · fichiers non publiés ~292 ms.
 * L'âge était évalué APRÈS l'appartenance, donc 10 copies trop jeunes payaient deux `git` pour rien.
 * Toutes ces gardes sont des prédicats en lecture seule : les réordonner ne change aucun verdict,
 * seulement le nombre d'appels évités.
 */
export function balayerUneCopie(this: WorktreeManager, copie: CopieAgentLue): string | undefined {
  const decision = this.deciderBalayageDUneCopie(copie)
  if (decision?.etape !== 'retirer') return decision?.agentId
  return this.balayerLeChemin(decision.path) ? decision.agentId : undefined
}

/** `balayerUneCopie` du balayage horaire : memes verdicts, retrait git sans tenir la boucle. */
export async function balayerUneCopieAsync(
  this: WorktreeManager,
  copie: CopieAgentLue
): Promise<string | undefined> {
  const decision = await this.deciderBalayageDUneCopieAsync(copie)
  if (decision?.etape !== 'retirer') return decision?.agentId
  return (await this.balayerLeCheminAsync(decision.path)) ? decision.agentId : undefined
}

type DecisionDeBalayage =
  | { etape: 'fait'; agentId: string }
  | { etape: 'retirer'; agentId: string; path: string }
  | undefined

/**
 * TOUTES les gardes du balayage, sans le retrait final — partagees par la forme sync et async.
 * `fait` : la copie est deja traitee (preservee puis liberee) ; `retirer` : il ne reste qu'a la
 * supprimer ; `undefined` : on n'y touche pas.
 */
export function deciderBalayageDUneCopie(
  this: WorktreeManager,
  copie: CopieAgentLue
): DecisionDeBalayage {
  const candidate = copieAgeeEtInactive.call(this, copie)
  if (!candidate || this.ownershipIssue(candidate.path)) return undefined
  const decision = deciderApresAppartenance.call(this, candidate)
  if (decision?.etape !== 'preserver') return decision
  return conclurePreservation.call(
    this,
    decision.agentId,
    candidate.path,
    this.preserverEtLiberer(decision.agentId)
  )
}

/**
 * La meme decision pour le balayage horaire : le controle d'appartenance (deux sondes git) est
 * attendu sans tenir la boucle. Mesure du 2026-11-06 (`gels.jsonl`) : sa forme synchrone figeait la
 * fenetre 4,5 a 4,9 s a chaque passe horaire.
 */
export async function deciderBalayageDUneCopieAsync(
  this: WorktreeManager,
  copie: CopieAgentLue
): Promise<DecisionDeBalayage> {
  const candidate = copieAgeeEtInactive.call(this, copie)
  if (!candidate || (await this.ownershipIssueAsync(candidate.path))) return undefined
  // L'attente laisse la boucle libre, donc un run peut reprendre la copie pendant ce temps : les baux
  // sont relus avant toute preservation ou suppression, comme la forme synchrone les lisait d'un trait.
  if (this.hasActiveProcesses(candidate.agentId)) return undefined
  const decision = deciderApresAppartenance.call(this, candidate)
  if (decision?.etape !== 'preserver') return decision
  return conclurePreservation.call(
    this,
    decision.agentId,
    candidate.path,
    await this.preserverEtLibererAsync(decision.agentId)
  )
}

/**
 * Une copie preservee puis liberee est traitee ; tout autre issue la laisse en place. Un refus est
 * note au registre des blocages : sans cela, le balayage horaire reessaie la copie sans laisser de trace.
 */
// fix-ok: src/main/store/worktree-manager-copies.ts — cause mesurée : `conclurePreservation` rendait `undefined` sans noter le refus de préservation, le balayage horaire retentait la copie en silence.
function conclurePreservation(
  this: WorktreeManager,
  agentId: string,
  path: string,
  issue: IssueDePreservation
): DecisionDeBalayage {
  if (issue.outcome === 'preserve-et-libere' || issue.outcome === 'libere')
    return { etape: 'fait', agentId }
  if (issue.outcome === 'refuse')
    this.noterEchecDeBalayage(path, issue.detail ?? 'la préservation de la copie a été refusée')
  return undefined
}

type CopieCandidate = { agentId: string; path: string; ageMs: number }

/** Une copie d'agent posée sur disque : son identifiant, son dossier, et l'entrée qui la décrit. */
export interface CopieAgentLue {
  agentId: string
  path: string
  entry: Dirent
}

/** Les gardes sans git, les moins cheres : forme du dossier, age, processus actifs. */
function copieAgeeEtInactive(
  this: WorktreeManager,
  copie: CopieAgentLue
): CopieCandidate | undefined {
  const { agentId, path } = copie
  if (!copie.entry.isDirectory()) return undefined
  if (!SAFE_ID.test(agentId)) return undefined
  // Le point de reprise d'un run encore reprenable vaut copie : la retirer rend sa reprise impossible,
  // quelle que soit son âge et son état. Garde sur le point de reprise, pas sur l'âge.
  // fix-ok: le balayage doit lire le point de reprise vivant avant de retirer une copie propre et inactive
  if (this.copiesProtegees.has(agentId)) return undefined

  let ageMs: number
  try {
    ageMs = this.now() - statSync(path).mtimeMs
  } catch {
    return undefined
  }
  // Plancher commun : en dessous, aucune copie n'est regardee, quel que soit son etat.
  if (!(ageMs >= RESIDU_SANS_ENJEU_MIN_AGE_MS)) return undefined

  if (this.hasActiveProcesses(agentId)) return undefined
  return { agentId, path, ageMs }
}

/**
 * Les gardes qui suivent l'appartenance prouvee : travail non publie, HEAD, reference.
 * `preserver` : la copie retient du travail, chaque forme appelle SA preservation (sync ou async).
 */
function deciderApresAppartenance(
  this: WorktreeManager,
  { agentId, path, ageMs }: CopieCandidate
): DecisionDeBalayage | { etape: 'preserver'; agentId: string } {
  /**
   * Du travail non publie ne bloque plus le balayage : il est PRESERVE, puis la copie est liberee.
   *
   * C'est ici que se jouaient les 1 453 Mo mesures le 2026-08-14 pour 665 Ko de travail unique.
   * L'ancienne regle — « une copie qui porte du travail ne se touche pas » — etait juste sur le
   * fond et sans issue sur la forme : un run mort sans passer par `finalize` laissait sa copie pour
   * toujours, puisque rien ne viendrait jamais publier ce travail.
   *
   * `preserverEtLiberer` le committe sur `autowin/recovery/<agentId>` avant de supprimer : le
   * travail devient une REFERENCE du depot, restaurable par `git worktree add`, et cesse d'occuper
   * 30 Mo. La garantie « on ne detruit jamais un travail qui n'existe nulle part ailleurs » est
   * donc tenue plus fort qu'avant — avant, ce travail n'etait sauvegarde nulle part.
   */
  /*
   * L'ORDRE des gardes reste du moins cher au plus cher, mais l'age ne tranche plus seul : il faut
   * savoir si la copie retient quelque chose AVANT de choisir le seuil qui s'applique. Une copie
   * agee de 3 a 24 h paie donc desormais `ownershipIssue` (~167 ms) et `unpublishedFiles`
   * (~292 ms) la ou elle sortait en ~0,1 ms. C'est un cout assume : ce balayage est opportuniste,
   * rien n'attend son resultat, et la variante async rend la main entre chaque copie.
   */
  if (this.unpublishedFiles(path).length > 0) {
    // Elle retient du travail : la marge LARGE d'origine s'applique, inchangee.
    if (!(ageMs >= ABANDONED_AGENT_MIN_AGE_MS)) return undefined
    /*
     * SAUF LA COPIE DE `verify` : ses fichiers sales sont un MIROIR du depot, recopie a chaque
     * verification (`synchroniserBureauDeVerification`). La preserver ne mettrait de cote qu'un
     * miroir, sans aucune modification neuve. Elle suit donc la garde du HEAD ci-dessous : un commit
     * qu'aucune reference ne tient reste rattache.
     * La marge de 24 h, elle, demeure : `verify` ne pose aucun lease, l'age seul protege un test
     * en cours.
     */
    if (!WorktreeManager.COPIE_DE_VERIFICATION.test(agentId)) return { etape: 'preserver', agentId }
  }

  const head = this.tryGitFn(path, ['rev-parse', 'HEAD'])
  if (head.code !== 0) return undefined
  const sha = head.stdout.trim()
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) return undefined
  const reference = this.commitDejaReference(sha)
  if (reference === undefined) return undefined
  if (!reference) {
    /**
     * Commit atteignable par AUCUNE reference : on le RATTACHE avant de liberer.
     *
     * MESURE le 2026-08-14, apres que la preservation du travail non committe ait rendu 971 Mo
     * (49 copies -> 18) : les 18 restantes sont 10 copies protegees par l'age (runs de moins de
     * 24 h) et 8 qui sont TOUTES ce cas — `refs=0`, `sales=0`, 185 a 213 h d'age, 216 Mo. Le refus
     * d'y toucher etait juste (supprimer la copie perdrait un commit que rien ne retient) mais sans
     * issue : rien ne viendrait jamais rattacher le commit d'un run mort.
     *
     * Aucun commit n'est CREE ici — on ne fait que rendre atteignable celui qui existe deja. Un
     * echec de creation interrompt tout : perdre un commit unique pour gagner 30 Mo serait le pire
     * echange possible.
     */
    // Rattacher un commit, c'est AGIR : le chemin accelere se limite a « rien a faire sauf
    // supprimer ». Une copie de 3 a 24 h dont le HEAD n'est reference nulle part garde donc la
    // marge large — creer une branche pour le compte d'un run peut-etre encore vivant serait un
    // effet de bord, pas un ramassage.
    if (!(ageMs >= ABANDONED_AGENT_MIN_AGE_MS)) return undefined
    const branche = `autowin/recovery/${agentId}`
    if (this.tryGitFn(this.baseRepo, ['branch', '--force', branche, sha]).code !== 0) {
      return undefined
    }
  }

  return { etape: 'retirer', agentId, path }
}

/**
 * Supprime une copie ABANDONNEE, qu'elle soit encore enregistree par git ou non.
 *
 * MESURE le 2026-08-14 sur l'installation de l'utilisateur : 57 dossiers de copies pour 3,6 Go,
 * dont 22 que git ne connaissait PLUS (`git worktree remove` repondait « is not a working tree »).
 * Le balayage passant uniquement par cette commande, ces 1,3 Go etaient invisibles aux deux
 * mecanismes — ni git ni Autowin ne pouvaient les enlever — et s'accumulaient a chaque usage.
 *
 * L'appelant a DEJA verifie tout ce qui protege du travail : age, absence de processus actif,
 * propriete, aucun fichier non publie, et commit contenu dans une reference du depot. Ce qui reste
 * ici n'est donc qu'une question de MOYEN de suppression, pas de securite.
 */
export function balayerLeChemin(this: WorktreeManager, path: string): boolean {
  // Sans note écrite, rien ne part : l'escalade disque ci-dessous ne doit jamais couper un retrait non noté.
  // fix-ok: le balayage horaire retirait la copie propre et inactive de 3 h d'un run dont le point de reprise vivait ; la reprise était ensuite refusée « copie durable absente ».
  if (!this.noterSuppressionCommencee(path)) return false
  const retraitDoux = this.cleanupWorktree(path, false, { raison: RAISON_BALAYAGE })
  if (retraitDoux.ok) return conclureBalayageReussi(this, path, retraitDoux.traceManquante)

  /*
   * ESCALADE plutot qu'abandon silencieux.
   *
   * MESURE : 10 copies residuelles (~413 Mo) survivaient a chaque demarrage. Le retrait
   * DOUX (`worktree remove` sans `--force`) refuse des qu'un fichier non suivi traine — cas
   * NORMAL d'une copie d'agent. L'ancien code rendait alors `false` sans rien tenter d'autre et
   * sans laisser la moindre trace : le residu revenait indefiniment, invisible.
   *
   * Les protections du travail sont deja passees (age, processus actif, propriete, fichiers non
   * publies, commit reference) : ce qui reste n'est qu'une question de MOYEN de suppression.
   */
  if (this.estWorktreeEnregistree(path)) {
    const retraitForce = this.cleanupWorktree(path, true, { raison: RAISON_BALAYAGE })
    if (retraitForce.ok) return conclureBalayageReussi(this, path, retraitForce.traceManquante)
  }
  return this.finirBalayageParLeDisque(path, undefined, RAISON_BALAYAGE)
}

/**
 * `balayerLeChemin` dont les retraits ne tiennent pas la boucle (balayage horaire) — ni git, ni
 * le disque. Le retrait disque était resté synchrone : 153,8 s de fenêtre figée le 2026-10-22
 * sur une copie oubliée de git (`balayage-disque-async.test.ts`).
 */
export async function balayerLeCheminAsync(this: WorktreeManager, path: string): Promise<boolean> {
  // Même porte que `balayerLeChemin` : pas de retrait, même par le disque, sans note écrite.
  if (!this.noterSuppressionCommencee(path)) return false
  const retraitDoux = await this.cleanupWorktreeAsync(path, false, { raison: RAISON_BALAYAGE })
  if (retraitDoux.ok) return conclureBalayageReussi(this, path, retraitDoux.traceManquante)
  if (this.estWorktreeEnregistree(path)) {
    const retraitForce = await this.cleanupWorktreeAsync(path, true, { raison: RAISON_BALAYAGE })
    if (retraitForce.ok) return conclureBalayageReussi(this, path, retraitForce.traceManquante)
  }
  return this.finirBalayageParLeDisque(
    path,
    await this.tenterRetraitDisqueAsync(path),
    RAISON_BALAYAGE
  )
}

// fix-ok: tenterRetraitDisque appliquait la garde du point de reprise sans regarder passeOutre ; le repli disque d'un retrait voulu rendait ok:false et la copie restait.
/**
 * Retrait disque d'une copie : '' s'il a réussi, sinon la cause (qui nomme le fichier bloquant).
 * `passeOutre` : le même motif qu'au passage commun ; sans lui, la garde du point de reprise tient.
 */
export function tenterRetraitDisque(
  this: WorktreeManager,
  path: string,
  passeOutre?: string
): string {
  // Le retrait par le disque est une sortie de plus : il suit la garde du passage commun, et ne la
  // contourne que par le même motif.
  if (!passeOutre && copieGardeeParUnPointDeReprise(this.copiesProtegees, path))
    return DETAIL_POINT_DE_REPRISE_VIVANT
  try {
    this.removeDirFn(path)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** Le même retrait, hors du fil principal : seule la FORME change, jamais le verdict. */
export async function tenterRetraitDisqueAsync(
  this: WorktreeManager,
  path: string,
  passeOutre?: string
): Promise<string> {
  if (!passeOutre && copieGardeeParUnPointDeReprise(this.copiesProtegees, path))
    return DETAIL_POINT_DE_REPRISE_VIVANT
  try {
    await this.removeDirAsyncFn(path)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// fix-ok: cause mesurée — test rouge « copie que git ne connaît plus, retirée par le disque : son historique CLI part avec elle » (worktree-manager-copies.test.ts) : l'historique restait après le retrait disque, car ce chemin n'appelait jamais le rangement.
/**
 * Dernier recours commun aux deux formes : le disque, puis `worktree prune`, puis l'echec VISIBLE.
 * `detailDisque` : retrait disque DÉJÀ tenté par la forme asynchrone ; absent, il est fait ici.
 */
export function finirBalayageParLeDisque(
  this: WorktreeManager,
  path: string,
  detailDisque: string | undefined,
  raison: string
): boolean {
  // Relevées AVANT le retrait : les copies voisines protègent leur propre historique CLI.
  const voisines = copiesVivantes(path)
  const detail = detailDisque ?? this.tenterRetraitDisque(path)
  this.tryGitFn(this.baseRepo, ['worktree', 'prune'])
  if (!existsSync(path)) {
    /*
     * Ce chemin ne passe pas par `conclureRetraitDeCopie` : sans ce rangement, une copie retirée par le
     * disque laissait son historique CLI sous `~/.claude/projects` (test rouge : l'historique restait).
     * La fiche de suppression, posée au début, s'efface avec la copie.
     */
    supprimerHistoriqueCli(path, voisines)
    this.oublierSuppressionCommencee(path)
    // Retrait par le disque réussi : sa trace s'écrit ici, puisque le passage commun n'a pas tourné.
    const trace = tracerRetraitDeCopie(this.worktreeRoot, path, raison)
    if (trace) {
      this.noterEchecDeBalayage(path, trace)
      return true
    }
    return this.oublierEchecDeBalayage(path)
  }

  this.noterEchecDeBalayage(path, detail || 'le dossier de la copie survit au balayage')
  return false
}

export function noterEchecDeBalayage(this: WorktreeManager, path: string, detail: string): void {
  const cle = resolve(path)
  const precedent = this.echecsDeBalayage.get(cle)
  this.echecsDeBalayage.set(cle, { echecs: (precedent?.echecs ?? 0) + 1, detail })
}

/**
 * Chaque sortie en succès du balayage passe ici : la copie est partie. Sa trace s'écrit au passage
 * commun (`cleanupWorktree`) ou, pour un retrait par le disque, dans `finirBalayageParLeDisque`.
 */
export function oublierEchecDeBalayage(this: WorktreeManager, path: string): true {
  this.echecsDeBalayage.delete(resolve(path))
  return true
}

/**
 * Retrait réussi : la copie est partie. Une trace manquante est DÉJÀ notée au passage commun
 * (`cleanupWorktree`) : la noter ici la compterait deux fois. Sans trace manquante, un ancien blocage
 * de ce chemin s'efface.
 */
// fix-ok: le passage commun note déjà la trace manquante ; le balayage ne doit pas la noter une seconde fois (echecs = 2).
function conclureBalayageReussi(
  wm: WorktreeManager,
  path: string,
  traceManquante: string | undefined
): true {
  if (traceManquante) return true
  return wm.oublierEchecDeBalayage(path)
}

const RAISON_BALAYAGE = 'balayage horaire'
const RAISON_REPRISE = 'reprise d’une suppression coupée'

/** Les chemins que le balayage n'a PAS pu retirer, avec leur nombre d'echecs et la cause lue. */
export function blocagesDeBalayage(
  this: WorktreeManager
): Array<{ path: string; echecs: number; detail: string }> {
  return [...this.echecsDeBalayage.entries()].map(([path, etat]) => ({ path, ...etat }))
}

/** La copie figure-t-elle encore au registre `git worktree list` ? */
export function estWorktreeEnregistree(this: WorktreeManager, path: string): boolean {
  const liste = this.tryGitFn(this.baseRepo, ['worktree', 'list', '--porcelain'])
  if (liste.code !== 0) return true // dans le doute, on ne supprime pas a la main
  const cible = resolve(path).toLowerCase()
  return liste.stdout
    .split(LIGNES)
    .filter((ligne) => ligne.startsWith('worktree '))
    .some((ligne) => resolve(ligne.slice('worktree '.length).trim()).toLowerCase() === cible)
}

// fix-ok: le balayage des copies abandonnées lit les deux racines ; une copie d'agent posée sous la racine unique est candidate au retrait comme une copie d'avant.
/**
 * Les copies d'agent des DEUX racines : l'ancienne (`worktrees\<dépôt>\agent__<id>`) et la racine unique
 * (`copies-de-taches\<id>`). Une copie de fil n'y figure jamais.
 */
export function copiesCandidates(this: WorktreeManager): CopieAgentLue[] {
  const copies: CopieAgentLue[] = []
  for (const entry of lireDossiers(this.worktreeRoot)) {
    const agentId = agentIdDeCopieHeritee(entry.name)
    if (agentId !== undefined)
      copies.push({ agentId, path: join(this.worktreeRoot, entry.name), entry })
  }
  for (const entry of lireDossiers(this.racineCopiesDeTaches)) {
    const agentId = agentIdDeCopieNeuve(entry.name)
    if (agentId !== undefined)
      copies.push({ agentId, path: join(this.racineCopiesDeTaches, entry.name), entry })
  }
  return copies
}

function lireDossiers(racine: string): Dirent[] {
  return existsSync(racine) ? readdirSync(racine, { withFileTypes: true }) : []
}

/**
 * Le commit est-il deja retenu par une reference du depot ?
 *
 * UNE seule definition de « deja dans l'historique », partagee par le balayage de copies et par la
 * fermeture des manifestes orphelins. En avoir deux qui divergent serait pire que n'en avoir
 * aucune : c'est ce test qui autorise a supprimer, donc il ne doit exister qu'a un endroit.
 *
 * Rend `undefined` quand git ne repond pas — l'ignorance n'est pas une reponse negative, et
 * l'appelant doit s'abstenir plutot que de supposer.
 */
/**
 * LA MEME QUESTION, POSEE UNE SEULE FOIS POUR TOUT UN LOT.
 *
 * `for-each-ref --contains <sha>` reparcourt TOUTES les references du depot a chaque appel :
 * mesure du 2026-09-03 (`gels.jsonl`, gel de demarrage) 27 appels = 2 252 ms de fenetre morte,
 * soit 83 ms piece, payes sur le thread qui dessine la fenetre. Or `rev-list --no-walk` repond
 * pour N commits d'un coup : il rend ceux qui ne sont atteignables depuis AUCUNE reference. Un
 * commit absent de sa sortie est donc deja retenu par l'historique — meme definition, une commande.
 *
 * `--glob=refs/*` et `--single-worktree`, jamais `--all` : `--all` compte AUSSI le HEAD du depot et
 * les HEAD detaches des copies, que `for-each-ref` ignore. Avec lui, un travail retenu par la SEULE
 * copie de l'agent passait pour deja publie — et son manifeste, seule adresse de ce travail, etait
 * supprime. Verifie par test sur depot reel : la reponse doit etre identique a la voie unitaire.
 *
 * Rend une entree `undefined` par sha quand git ne repond pas : l'ignorance n'est pas une reponse
 * negative, et l'appelant doit s'abstenir de supprimer.
 */
export function commitsDejaReferences(
  this: WorktreeManager,
  shas: readonly string[]
): Map<string, boolean | undefined> {
  const reponse = new Map<string, boolean | undefined>()
  const valides = [...new Set(shas.filter((sha) => /^[0-9a-f]{40,64}$/i.test(sha)))]
  for (const sha of shas) if (!valides.includes(sha)) reponse.set(sha, undefined)
  if (valides.length === 0) return reponse
  const sortie = this.tryGitFn(this.baseRepo, [
    'rev-list',
    '--single-worktree',
    '--no-walk',
    ...valides,
    '--not',
    '--glob=refs/*'
  ])
  if (sortie.code !== 0) {
    for (const sha of valides) reponse.set(sha, undefined)
    return reponse
  }
  const orphelins = new Set(
    sortie.stdout
      .split(/\r?\n/)
      .map((ligne) => ligne.trim().toLowerCase())
      .filter(Boolean)
  )
  for (const sha of valides) reponse.set(sha, !orphelins.has(sha.toLowerCase()))
  return reponse
}

/**
 * LA MÊME QUESTION, DANS LE WORKER DÈS QU'IL EXISTE (heal « les lags », 2026-10-31).
 * Le `rev-list` ci-dessus répond d'habitude en 50 ms, mais `gels.jsonl` le montre tenant la fenêtre
 * 125,7 s le 2026-10-31 à 19:27 UTC, le pire gel unitaire de la période : la commande bloque le fil
 * qui l'attend, et ce fil était celui qui dessine.
 */
export async function commitsDejaReferencesAsync(
  this: WorktreeManager,
  shas: readonly string[]
): Promise<Map<string, boolean | undefined>> {
  if (!this.operationClient) return this.commitsDejaReferences(shas)
  return this.operationClient.run<Map<string, boolean | undefined>>({
    operation: 'commitsDejaReferences',
    shas: [...shas]
  })
}

export function commitDejaReference(this: WorktreeManager, sha: string): boolean | undefined {
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) return undefined
  const containing = this.tryGitFn(this.baseRepo, [
    'for-each-ref',
    '--contains',
    sha,
    '--count=1',
    '--format=%(refname)'
  ])
  if (containing.code !== 0) return undefined
  return Boolean(containing.stdout.trim())
}

/*
 * LA NOTE DE RETRAIT. Retirer une copie commence par son lien git : c'est git qui le retire en premier,
 * puis le dossier. Si le retrait s'arrête entre les deux, le dossier reste SANS lien, et
 * `ownershipIssueAsync` le refuse à chaque passage : rien ne le reprenait jamais (22 copies le 08/11).
 *
 * Avant tout geste sur la copie, on écrit donc une fiche `.a-supprimer/<agent>.json` : « un retrait de
 * cette copie a été demandé », avec l'instant de création du dossier. Le passage suivant reprend un
 * dossier qui porte la fiche ET n'a plus de lien git. Un dossier recréé au même nom (un run qui revient)
 * a une autre création : il n'est jamais touché. Un dossier qui garde son lien reste au balayage normal,
 * qui le juge avec toutes ses gardes.
 */
// fix-ok: cause mesurée par worktree-manager-copies.test.ts (rouge avant le correctif, 3 échecs sur `existsSync`) : un retrait coupé laisse un dossier sans `.git`, que `ownershipIssueAsync` refuse à chaque passage, et rien ne désignait ce dossier pour reprise.
export const DOSSIER_DES_FICHES_DE_SUPPRESSION = '.a-supprimer'

interface FicheDeSuppression {
  agentId: string
  /** 0 quand le disque ne donne pas l'instant de création : la vérification d'identité est alors sautée. */
  naissance: number
}

type VerdictDeReprise = 'attendre' | 'laisser' | 'oublier' | 'finir' | 'retirer'

/**
 * L'identifiant de la copie d'agent posée à `chemin`, sous l'ancienne racine ou sous la racine unique.
 * Tout autre dossier n'a pas d'identifiant de copie : `undefined`.
 */
function identifiantDeCopieAgent(this: WorktreeManager, chemin: string): string | undefined {
  const nom = basename(chemin)
  const dossier = dirname(chemin)
  let agentId: string | undefined
  if (dossierEst(dossier, this.worktreeRoot)) {
    agentId = agentIdDeCopieHeritee(nom)
  } else if (dossierEst(dossier, this.racineCopiesDeTaches)) {
    agentId = agentIdDeCopieNeuve(nom)
  }
  return agentId !== undefined && SAFE_ID.test(agentId) ? agentId : undefined
}

function dossierEst(dossier: string, attendu: string): boolean {
  return resolve(dossier).toLowerCase() === resolve(attendu).toLowerCase()
}

function dossierDesFiches(racine: string): string {
  return join(racine, DOSSIER_DES_FICHES_DE_SUPPRESSION)
}

function ficheDe(racine: string, agentId: string): string {
  return join(dossierDesFiches(racine), `${agentId}.json`)
}

/** L'instant de création du dossier ; `undefined` s'il n'existe pas. */
function naissanceDuDossier(chemin: string): number | undefined {
  try {
    return statSync(chemin).birthtimeMs
  } catch {
    return undefined
  }
}

/** Efface une fiche, puis le dossier des fiches s'il est vide. */
function retirerLaFiche(racine: string, agentId: string): void {
  rmSync(ficheDe(racine, agentId), { force: true })
  try {
    rmdirSync(dossierDesFiches(racine))
  } catch {
    /* encore des fiches dedans : rien à faire */
  }
}

/**
 * Note qu'un retrait de cette copie commence. Rend `false` si la note ne peut pas être écrite : dans ce
 * cas le retrait ne doit pas commencer, sinon il ne serait pas reconnaissable s'il s'arrêtait.
 */
export function noterSuppressionCommencee(this: WorktreeManager, chemin: string): boolean {
  const agentId = identifiantDeCopieAgent.call(this, chemin)
  if (!agentId) return true
  const naissance = naissanceDuDossier(chemin)
  if (naissance === undefined) return true
  try {
    mkdirSync(dossierDesFiches(this.worktreeRoot), { recursive: true })
    writeFileSync(ficheDe(this.worktreeRoot, agentId), JSON.stringify({ agentId, naissance }))
    return true
  } catch (erreur) {
    this.noterEchecDeBalayage(
      chemin,
      `la note de retrait n’a pas pu être écrite : ${message(erreur)}`
    )
    return false
  }
}

/** Efface la fiche une fois la copie partie. Tant que le dossier est là, la fiche reste. */
export function oublierSuppressionCommencee(this: WorktreeManager, chemin: string): void {
  const agentId = identifiantDeCopieAgent.call(this, chemin)
  if (!agentId || existsSync(chemin)) return
  retirerLaFiche(this.worktreeRoot, agentId)
}

function fichesDeSuppression(racine: string): FicheDeSuppression[] {
  let noms: string[]
  try {
    noms = readdirSync(dossierDesFiches(racine))
  } catch {
    return []
  }
  const fiches: FicheDeSuppression[] = []
  for (const nom of noms) {
    if (!nom.endsWith('.json')) continue
    try {
      const lue = JSON.parse(readFileSync(join(dossierDesFiches(racine), nom), 'utf8')) as Partial<
        Record<keyof FicheDeSuppression, unknown>
      >
      if (
        typeof lue.agentId === 'string' &&
        SAFE_ID.test(lue.agentId) &&
        nom === `${lue.agentId}.json` &&
        typeof lue.naissance === 'number'
      ) {
        fiches.push({ agentId: lue.agentId, naissance: lue.naissance })
      }
    } catch {
      /* fiche illisible : on ne devine pas ce qu'elle protège, on la laisse */
    }
  }
  return fiches
}

/**
 * Ce que le passage suivant fait d'une fiche. Le dossier n'est touché que dans le cas `retirer` : fiche
 * présente, dossier de la même création, sans lien git, sans bail.
 */
function verdictDeReprise(
  this: WorktreeManager,
  fiche: FicheDeSuppression,
  chemin: string
): VerdictDeReprise {
  // Un run dont le point de reprise vit encore garde sa copie, même coupée : la finir la rendrait
  // introuvable à la reprise. Le verdict se relit quand le point de reprise disparaît.
  // fix-ok: la reprise d'une suppression coupée ne doit pas finir la copie d'un run reprenable
  if (this.copiesProtegees.has(fiche.agentId)) return 'attendre'
  if (this.hasActiveProcesses(fiche.agentId)) return 'attendre'
  const naissance = naissanceDuDossier(chemin)
  if (naissance === undefined) return 'finir'
  if (fiche.naissance !== 0 && naissance !== fiche.naissance) return 'oublier'
  if (existsSync(join(chemin, '.git'))) return 'laisser'
  return 'retirer'
}

/**
 * Reprend les retraits coupés : la jonction des modules d'abord (jamais suivie), puis le dossier, puis
 * `worktree prune`. Une reprise qui échoue reste notée et garde sa fiche pour le passage suivant.
 */
export function reprendreSuppressionsCommencees(this: WorktreeManager): string[] {
  const reprises: string[] = []
  for (const fiche of fichesDeSuppression(this.worktreeRoot)) {
    const chemin = this.pathFor(fiche.agentId)
    const verdict = verdictDeReprise.call(this, fiche, chemin)
    if (verdict === 'attendre' || verdict === 'laisser') continue
    if (verdict === 'oublier') {
      retirerLaFiche(this.worktreeRoot, fiche.agentId)
      continue
    }
    const voisines = copiesVivantes(chemin)
    let traceManquante: string | undefined
    if (verdict === 'retirer') {
      const lien = delierLesDependances(chemin)
      if (lien.fait === 'echec') {
        this.noterEchecDeBalayage(chemin, lien.raison)
        continue
      }
      const detail = this.tenterRetraitDisque(chemin)
      if (existsSync(chemin)) {
        this.noterEchecDeBalayage(chemin, detail || 'le dossier survit à la reprise')
        continue
      }
      // Retrait réussi : sa trace s'écrit ici. Un échec ne retient ni le ménage ni la fiche : la copie est partie.
      traceManquante = tracerRetraitDeCopie(this.worktreeRoot, chemin, RAISON_REPRISE)
    }
    this.tryGitFn(this.baseRepo, ['worktree', 'prune'])
    supprimerHistoriqueCli(chemin, voisines)
    retirerLaFiche(this.worktreeRoot, fiche.agentId)
    // fix-ok: la trace en échec gardait la fiche et sortait de la boucle ; le passage suivant (dossier absent, verdict finir) effaçait le blocage sans réécrire la trace.
    if (traceManquante) this.noterEchecDeBalayage(chemin, traceManquante)
    else this.oublierEchecDeBalayage(chemin)
    reprises.push(fiche.agentId)
  }
  return reprises
}

/** `reprendreSuppressionsCommencees` sans tenir la boucle : même verdict, retraits attendus. */
export async function reprendreSuppressionsCommenceesAsync(
  this: WorktreeManager
): Promise<string[]> {
  const reprises: string[] = []
  for (const fiche of fichesDeSuppression(this.worktreeRoot)) {
    const chemin = this.pathFor(fiche.agentId)
    const verdict = verdictDeReprise.call(this, fiche, chemin)
    if (verdict === 'attendre' || verdict === 'laisser') continue
    if (verdict === 'oublier') {
      retirerLaFiche(this.worktreeRoot, fiche.agentId)
      continue
    }
    const voisines = copiesVivantes(chemin)
    let traceManquante: string | undefined
    if (verdict === 'retirer') {
      const lien = delierLesDependances(chemin)
      if (lien.fait === 'echec') {
        this.noterEchecDeBalayage(chemin, lien.raison)
        continue
      }
      const detail = await this.tenterRetraitDisqueAsync(chemin)
      if (existsSync(chemin)) {
        this.noterEchecDeBalayage(chemin, detail || 'le dossier survit à la reprise')
        continue
      }
      // Même règle que la forme synchrone : un retrait réussi reste réussi même si sa trace échoue.
      traceManquante = await tracerRetraitDeCopieAsync(this.worktreeRoot, chemin, RAISON_REPRISE)
    }
    await this.tryGitAsyncFn(this.baseRepo, ['worktree', 'prune'])
    supprimerHistoriqueCli(chemin, voisines)
    retirerLaFiche(this.worktreeRoot, fiche.agentId)
    // fix-ok: même cause que la forme synchrone : le passage suivant effaçait le blocage sans réécrire la trace.
    if (traceManquante) this.noterEchecDeBalayage(chemin, traceManquante)
    else this.oublierEchecDeBalayage(chemin)
    reprises.push(fiche.agentId)
  }
  return reprises
}

export function sweepAbandonedAgentCopies(this: WorktreeManager): string[] {
  const swept: string[] = this.reprendreSuppressionsCommencees()
  for (const copie of this.copiesCandidates()) {
    const balayee = this.balayerUneCopie(copie)
    if (balayee) swept.push(balayee)
  }
  return swept
}

/**
 * Le même balayage, en rendant la main au fil principal entre chaque copie.
 *
 * Sans cela, ce travail gelait l'application ~19,5 s : aucun IPC ne pouvait être servi, alors que
 * ce balayage est du ramassage OPPORTUNISTE dont rien n'attend le résultat.
 */
export async function sweepAbandonedAgentCopiesAsync(this: WorktreeManager): Promise<string[]> {
  const swept: string[] = await this.reprendreSuppressionsCommenceesAsync()
  for (const copie of this.copiesCandidates()) {
    const balayee = await this.balayerUneCopieAsync(copie)
    if (balayee) swept.push(balayee)
    // `setImmediate` et non `setTimeout(0)` : on repasse par la boucle d'événements — donc les IPC
    // en attente sont servis — sans ajouter de délai par copie.
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return swept
}

/** Lease durable par PID : empêche une autre instance de récupérer une copie encore utilisée. */
export function markProcess(
  this: WorktreeManager,
  agentId: string,
  pid: number,
  active: boolean
): void {
  assertSafeId(agentId, 'agentId')
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`pid invalide: ${pid}`)
  const leaseDir = join(this.worktreeRoot, '.leases', agentId)
  const leasePath = join(leaseDir, String(pid))
  if (active) {
    mkdirSync(leaseDir, { recursive: true })
    writeFileSync(
      leasePath,
      JSON.stringify({ identity: this.processIdentity(pid) ?? null, recordedAt: Date.now() })
    )
    return
  }
  rmSync(leasePath, { force: true })
  if (existsSync(leaseDir) && readdirSync(leaseDir).length === 0) {
    supprimerArbre(leaseDir)
  }
}

/** Barrière pré-spawn : un crash entre l'intention et le PID ne déclenche jamais un cleanup. */
export function markSpawnIntent(
  this: WorktreeManager,
  agentId: string,
  token: string,
  active: boolean
): void {
  assertSafeId(agentId, 'agentId')
  assertSafeId(token, 'spawn token')
  const leaseDir = join(this.worktreeRoot, '.leases', agentId)
  const intentPath = join(leaseDir, `spawn-pending-${token}`)
  if (active) {
    mkdirSync(leaseDir, { recursive: true })
    writeFileSync(intentPath, String(this.now()))
    return
  }
  rmSync(intentPath, { force: true })
}

/** Transfert atomique intention → PID : aucun crash ne peut laisser une fenêtre sans lease. */
export function confirmSpawn(
  this: WorktreeManager,
  agentId: string,
  token: string,
  pid: number
): void {
  assertSafeId(agentId, 'agentId')
  assertSafeId(token, 'spawn token')
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`pid invalide: ${pid}`)
  const leaseDir = join(this.worktreeRoot, '.leases', agentId)
  const intentPath = join(leaseDir, `spawn-pending-${token}`)
  const leasePath = join(leaseDir, String(pid))
  renameSync(intentPath, leasePath)
  writeFileSync(
    leasePath,
    JSON.stringify({ identity: this.processIdentity(pid) ?? null, recordedAt: Date.now() })
  )
}

/** Nettoie les leases de PID morts et indique si un CLI vivant possède encore la copie. */
export function hasActiveProcesses(this: WorktreeManager, agentId: string): boolean {
  assertSafeId(agentId, 'agentId')
  const leaseDir = join(this.worktreeRoot, '.leases', agentId)
  if (!existsSync(leaseDir)) return false
  let active = false
  const entrees = readdirSync(leaseDir, { withFileTypes: true })
  this.prechargerEmpreintes(entrees.map((entree) => Number(entree.name)))
  for (const entry of entrees) {
    if (entry.isFile() && entry.name.startsWith('spawn-pending-')) {
      const intentPath = join(leaseDir, entry.name)
      const recordedAt = Number(readFileSync(intentPath, 'utf8'))
      if (
        Number.isFinite(recordedAt) &&
        this.now() - recordedAt >= 0 &&
        this.now() - recordedAt < SPAWN_INTENT_MAX_AGE_MS
      ) {
        active = true
      } else {
        rmSync(intentPath, { force: true })
      }
      continue
    }
    const pid = Number(entry.name)
    if (!entry.isFile() || !Number.isSafeInteger(pid) || pid <= 0) {
      supprimerArbre(join(leaseDir, entry.name))
      continue
    }
    const leasePath = join(leaseDir, entry.name)
    let lease: { identity: string | null; recordedAt: number }
    try {
      const raw = readFileSync(leasePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<typeof lease>
      lease = {
        identity: typeof parsed.identity === 'string' ? parsed.identity : null,
        recordedAt: typeof parsed.recordedAt === 'number' ? parsed.recordedAt : Number(raw)
      }
    } catch {
      lease = { identity: null, recordedAt: 0 }
    }
    // Le recensement ne BLOQUE plus : il lit ce que la memoire courte sait (cf. `empreinteConnue`).
    const currentIdentity =
      this.processIdentity === defaultProcessIdentity
        ? empreinteConnue(pid)
        : this.processIdentity(pid)
    if (
      lease.identity &&
      currentIdentity &&
      !isSameProcessIdentity(lease.identity, currentIdentity)
    ) {
      rmSync(leasePath, { force: true })
      continue
    }
    try {
      process.kill(pid, 0)
      active = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        active = true
      } else {
        rmSync(leasePath, { force: true })
      }
    }
  }
  if (!active && existsSync(leaseDir) && readdirSync(leaseDir).length === 0) {
    supprimerArbre(leaseDir)
  }
  return active
}

export function operationInProgress(
  this: WorktreeManager,
  repo = this.baseRepo
): string[] | undefined {
  const conflictOut = this.tryGitFn(repo, ['diff', '--name-only', '-z', '--diff-filter=U'])
  const conflictFiles = parseNullSeparatedPaths(conflictOut.stdout)
  const operationPaths = [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'REBASE_HEAD',
    'BISECT_START',
    'rebase-merge',
    'rebase-apply',
    'sequencer'
  ]
  const hasOperation = operationPaths.some((name) => {
    const gitPath = this.tryGitFn(repo, ['rev-parse', '--git-path', name])
    if (gitPath.code !== 0) return false
    const candidate = gitPath.stdout.trim()
    return (
      candidate.length > 0 &&
      existsSync(isAbsolute(candidate) ? candidate : resolve(repo, candidate))
    )
  })
  return conflictFiles.length > 0 || hasOperation ? conflictFiles : undefined
}

export function blockingDirtyFiles(this: WorktreeManager, agentFiles: string[]): string[] {
  const dirtyFiles = parsePorcelainPaths(
    this.git(this.baseRepo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  )
  return agentFiles.filter((file) => dirtyFiles.includes(file))
}

export function headAdvance(
  this: WorktreeManager,
  path: string,
  expectedSha: string
): { advanced: boolean; files: string[] } {
  const currentSha = this.git(path, ['rev-parse', 'HEAD'])
  if (currentSha === expectedSha) return { advanced: false, files: [] }
  const files = parseNullSeparatedPaths(
    this.git(path, ['diff', '--name-only', '-z', `${expectedSha}..${currentSha}`])
  )
  return { advanced: true, files }
}

/**
 * Attache HEAD à une branche durable avant suppression. Tout commit concurrent avance alors
 * cette référence Git ; après le remove, on peut restaurer la copie au lieu de perdre le commit.
 */
export function cleanupAgentWorktree(
  this: WorktreeManager,
  agentId: string,
  path: string,
  expectedSha: string
): { ok: boolean; advanced: boolean; files: string[] } {
  const branch = `autowin/recovery/${agentId}`
  const attach = this.tryGitFn(path, ['switch', '-C', branch])
  if (attach.code !== 0) return { ok: false, advanced: false, files: [] }

  const beforeCleanup = this.headAdvance(path, expectedSha)
  if (beforeCleanup.advanced) {
    return { ok: false, advanced: true, files: beforeCleanup.files }
  }

  const quarantineRoot = join(this.worktreeRoot, '.quarantine')
  const quarantinePath = join(quarantineRoot, `${agentId}__${randomUUID()}`)
  mkdirSync(quarantineRoot, { recursive: true })
  try {
    renameSync(path, quarantinePath)
  } catch {
    return { ok: false, advanced: false, files: this.unpublishedFiles(path) }
  }
  const restore = (): void => {
    if (!existsSync(path) && existsSync(quarantinePath)) renameSync(quarantinePath, path)
    this.tryGitFn(this.baseRepo, ['worktree', 'repair', path])
  }
  const repair = this.tryGitFn(this.baseRepo, ['worktree', 'repair', quarantinePath])
  if (repair.code !== 0) {
    restore()
    return { ok: false, advanced: false, files: this.unpublishedFiles(path) }
  }

  const quarantinedAdvance = this.headAdvance(quarantinePath, expectedSha)
  const quarantinedFiles = this.unpublishedFiles(quarantinePath)
  if (quarantinedAdvance.advanced || quarantinedFiles.length > 0) {
    restore()
    return {
      ok: false,
      advanced: quarantinedAdvance.advanced,
      files: [...new Set([...quarantinedAdvance.files, ...quarantinedFiles])]
    }
  }

  const cleanup = this.cleanupWorktree(quarantinePath, false, { raison: 'quarantaine' })
  if (cleanup.ok) {
    /*
     * L'historique CLI se purge sur le chemin D'ORIGINE, jamais sur celui de la quarantaine.
     *
     * La copie est DEPLACEE avant d'etre liberee : le nettoyage ci-dessus ne voit donc que
     * `.quarantine/<agent>__<uuid>`, un chemin qui n'a jamais servi de repertoire courant au CLI
     * et auquel aucun dossier d'historique ne correspond. C'est exactement ce que le test de bout
     * en bout a revele le 2026-09-12 : la purge branchee dans `cleanupWorktree` ne ramassait rien
     * par cette voie, qui est pourtant la voie NORMALE de `remove()`.
     */
    supprimerHistoriqueCli(path, copiesVivantes(path))
  }
  if (!cleanup.ok) {
    restore()
    return {
      ok: false,
      advanced: false,
      files: this.unpublishedFiles(path)
    }
  }

  const durableSha = this.git(this.baseRepo, ['rev-parse', branch])
  if (durableSha !== expectedSha) {
    const files = parseNullSeparatedPaths(
      this.git(this.baseRepo, ['diff', '--name-only', '-z', `${expectedSha}..${durableSha}`])
    )
    this.tryGitFn(this.baseRepo, ['-c', 'core.longpaths=true', 'worktree', 'add', path, branch])
    return { ok: false, advanced: true, files }
  }

  /*
   * LA REF NE SE SUPPRIME QUE SI ELLE NE PROTEGE RIEN.
   *
   * CausalHypothesis (verifiee le 2026-08-26) : `deleteRecoveryRefIfExpected` demande « HEAD a-t-il
   * bouge depuis mon `rev-parse` ? ». Or `expectedSha` EST le commit de l'agent : pour un bureau
   * dont le travail est deja committe en HEAD detache, l'egalite est garantie, donc la ref etait
   * supprimee A TOUS LES COUPS. Le dossier venait d'etre balaye juste au-dessus : le commit se
   * retrouvait sans dossier ET sans ref, hors de tout `for-each-ref` -- invisible au recensement, et
   * candidat au prochain `gc`.
   *
   * MESURE en rangeant cette installation : trois bureaux ont perdu leur ref ainsi, dont `7467f237`
   * (lunes/nuage + son test de contrat, vert). Ils n'ont survecu qu'a un `git branch` pose a la main.
   * C'est aussi la cause du « rien a fusionner » repete : l'agent cherche ce qu'aucune ref ne porte
   * plus.
   *
   * La bonne question vit deja dans ce fichier : `apporteQuelqueChose` (patch-id contre la base) --
   * celle que le recensement pose. Un bureau qui n'apporte rien laisse toujours son ref partir : on
   * ne garde pas une adresse pour du vide, c'est l'intention d'origine et elle est preservee.
   *
   * LA BASE EST 'HEAD', DELIBEREMENT, et ce n'est PAS `main` : c'est la branche courante du depot de
   * base, donc une reference MOUVANTE sur un arbre partage. C'est exactement la base que
   * `travauxNonPublies` utilise (son parametre `baseRef` vaut 'HEAD' par defaut) : garder ou
   * supprimer une adresse doit repondre a la MEME question que « ce travail est-il encore a
   * publier ? », sinon le rangement et le recensement divergent — une adresse gardee que le
   * recensement ignore, ou l'inverse. Angle mort assume : deux commits au patch-id identique se
   * lisent comme un seul, donc un travail dont le diff est deja dans HEAD par une autre voie laisse
   * son adresse partir. C'est le comportement voulu (il n'apporte rien), pas un oubli.
   */
  if (this.apporteQuelqueChose(branch, 'HEAD')) {
    return { ok: true, advanced: false, files: [] }
  }
  const deleteRef = this.deleteRecoveryRefIfExpected(branch, expectedSha)
  if (deleteRef.advanced) {
    this.tryGitFn(this.baseRepo, ['-c', 'core.longpaths=true', 'worktree', 'add', path, branch])
    return { ok: false, advanced: true, files: deleteRef.files }
  }
  return { ok: deleteRef.deleted, advanced: false, files: [] }
}

/**
 * Supprime une ref de récupération seulement si elle pointe encore sur la SHA contrôlée.
 * `update-ref <oldvalue>` réalise comparaison + suppression sous le verrou Git : une avance
 * concurrente ne peut donc jamais être effacée entre un `rev-parse` et la suppression.
 */
export function deleteRecoveryRefIfExpected(
  this: WorktreeManager,
  branch: string,
  expectedSha: string
): { deleted: boolean; advanced: boolean; files: string[] } {
  const ref = `refs/heads/${branch}`
  const deletion = this.tryGitFn(this.baseRepo, ['update-ref', '-d', ref, expectedSha])
  const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
  if (deletion.code === 0 && current.code !== 0) {
    return { deleted: true, advanced: false, files: [] }
  }
  if (current.code !== 0) {
    return { deleted: false, advanced: false, files: [] }
  }
  const currentSha = current.stdout.trim()
  if (currentSha === expectedSha) {
    return { deleted: false, advanced: false, files: [] }
  }
  const files = this.tryGitFn(this.baseRepo, [
    'diff',
    '--name-only',
    '-z',
    `${expectedSha}..${currentSha}`
  ])
  const changedPaths = parseNullSeparatedPaths(files.stdout)
  return { deleted: false, advanced: true, files: changedPaths }
}

/**
 * Rematérialise une ref de récupération avancée en vrai bureau ouvrable.
 * La ref reste l'ancre durable ; en cas d'échec temporaire, le coordinateur réessaiera.
 */
export function restoreRecoveryWorktree(
  this: WorktreeManager,
  agentId: string,
  branch: string
): boolean {
  const path = this.pathFor(agentId)
  if (!existsSync(path)) {
    const restored = this.tryGitFn(this.baseRepo, [
      '-c',
      'core.longpaths=true',
      'worktree',
      'add',
      path,
      branch
    ])
    if (restored.code !== 0) return false
  }
  if (this.ownershipIssue(path)) return false
  const branchHead = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', `refs/heads/${branch}`])
  const worktreeHead = this.tryGitFn(path, ['rev-parse', 'HEAD'])
  return (
    branchHead.code === 0 &&
    worktreeHead.code === 0 &&
    branchHead.stdout.trim() === worktreeHead.stdout.trim()
  )
}

export function recoveredPublishedResidue(
  this: WorktreeManager,
  agentId: string,
  branch: string,
  publishedSha: string,
  agentSha: string,
  files: string[]
): FinalizeResult {
  if (!this.restoreRecoveryWorktree(agentId, branch)) {
    return {
      outcome: 'cleanup-pending',
      agentId,
      files,
      publishedSha,
      agentSha,
      worktreeAvailable: false,
      detail:
        'Le retour est publié et la référence plus récente est protégée ; Autowin réessaiera de recréer son bureau.'
    }
  }
  return {
    outcome: 'published-residue',
    agentId,
    files,
    publishedSha,
    agentSha,
    detail:
      'La référence de récupération contient du travail plus récent et son bureau est restauré.'
  }
}

/**
 * Fichiers ignorés qui peuvent être de vrais LIVRABLES locaux — donc ceux qui bloquent la
 * publication. La question n'est pas « ce fichier est-il ignoré », c'est « est-il JETABLE ».
 *
 * LA RÈGLE SE DÉRIVE, ELLE NE S'ÉNUMÈRE PLUS, et c'est une récidive qui l'a imposé. Cette liste
 * nommait les dossiers un par un. Le 2026-08-21 un run vert a bloqué sa propre
 * publication parce que sa preuve vivait dans `Audit/` ; on a ajouté `Audit/` à la liste. Le
 * 2026-08-27 le MÊME défaut est revenu par `artifacts/` — la ligne SUIVANTE du même
 * `.gitignore` — trois refus, 3,22 $, zéro livraison. Corriger un dossier ne corrige pas un
 * défaut : il revient par le dossier d'à côté.
 *
 * Ce que le dépôt DÉCLARE lui-même sert désormais de source. `--directory` demande à git de
 * replier tout dossier entièrement ignoré en UNE entrée terminée par `/` : ces zones-là,
 * l'auteur du projet les a désignées jetables (`out/`, `dist/`, `artifacts/`, `Audit/`, et tout
 * dossier qu'on ajoutera demain sans toucher à ce code). Ce qui ressort en FICHIER a été nommé un
 * par un dans `.gitignore` : c'est peut-être un vrai livrable, et il continue de bloquer.
 *
 * La garde reste donc entière du côté qui compte — un fichier ignoré individuellement bloque
 * toujours — et c'est la seule direction où se tromper coûte du travail perdu.
 */
export function preservedIgnoredFiles(this: WorktreeManager, repo: string): string[] {
  const out = this.git(repo, [
    'ls-files',
    '-z',
    '--others',
    '--ignored',
    '--exclude-standard',
    // Replie chaque dossier entièrement ignoré en une seule entrée « <dossier>/ ». Sans lui, cette
    // commande énumérerait les 33 preuves d'`artifacts/` — et, sur un dépôt installé, node_modules
    // en entier.
    '--directory',
    '--',
    '.'
  ])
  return parseNullSeparatedPaths(out).filter((chemin) => {
    // Une entrée repliée en dossier = zone déclarée jetable par `.gitignore`. Rien à protéger.
    if (chemin.endsWith('/')) return false
    // Bruit régénérable nommé fichier par fichier : caches et empreintes de build. Ceux-là ne sont
    // pas des livrables, et ils étaient déjà écartés avant ce correctif — on ne change rien pour eux.
    return !/(?:^|\/)(?:\.eslintcache|\.DS_Store)$|\.tsbuildinfo$/.test(chemin)
  })
}

export function workingTreeFiles(this: WorktreeManager, repo: string): string[] {
  return parsePorcelainPaths(
    this.git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  )
}

/** Dernière barrière avant suppression : inclut les écritures suivies et ignorées arrivées tard. */
export function unpublishedFiles(this: WorktreeManager, repo: string): string[] {
  return [...new Set([...this.workingTreeFiles(repo), ...this.preservedIgnoredFiles(repo)])]
}

export function currentBaseBranch(this: WorktreeManager): string {
  return this.configuredBaseBranch ?? this.git(this.baseRepo, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

export function canonicalRemoteBase(
  this: WorktreeManager
): { ref: string; sha: string; repli?: string } | undefined {
  const origin = this.tryGitFn(this.baseRepo, ['remote', 'get-url', 'origin'])
  if (origin.code !== 0 || !origin.stdout.trim()) {
    if (this.requireCanonicalRemote) {
      throw new Error('Lancement bloqué : le distant origin est absent.')
    }
    return undefined
  }
  /*
   * UN FETCH QUI ÉCHOUE N'EST PAS UNE RAISON DE NE PAS TRAVAILLER.
   *
   * Avant, tout échec de `fetch` levait « Lancement bloqué » — donc lancer une conversation
   * exigeait le réseau, à chaque fois. Hors ligne, VPN coupé, origin momentanément injoignable :
   * l'application refusait de commencer, alors que `origin/main` était parfaitement connu en
   * local. Trois conversations lancées, trois fetch, trois occasions d'échouer avant tout travail.
   * C'est le « j'ai une erreur avant de se lancer au travail » signalé par l'utilisateur, et il
   * n'était couvert par aucun test.
   *
   * On DÉGRADE au lieu de bloquer : si une référence canonique résout déjà en local, on part de
   * celle-là. La garde n'est pas desserrée pour autant — il faut toujours qu'origin existe ET
   * qu'`origin/main` ou `origin/master` résolve ; sans ça, l'échec plus bas reste fatal. Le seul
   * changement est qu'une panne RÉSEAU cesse d'être traitée comme une absence de dépôt.
   *
   * Contrepartie assumée : on peut alors démarrer d'un `origin/main` légèrement en retard. C'est
   * le compromis explicite — la publication, elle, revérifie sa base et refusera si elle a bougé.
   */
  // fix-ok: cause mesurée — le fetch d'origine prenait le délai d'une commande git (180 s), et le travail local qui suivait ne tenait plus dans les 2 s restants du budget de l'opération (rejeu sur origin muet).
  // Délai propre au fetch : au délai d'une commande (180 s), un origin muet épuisait le budget du
  // lancement (182 s) avant même que le repli sur origin/main serve. Voir FETCH_ORIGIN_TIMEOUT_MS.
  const fetched = this.tryGitFn(this.baseRepo, ['fetch', '--no-tags', '--prune', 'origin'], {
    timeoutMs: FETCH_ORIGIN_TIMEOUT_MS
  })
  const detailFetch = fetched.code === 0 ? '' : causeGit(fetched)

  const symbolic = this.tryGitFn(this.baseRepo, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD'
  ])
  const candidates = [
    symbolic.code === 0 ? symbolic.stdout.trim() : '',
    'origin/main',
    'origin/master'
  ].filter((ref, index, refs) => ref && refs.indexOf(ref) === index)
  for (const ref of candidates) {
    if (!/^origin\/(?:main|master)$/.test(ref)) continue
    const resolved = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', `${ref}^{commit}`])
    if (resolved.code === 0 && /^[0-9a-f]{40,64}$/i.test(resolved.stdout.trim())) {
      // Repli : le fetch a échoué, la base vient du local. `repli` dit pourquoi ; describeForLaunch le trace.
      return fetched.code === 0
        ? { ref, sha: resolved.stdout.trim() }
        : { ref, sha: resolved.stdout.trim(), repli: detailFetch || 'fetch d’origine en échec' }
    }
  }
  // Aucune référence canonique, MÊME en local. Là, le refus est légitime — et il nomme la cause
  // réelle quand c'est le réseau qui a lâché, au lieu de laisser croire à un dépôt mal formé.
  throw new Error(
    detailFetch
      ? `Lancement bloqué : origin est injoignable et aucune référence locale ne le supplée (${detailFetch}).`
      : 'Lancement bloqué : origin/main ou origin/master est introuvable après fetch.'
  )
}

export function isExpectedBaseBranch(this: WorktreeManager, expectedBaseBranch: string): boolean {
  const currentRef = this.tryGitFn(this.baseRepo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return currentRef.code === 0 && currentRef.stdout.trim() === expectedBaseBranch
}

export function activeHooksDir(this: WorktreeManager): string {
  const configured = this.tryGitFn(this.baseRepo, ['config', '--path', '--get', 'core.hooksPath'])
  if (configured.code === 0 && configured.stdout.trim()) {
    const path = configured.stdout.trim()
    return isAbsolute(path) ? path : resolve(this.baseRepo, path)
  }
  const defaultPath = this.git(this.baseRepo, ['rev-parse', '--git-path', 'hooks'])
  return isAbsolute(defaultPath) ? defaultPath : resolve(this.baseRepo, defaultPath)
}
