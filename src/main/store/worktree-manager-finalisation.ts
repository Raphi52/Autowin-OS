// Finalisation, fusion et nettoyage après publication : méthodes de WorktreeManager déplacées telles quelles depuis worktree-manager.ts
// (lot 3). Chacune reçoit l'instance en `this` ; elles sont rattachées au prototype
// par attacherMethodes dans worktree-manager.ts, donc les appels `this.x(...)` restent identiques.
import { causeGit, sortieGit } from './cause-git'
import { randomUUID } from 'node:crypto'
import { balayerCoquillesVides, estCoquilleVide } from './coquilles-vides'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import type { EditionLocaleNonRemise, FinalizeResult } from './worktree-manager-types'
import {
  SAFE_ID,
  messageCommitAgent,
  assertSafeId,
  shellPath,
  parseNullSeparatedPaths,
  detailFinalisationJetee
} from './worktree-manager-outils'
import type { WorktreeManager } from './worktree-manager'

/**
 * Full-auto : committe le travail de l'agent dans sa copie puis le fusionne dans le repo de base.
 * - Rien à fusionner → { outcome: 'nothing' }.
 * - Merge propre → { outcome: 'merged' } + copie supprimée.
 * - Conflit réel → { outcome: 'conflict', files } : merge AVORTÉ, copie CONSERVÉE.
 * - Base sale/refus Git → { outcome: 'blocked', files } : aucun faux conflit, copie CONSERVÉE.
 */
/**
 * Enveloppe de `finalize` : TOUT refus repart avec une adresse, quand il y a quelque chose à sauver.
 *
 * Un juge externe a relevé le 2026-08-18 que la sécurisation n'était posée qu'au garde précoce
 * `operationInProgress`. Les refus DÉFINITIFS — `merge-failed` (quatre chemins) et `conflict` —
 * repartaient donc sans adresse, alors que ce sont les seuls que nulle reprise ne rattrape
 * (`merge-failed` est exclu des issues réessayables). On outillait le refus temporaire et on
 * laissait nu le refus définitif : l'inverse de ce qu'il faut.
 *
 * Un point de passage UNIQUE plutôt que cinq retours patchés : le geste est idempotent (il ne
 * réécrit pas une adresse déjà posée) et sans effet sur la base.
 */
export function finalize(
  this: WorktreeManager,
  agentId: string,
  options: {
    baseBranch?: string
    expectedAgentSha?: string
    /** Tâche du run : décrit le changement dans le message du commit (`messageCommitAgent`). */
    task?: string
    /**
     * Résolution humaine d'un conflit : `ours` garde le workspace sur les zones en conflit,
     * `theirs` garde la version de l'agent. Absent = merge strict (comportement automatique).
     */
    conflictStrategy?: 'ours' | 'theirs'
    /**
     * BARREAU 2 — autorise a ECRIRE dans l'arbre de l'utilisateur pour faire atterrir le travail
     * malgre son edition non committee, en la preservant par une fusion a 3 branches.
     *
     * FAUX par defaut, et ce defaut est la garde : ecrire chez lui sans son accord est la seule
     * chose que ce chantier n'a jamais eu le droit de faire. L'utilisateur l'a autorise
     * explicitement le 2026-08-27 (QCM « l'echelle complete ») ; l'appelant porte cette
     * autorisation, ce fichier ne se l'accorde pas.
     */
    preserverEditionLocale?: boolean
    onPrepared?: (agentSha: string, baseSha: string) => void
    onIntegrated?: (integratedSha: string, agentSha: string, baseSha: string) => void
  } = {}
): FinalizeResult {
  const issue = this.finalizeSansSecours(agentId, options)
  if (issue.outcome !== 'blocked' && issue.outcome !== 'conflict') return issue
  if ('rescueRef' in issue && issue.rescueRef) return issue
  // `base-dirty` ne prend PAS le chemin du sauvetage : celui-ci committe le travail en cours de la
  // copie, ce qui contredirait la garde qu'on vient d'honorer. Mais ce n'est plus un cul-de-sac —
  // on pose une adresse d'ATTENTE sur le commit deja produit, sans rien ecrire chez l'utilisateur.
  // Le tour cesse ainsi de finir sur un echec sec. Voir `poserAttenteDIntegration`.
  if (issue.outcome === 'blocked' && issue.reason === 'base-dirty') {
    /*
     * L'ECHELLE, dans l'ordre : le barreau qui ATTERRIT d'abord, l'attente ensuite.
     *
     * Le barreau 2 n'est tente que si l'appelant porte l'autorisation de l'utilisateur, et il rend
     * `undefined` au moindre doute — arbre restaure, rien d'abime. On descend alors au barreau 1,
     * qui pose une adresse d'attente. Aucun de ces deux chemins ne rend un echec sec : c'est la
     * demande explicite du 2026-08-27, « on ne finit jamais un tour sur un echec comme ca ».
     */
    let nonRemise: EditionLocaleNonRemise | undefined
    if (options.preserverEditionLocale === true) {
      const essai = this.fusionEnPreservantLEditionLocale(agentId, issue.files, () =>
        this.finalizeSansSecours(agentId, { ...options, preserverEditionLocale: false })
      )
      if (essai.issue) return essai.issue
      nonRemise = essai.nonRemise
    }
    const attente = this.poserAttenteDIntegration(agentId)
    return {
      ...issue,
      ...(attente ? { stagedRef: attente } : {}),
      ...(nonRemise ? { editionLocaleNonRemise: nonRemise } : {})
    }
  }
  const path = this.pathFor(agentId)
  if (!existsSync(path)) return issue
  return this.secureWorkBeforeRefusal(agentId, path, options.task)
    ? { ...issue, rescueRef: this.rescueRef(agentId) }
    : issue
}

/**
 * BARREAU 2 DE L'ECHELLE — faire atterrir le travail SANS ecraser l'edition non committee.
 *
 * Le refus `base-dirty` protege une chose precise : les lignes que l'utilisateur n'a pas encore
 * committees, sur les fichiers que la copie veut publier. Les deux apports ne sont pourtant pas
 * forcement incompatibles — l'un edite une extremite du fichier, l'autre l'autre bout. Git sait
 * fusionner cela ; ce qui manquait, c'est de le lui demander sans jamais risquer son travail.
 *
 * L'ORDRE EST LA GARANTIE, et il n'est pas negociable :
 *  1. une SAUVEGARDE de son etat exact est ecrite AVANT toute modification (`stash create` ne
 *     touche pas l'arbre : il fabrique un commit et rend son sha) ;
 *  2. ses editions sont rangees, la publication normale s'execute, puis ses editions reviennent en
 *     fusion a 3 branches ;
 *  3. au moindre echec — rangement impossible, publication refusee, fusion conflictuelle — son
 *     fichier est RESTAURE depuis la sauvegarde et on rend `undefined` : l'appelant retombe sur
 *     l'attente du barreau 1. Jamais un arbre a moitie fusionne, jamais un marqueur de conflit
 *     dans un fichier qu'il n'a pas demande a arbitrer.
 *
 * Ce que ce barreau ne fait PAS : committer son travail (il reste non committe, comme il l'a
 * laisse), ni arbitrer un conflit de contenu reel — celui-la lui appartient.
 */
/**
 * La fusion a 3 branches passerait-elle, SANS rien ecrire dans le depot ?
 *
 * Les trois versions (base commune, celle de l'utilisateur, celle que la fusion de la copie
 * installerait) sont extraites dans
 * un dossier temporaire, et `git merge-file` rend un code de sortie : 0 = fusion propre, > 0 =
 * conflits. Rien n'est ecrit dans l'arbre, l'index, ni un ref. En cas de doute — extraction
 * impossible, fichier binaire, erreur de git — on rend FAUX : ne pas savoir vaut refuser.
 */
export function fusionEstPropreABlanc(
  this: WorktreeManager,
  agentId: string,
  fichiers: string[]
): boolean {
  const chemin = this.pathFor(agentId)
  if (!existsSync(chemin)) return false
  const agentSha = this.tryGitFn(chemin, ['rev-parse', 'HEAD'])
  if (agentSha.code !== 0) return false
  const baseSha = this.tryGitFn(this.baseRepo, ['rev-parse', 'HEAD'])
  if (baseSha.code !== 0) return false
  /*
   * LE COTE « COPIE » EST LE RESULTAT DE LA FUSION, PAS LA COPIE SEULE.
   *
   * Ce qui atterrit chez l'utilisateur, c'est la fusion de la copie DANS sa base. Quand la copie
   * est partie d'`origin/main` et que le main local a des commits a lui (`describeForLaunch`,
   * historiques divergents), la version de la copie n'a pas ces commits : comparee a la base, elle
   * semble les ANNULER. Vecu le 2026-10-22 : une edition non commitee posee juste a
   * cote d'un commit local etait jugee en conflit, alors que git la fusionnait sans heurt — le
   * pre-vol refusait a tort, et le run retombait en `base-dirty`.
   *
   * `merge-tree --write-tree` calcule l'arbre de cette fusion sans toucher arbre, index ni ref.
   * Code 1 = la fusion elle-meme conflicte ; tout autre echec = on ne sait pas. Dans les deux cas,
   * refuser : ne pas savoir vaut refuser.
   */
  const fusion = this.tryGitFn(this.baseRepo, [
    'merge-tree',
    '--write-tree',
    baseSha.stdout.trim(),
    agentSha.stdout.trim()
  ])
  const arbreFusionne = fusion.code === 0 ? fusion.stdout.split('\n')[0]?.trim() : ''
  if (!arbreFusionne || !/^[0-9a-f]{40,64}$/i.test(arbreFusionne)) return false
  const bac = mkdtempSync(join(tmpdir(), 'autowin-fusion-blanc-'))
  try {
    for (const fichier of fichiers) {
      const versions: Record<string, string> = {}
      for (const [nom, revision] of [
        ['base', `${baseSha.stdout.trim()}:${fichier}`],
        ['agent', `${arbreFusionne}:${fichier}`]
      ] as const) {
        const contenu = this.tryGitFn(this.baseRepo, ['show', revision])
        // Un fichier absent d'un cote (ajout pur) n'est pas un conflit de contenu : cote vide.
        versions[nom] = contenu.code === 0 ? contenu.stdout : ''
      }
      const local = join(this.baseRepo, fichier)
      if (!existsSync(local)) return false
      const cheminsBac = {
        local: join(bac, 'local'),
        base: join(bac, 'base'),
        agent: join(bac, 'agent')
      }
      writeFileSync(cheminsBac.local, readFileSync(local))
      writeFileSync(cheminsBac.base, versions.base ?? '')
      writeFileSync(cheminsBac.agent, versions.agent ?? '')
      const essai = this.tryGitFn(this.baseRepo, [
        'merge-file',
        '-q',
        '-p',
        cheminsBac.local,
        cheminsBac.base,
        cheminsBac.agent
      ])
      if (essai.code !== 0) return false
    }
    return true
  } catch {
    return false
  } finally {
    supprimerArbre(bac)
  }
}

export function fusionEnPreservantLEditionLocale(
  this: WorktreeManager,
  agentId: string,
  fichiers: string[],
  publier: () => FinalizeResult
): { issue?: FinalizeResult; nonRemise?: EditionLocaleNonRemise } {
  if (fichiers.length === 0) return {}
  /*
   * PRE-VOL : DECIDER AVANT DE TOUCHER, pas apres.
   *
   * Premiere version ecrite ce jour, et fausse : elle rangeait, publiait, puis tentait le retour —
   * et sur conflit elle rendait « bloque » alors que la publication avait DEJA atterri. Un rapport
   * faux, exactement ce que ce chantier existe pour supprimer. Et rattraper cela en annulant une
   * publication deja faite ouvrirait une fenetre pire encore sur un arbre partage.
   *
   * On essaie donc la fusion A BLANC — trois versions extraites hors du depot, `git merge-file` qui
   * n'ecrit rien dans l'arbre — et on ne touche a rien tant qu'elle n'est pas propre. Un conflit
   * reel se solde alors par un `undefined` immediat : l'echelle descend a l'attente, et l'arbre de
   * l'utilisateur n'a pas bouge d'un octet.
   */
  if (!this.fusionEstPropreABlanc(agentId, fichiers)) return {}
  // 1. SAUVEGARDE D'ABORD. `stash create` n'ecrit rien dans l'arbre ni dans l'index : il rend le
  //    sha d'un commit qui porte l'etat sale. Sans ce sha, on n'ecrit pas une seule ligne.
  const snapshot = this.tryGitFn(this.baseRepo, ['stash', 'create'])
  const sauvegarde = snapshot.code === 0 ? snapshot.stdout.trim() : ''
  if (!sauvegarde) return {}
  const refSauvegarde = `refs/autowin/safety/${agentId}`
  if (this.tryGitFn(this.baseRepo, ['update-ref', refSauvegarde, sauvegarde]).code !== 0) return {}

  /** Remet son fichier exactement comme il l'avait laisse, depuis la sauvegarde. */
  const restaurer = (): void => {
    /*
     * `-c core.autocrlf=false -c core.eol=lf` : restaurer OCTET POUR OCTET.
     *
     * Sans ces deux options, git reecrit les fins de ligne selon la configuration du depot — et
     * la restauration rendait un fichier « equivalent » mais MODIFIE (mesure du 2026-08-27 :
     * LF devenus CRLF). Rendre a l'utilisateur autre chose que ce qu'il avait, meme
     * semantiquement identique, c'est deja avoir touche a son travail.
     */
    this.tryGitFn(this.baseRepo, [
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.eol=lf',
      'checkout',
      sauvegarde,
      '--',
      ...fichiers
    ])
    // `checkout <commit> -- <chemins>` met aussi l'index a jour : on le remet a HEAD pour que son
    // travail reste NON COMMITTE, ce qu'il etait avant qu'on y touche.
    this.tryGitFn(this.baseRepo, ['reset', '--quiet', 'HEAD', '--', ...fichiers])
  }

  // 2. Ranger ses editions pour degager la publication. `--` limite le rangement aux fichiers en
  //    collision : le reste de son travail en cours n'est pas deplace.
  const rangement = this.tryGitFn(this.baseRepo, [
    'stash',
    'push',
    '--quiet',
    '--include-untracked',
    '--',
    ...fichiers
  ])
  if (rangement.code !== 0) {
    restaurer()
    return {}
  }
  /*
   * LE SHA DE NOTRE REMISE, lu tout de suite. La pile `refs/stash` est PARTAGEE par tous les fils
   * du depot : au moment du retour, `stash@{0}` peut etre celle d'un autre. On ne reprend et on
   * ne retire que la notre, designee par son sha (`rangDeLaRemise`).
   */
  const lue = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', '--quiet', 'refs/stash'])
  const remise = lue.code === 0 ? lue.stdout.trim() : ''
  if (!remise) {
    // Rangement « reussi » sans remise : rien n'a bouge, on ne publie pas sur une base sale.
    restaurer()
    return {}
  }
  const retour = (publiee: boolean): EditionLocaleNonRemise | undefined =>
    this.remettreEditionLocale({ fichiers, remise, refSauvegarde, publiee, restaurer })

  let publie: FinalizeResult
  try {
    publie = publier()
  } catch (erreur) {
    /*
     * UNE ERREUR APRES LE RANGEMENT NE LAISSE PAS SES FICHIERS DANS LA PILE. Sans ce rattrapage,
     * l'exception sortait d'ici avec ses editions encore rangees — la forme exacte du 24/10 si
     * la publication venait d'atterrir. On regarde si la branche a avance, on remet en
     * consequence, puis l'erreur continue sa route.
     */
    const tete = this.tryGitFn(this.baseRepo, ['rev-parse', 'HEAD'])
    const avant = this.tryGitFn(this.baseRepo, ['rev-parse', `${remise}^1`])
    retour(tete.code === 0 && avant.code === 0 && tete.stdout.trim() !== avant.stdout.trim())
    throw erreur
  }
  if (publie.outcome !== 'merged') {
    // La publication n'a pas eu lieu : on rend son arbre a l'identique et on n'invente rien.
    const nonRemise = retour(false)
    return nonRemise ? { nonRemise } : {}
  }
  /*
   * 3. LA PUBLICATION A ATTERRI : elle est rendue comme telle, quoi qu'il arrive ensuite.
   *
   * Vecu le 2026-10-24 et reproduit en test (`index.lock` tenu par un autre geste
   * git pendant le retour) : un `stash pop` rate faisait rendre `undefined`, donc « bloque »
   * pour un travail DEJA publie, puis `stash drop` jetait la remise et le fichier restait sans
   * ses editions — elles ne survivaient que dans la sauvegarde, sans que personne le sache. Le
   * retour est maintenant VERIFIE fichier par fichier, et ce qui n'a pas pu revenir est ANNONCE.
   */
  const nonRemise = retour(true)
  return { issue: nonRemise ? { ...publie, editionLocaleNonRemise: nonRemise } : publie }
}

/** Rang (`stash@{n}`) de NOTRE remise dans la pile partagee, ou `undefined` si elle n'y est plus. */
export function rangDeLaRemise(this: WorktreeManager, remise: string): number | undefined {
  const liste = this.tryGitFn(this.baseRepo, ['stash', 'list', '--format=%H'])
  if (liste.code !== 0) return undefined
  const rang = liste.stdout
    .split('\n')
    .map((ligne) => ligne.trim())
    .indexOf(remise)
  return rang >= 0 ? rang : undefined
}

/** Contenu d'un fichier dans une revision, ou `undefined` s'il n'y existe pas. */
export function contenuA(
  this: WorktreeManager,
  revision: string,
  fichier: string
): string | undefined {
  const existe = this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${revision}:${fichier}`])
  if (existe.code !== 0) return undefined
  const lu = this.tryGitFn(this.baseRepo, ['show', `${revision}:${fichier}`])
  return lu.code === 0 ? lu.stdout : undefined
}

/**
 * Empreinte git d'un fichier tel que git le rangerait (filtres de fin de ligne compris) : celle du
 * fichier sur le disque, ou celle d'un contenu ecrit ailleurs mais lu comme `fichier`. Lecture
 * seule, SANS le verrou de l'index — c'est tout son interet quand un autre geste git le tient.
 */
export function empreinteGit(
  this: WorktreeManager,
  fichier: string,
  contenuIci?: string
): string | undefined {
  const r = this.tryGitFn(
    this.baseRepo,
    contenuIci ? ['hash-object', `--path=${fichier}`, contenuIci] : ['hash-object', '--', fichier]
  )
  return r.code === 0 ? r.stdout.trim() : undefined
}

/**
 * RETOUR DE L'EDITION LOCALE APRES LA PUBLICATION — et sa PREUVE, fichier par fichier.
 *
 * 1. Voie git : `stash pop` de NOTRE remise (git fusionne a 3 branches et tient l'index a jour).
 * 2. Verification sans verrou : pour chaque fichier, l'empreinte du disque doit egaler celle de
 *    la version attendue — sa version a lui si la publication a ete refusee, la fusion a 3
 *    branches (lui · base d'avant · nouvelle tete) si elle a atterri.
 * 3. Voie de secours, pour un fichier pas revenu : s'il est encore EXACTEMENT dans l'etat que le
 *    rangement ou la publication lui ont donne, on y ecrit la version attendue. S'il a change
 *    entre-temps (autre geste, marqueurs d'un pop rate), on n'y touche PAS : on l'annonce.
 * 4. La remise n'est retiree de la pile que si TOUS les fichiers sont prouves revenus.
 *
 * Rend `undefined` quand tout est revenu et la pile propre ; sinon, le constat a annoncer.
 */
export function remettreEditionLocale(
  this: WorktreeManager,
  opts: {
    fichiers: string[]
    remise: string
    refSauvegarde: string
    publiee: boolean
    restaurer: () => void
  }
): EditionLocaleNonRemise | undefined {
  const { fichiers, remise, refSauvegarde, publiee } = opts
  const causes: string[] = []
  const rangAvant = this.rangDeLaRemise(remise)
  if (rangAvant !== undefined) {
    const pop = this.tryGitFn(this.baseRepo, ['stash', 'pop', '--quiet', `stash@{${rangAvant}}`])
    if (pop.code !== 0) causes.push(`git stash pop : ${causeGit(pop) || `code ${pop.code}`}`)
  } else {
    causes.push('la remise de côté n’est plus dans la pile')
  }
  // Publication refusee : son etat EXACT d'avant, octet pour octet (voir `restaurer`).
  if (!publiee) opts.restaurer()

  const nonRemis: string[] = []
  let bac: string | undefined
  try {
    bac = mkdtempSync(join(tmpdir(), 'autowin-retour-edition-'))
    for (const fichier of fichiers) {
      // Sa version : la remise porte ses fichiers suivis ; un fichier non suivi est sous `^3`.
      const sienne = this.contenuA(remise, fichier) ?? this.contenuA(`${remise}^3`, fichier)
      // L'etat que le rangement ou la publication ont laisse sur le disque, avant tout retour.
      const laisse = publiee
        ? this.contenuA('HEAD', fichier)
        : this.contenuA(`${remise}^1`, fichier)
      let attendu = sienne
      if (publiee && sienne !== undefined) {
        const chemins = {
          sienne: join(bac, 'sienne'),
          base: join(bac, 'base'),
          tete: join(bac, 'tete')
        }
        writeFileSync(chemins.sienne, sienne)
        writeFileSync(chemins.base, this.contenuA(`${remise}^1`, fichier) ?? '')
        writeFileSync(chemins.tete, laisse ?? '')
        const fusion = this.tryGitFn(this.baseRepo, [
          'merge-file',
          '-q',
          '-p',
          chemins.sienne,
          chemins.base,
          chemins.tete
        ])
        attendu = fusion.code === 0 ? fusion.stdout : undefined
      }
      if (attendu === undefined) {
        nonRemis.push(fichier)
        causes.push(`${fichier} : version attendue incalculable`)
        continue
      }
      const cheminAttendu = join(bac, 'attendu')
      writeFileSync(cheminAttendu, attendu)
      const empreinteAttendue = this.empreinteGit(fichier, cheminAttendu)
      if (empreinteAttendue && this.empreinteGit(fichier) === empreinteAttendue) continue
      // Voie de secours — seulement sur un fichier que personne n'a touche depuis notre geste,
      // et jamais sur un contenu que l'aller-retour en UTF-8 aurait abime.
      const cheminLaisse = join(bac, 'laisse')
      writeFileSync(cheminLaisse, laisse ?? '')
      const intact =
        laisse !== undefined &&
        this.empreinteGit(fichier) === this.empreinteGit(fichier, cheminLaisse)
      if (!intact || attendu.includes('�')) {
        nonRemis.push(fichier)
        causes.push(
          intact
            ? `${fichier} : contenu non UTF-8, réécriture refusée`
            : `${fichier} : modifié depuis la publication, rien écrasé`
        )
        continue
      }
      copyFileSync(cheminAttendu, join(this.baseRepo, fichier))
      if (!empreinteAttendue || this.empreinteGit(fichier) !== empreinteAttendue) {
        nonRemis.push(fichier)
        causes.push(`${fichier} : réécrit mais différent de la version attendue`)
      }
    }
  } catch (erreur) {
    for (const fichier of fichiers) if (!nonRemis.includes(fichier)) nonRemis.push(fichier)
    causes.push(erreur instanceof Error ? erreur.message : String(erreur))
  } finally {
    if (bac) supprimerArbre(bac)
  }

  // 4. La remise ne quitte la pile que si tout est prouve revenu.
  const rangApres = this.rangDeLaRemise(remise)
  if (nonRemis.length === 0 && rangApres !== undefined) {
    const retrait = this.tryGitFn(this.baseRepo, [
      'stash',
      'drop',
      '--quiet',
      `stash@{${rangApres}}`
    ])
    if (retrait.code !== 0) {
      causes.push(`git stash drop : ${causeGit(retrait) || `code ${retrait.code}`}`)
    }
  }
  const resteDansLaPile = this.rangDeLaRemise(remise) !== undefined
  if (nonRemis.length === 0 && !resteDansLaPile) return undefined
  return {
    fichiers: nonRemis,
    sauvegarde: refSauvegarde,
    ...(resteDansLaPile ? { remise } : {}),
    cause: causes.join(' · ') || 'raison inconnue'
  }
}

/**
 * BARREAU 1 DE L'ECHELLE — poser une adresse d'attente, sans rien toucher chez l'utilisateur.
 *
 * `base-dirty` refuse la publication parce que l'utilisateur a du travail non committe sur les
 * MEMES fichiers. Jusqu'ici le tour s'arretait la, sur un echec. Sur un arbre partage par plusieurs
 * sessions la cause ne disparait pas d'elle-meme : mesure du 2026-08-27, le fichier en cause etait
 * `src/main/agent-pilot/agent-pilot.ts`, qu'une autre session editait, et le repechage a rejoue trois fois la
 * MEME publication avant de renoncer.
 *
 * Ce que fait ce barreau : `update-ref` sur le commit que la copie a DEJA produit. Aucun fichier
 * ecrit, aucun merge, aucun commit du travail de l'utilisateur, aucun `checkout`. Le travail devient
 * ATTEIGNABLE (`git show <ref>`) et l'etat rendu cesse d'etre un echec terminal.
 *
 * Ce qu'il ne fait pas, et qui reste interdit : le ref de SAUVETAGE (`refs/autowin/rescue/*`), qui
 * COMMITTE le travail en cours de la copie, n'est toujours pas ecrit sur cette cause — c'est cela
 * que la regle « la garde base-dirty n'ecrit AUCUN ref » protegeait vraiment.
 *
 * Fail-open : si l'adresse ne peut pas etre ecrite, on rend `undefined` et l'appelant n'annonce
 * rien. Une adresse promise mais absente serait pire que pas d'adresse (defaut du bouton
 * « Reprendre » qui ne faisait rien, mesure du 2026-08-26).
 */
export function poserAttenteDIntegration(
  this: WorktreeManager,
  agentId: string
): string | undefined {
  const ref = `refs/autowin/integration/${agentId}`
  const path = this.pathFor(agentId)
  if (!existsSync(path)) return undefined
  const sha = this.tryGitFn(path, ['rev-parse', 'HEAD'])
  if (sha.code !== 0) return undefined
  const commit = sha.stdout.trim()
  if (!commit || !this.revisionExists(commit)) return undefined
  return this.tryGitFn(this.baseRepo, ['update-ref', ref, commit]).code === 0 ? ref : undefined
}

export function finalizeSansSecours(
  this: WorktreeManager,
  agentId: string,
  options: {
    baseBranch?: string
    expectedAgentSha?: string
    task?: string
    conflictStrategy?: 'ours' | 'theirs'
    preserverEditionLocale?: boolean
    onPrepared?: (agentSha: string, baseSha: string) => void
    onIntegrated?: (integratedSha: string, agentSha: string, baseSha: string) => void
  } = {}
): FinalizeResult {
  const expectedBaseBranch = options.baseBranch ?? this.currentBaseBranch()
  const path = this.pathFor(agentId)
  if (!existsSync(path)) {
    const branch = `autowin/recovery/${agentId}`
    const ref = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', branch])
    if (ref.code !== 0) return { outcome: 'nothing', agentId }
    const restore = this.tryGitFn(this.baseRepo, [
      '-c',
      'core.longpaths=true',
      'worktree',
      'add',
      path,
      branch
    ])
    if (restore.code !== 0) {
      return {
        outcome: 'blocked',
        agentId,
        files: [],
        reason: 'merge-failed',
        detail: 'La référence de récupération existe mais sa copie n’a pas pu être restaurée.'
      }
    }
  }

  // AVANT toute écriture : si la copie n'appartient pas à cette base, on sort sans `add` ni
  // `commit`. Déclencheur réel : au démarrage, `finalize` passe sur une copie laissée par un
  // autre workspace, où un développeur a du travail non commité — le commit `agent <id>` le
  // happait sur un HEAD détaché d'un dépôt tiers avant que la garde d'après ne dise « étrangère ».
  const ownershipIssue = this.ownershipIssue(path)
  if (ownershipIssue) {
    return {
      outcome: 'blocked',
      agentId,
      files: [],
      reason: 'merge-failed',
      detail: ownershipIssue
    }
  }

  const resumedCompensation = this.resumePendingCompensation(agentId, expectedBaseBranch)
  if (resumedCompensation) return resumedCompensation

  if (options.expectedAgentSha) {
    if (this.isPublished(options.expectedAgentSha, expectedBaseBranch)) {
      return this.cleanupPublished(agentId, options.expectedAgentSha, expectedBaseBranch)
    }
    const currentSha = this.git(path, ['rev-parse', 'HEAD'])
    const currentStatus = this.git(path, ['status', '--porcelain=v1', '-z'])
    if (currentSha !== options.expectedAgentSha || currentStatus.length > 0) {
      return {
        outcome: 'blocked',
        agentId,
        files: this.changedFiles(agentId),
        reason: 'merge-failed',
        detail: 'La copie a changé après la préparation de sa publication.'
      }
    }
  }

  const existingOperationFiles = this.operationInProgress()
  if (existingOperationFiles) {
    // On refuse toujours de publier — mais plus les mains vides. Ce refus arrivait AVANT que le
    // travail de la copie soit committé : il restait donc en fichiers libres, et le rapport
    // annonçait « rien n'est publié » sans que rien ne soit atteignable autrement qu'en fouillant
    // un dossier de worktree. Mesuré le 2026-08-18 : 216 refus `base-in-progress` contre 86
    // `base-dirty`, parce que l'utilisateur travaille en continu dans la base — ce refus est la
    // norme, pas l'exception, et il ne doit pas laisser le travail sans adresse.
    //
    // Le ref de SECOURS est délibérément DISTINCT de `refs/autowin/publications/<id>` : ce dernier
    // est le candidat d'une transaction de publication dont la reprise exige `baseSha` ET `sha`
    // pour ancêtres, et y écrire tôt transformerait un réessai réparable en `merge-failed` dur dès
    // que la base avance. Séparer les deux rôles laisse la transaction et sa compensation
    // INTACTES : rien du chemin de publication n'est touché ici.
    return {
      outcome: 'blocked',
      agentId,
      files: existingOperationFiles,
      reason: 'base-in-progress',
      ...(this.secureWorkBeforeRefusal(agentId, path, options.task)
        ? { rescueRef: this.rescueRef(agentId) }
        : {})
    }
  }

  const ignoredFiles = this.preservedIgnoredFiles(path)
  if (ignoredFiles.length > 0) {
    return {
      outcome: 'blocked',
      agentId,
      files: ignoredFiles,
      // PAS `merge-failed` : aucune fusion n'est tentée ici. Mesuré le 2026-08-21 :
      // le libellé de fusion a envoyé le diagnostic chercher un conflit git inexistant.
      reason: 'ignored-deliverables',
      detail: 'La copie contient des fichiers ignorés non régénérables.'
    }
  }

  // Le commit de la copie passe par le crochet du dépôt : son refus est une issue bloquée, pas une
  // exception. Le travail reste dans la copie, et rien n'est publié.
  let commitDeCopie: { sha: string; committed: boolean }
  try {
    commitDeCopie = this.commitCopyIfDirty(agentId, path, options.task)
  } catch (erreur) {
    // fix-ok: src/main/store/worktree-manager-finalisation.ts — cause mesurée : le try enveloppait aussi `git add`, un verrou d’index était étiqueté refus du crochet.
    // Seul le refus du `git commit` est une issue bloquée ; un autre échec de la copie remonte.
    if (!(erreur instanceof RefusDuCommitDeCopie)) throw erreur
    return {
      outcome: 'blocked',
      agentId,
      files: [],
      reason: 'commit-refused',
      detail: `Commit de la copie refusé, rien n’a été publié : ${causeDuCommitDeCopie(erreur.erreurGit)}`
    }
  }
  const { sha, committed } = commitDeCopie
  const baseSha = this.git(this.baseRepo, ['rev-parse', 'HEAD'])
  options.onPrepared?.(sha, baseSha)
  // La copie n'a rien apporté au-delà de la base → rien à fusionner ; on range.
  const rangerUneCopieSansApport = (): FinalizeResult => {
    const lateCommit = this.headAdvance(path, sha)
    if (lateCommit.advanced) {
      return {
        outcome: 'blocked',
        agentId,
        files: lateCommit.files,
        reason: 'merge-failed',
        detail: 'La copie a reçu un nouveau commit avant son nettoyage.'
      }
    }
    const unpublishedFiles = this.unpublishedFiles(path)
    if (unpublishedFiles.length > 0) {
      return {
        outcome: 'blocked',
        agentId,
        files: unpublishedFiles,
        reason: 'merge-failed',
        detail: 'La copie a reçu de nouveaux fichiers avant son nettoyage.'
      }
    }
    const agentCleanup = this.cleanupAgentWorktree(agentId, path, sha)
    if (agentCleanup.advanced) {
      return {
        outcome: 'blocked',
        agentId,
        files: agentCleanup.files,
        reason: 'merge-failed',
        detail: 'La copie a reçu un nouveau commit pendant son nettoyage.'
      }
    }
    if (!agentCleanup.ok) {
      return {
        outcome: 'blocked',
        agentId,
        files: agentCleanup.files,
        reason: 'merge-failed',
        detail: 'La copie agent sans changement n’a pas pu être nettoyée.'
      }
    }
    return { outcome: 'nothing', agentId }
  }
  if (sha === baseSha) return rangerUneCopieSansApport()

  // Une copie dont le commit est INCONNU de cette base ne peut pas y être fusionnée : copie
  // laissée par un autre dépôt (le dossier de copies est partagé entre workspaces), ou objets
  // élagués. Sans cette garde, `git diff a...b` échouait en « Invalid symmetric difference
  // expression » — bruyant au démarrage, mais surtout la liste de fichiers repartait VIDE, donc
  // plus rien ne bloquait et la fusion s'enchaînait sur une copie étrangère.
  const unknown = [baseSha, sha].find((rev) => !this.revisionExists(rev))
  if (unknown) {
    return {
      outcome: 'blocked',
      agentId,
      files: [],
      reason: 'merge-failed',
      detail: `Le commit ${unknown.slice(0, 8)} n’existe pas dans ce dépôt : copie étrangère ou objets élagués.`
    }
  }

  const agentFiles = parseNullSeparatedPaths(
    this.git(this.baseRepo, ['diff', '--name-only', '-z', `${baseSha}...${sha}`])
  )
  /*
   * AUCUN FICHIER À PUBLIER = RIEN À FUSIONNER, même si `sha` n'est plus égal à HEAD.
   *
   * Cas réel : l'agent a écrit directement dans la base, sa copie est restée vide, et la base a
   * avancé entre-temps (publication d'un autre fil). Le commit de la copie est alors CONTENU dans
   * HEAD sans lui être égal : il n'y a rien à fusionner. Aller jusqu'à la publication mettait le
   * garde de `preparePublishHooks` devant une liste de fichiers VIDE ; or `git status --` sans
   * chemin couvre tout l'arbre, donc le moindre fichier non commité d'un autre fil faisait refuser
   * la transaction (`base-in-progress`, « update aborted by the reference-transaction hook »), et
   * le refus se répétait à chaque reprise. Mesuré du 05 au 07/11 : 13 refus sur 40.
   */
  if (agentFiles.length === 0) return rangerUneCopieSansApport()
  const blockingDirtyFiles = this.blockingDirtyFiles(agentFiles)
  if (blockingDirtyFiles.length > 0) {
    return {
      outcome: 'blocked',
      agentId,
      files: blockingDirtyFiles,
      reason: 'base-dirty'
    }
  }

  // Le merge potentiellement conflictuel s'exécute dans une copie éphémère appartenant à Autowin.
  // Le workspace utilisateur n'est publié que par fast-forward : il n'y a donc jamais de
  // MERGE_HEAD Autowin à attribuer puis à annuler dans la base.
  const integrationPath = join(this.worktreeRoot, `integration__${agentId}__${randomUUID()}`)
  const integrationAdd = this.tryGitFn(this.baseRepo, [
    '-c',
    'core.longpaths=true',
    'worktree',
    'add',
    '--detach',
    integrationPath,
    baseSha
  ])
  if (integrationAdd.code !== 0) {
    return {
      outcome: 'blocked',
      agentId,
      files: agentFiles,
      reason: 'merge-failed',
      detail: causeGit(integrationAdd) || undefined
    }
  }
  let integrationResult: FinalizeResult
  try {
    integrationResult = (() => {
      const merge = this.tryGitFn(integrationPath, [
        '-c',
        'commit.gpgsign=false',
        'merge',
        '--no-edit',
        ...(options.conflictStrategy ? ['-X', options.conflictStrategy] : []),
        sha
      ])
      if (merge.code !== 0) {
        const operationFiles = this.operationInProgress(integrationPath)
        const files = operationFiles ?? []
        if (operationFiles) {
          const abort = this.tryGitFn(integrationPath, ['merge', '--abort'])
          if (abort.code !== 0) {
            const mergeDetail = causeGit(merge)
            const abortDetail = causeGit(abort)
            return {
              outcome: 'blocked',
              agentId,
              files: files.length > 0 ? files : agentFiles,
              reason: 'merge-failed',
              detail: [mergeDetail, `git merge --abort: ${abortDetail || 'échec inconnu'}`]
                .filter(Boolean)
                .join('\n')
            }
          }
        }
        if (files.length > 0) {
          // La copie agent reste intacte pour une résolution assistée ultérieure.
          return { outcome: 'conflict', agentId, files, baseSha, agentSha: sha }
        }
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
          reason: 'merge-failed',
          detail: causeGit(merge) || undefined
        }
      }

      const integratedSha = this.git(integrationPath, ['rev-parse', 'HEAD'])
      const operationBeforePublish = this.operationInProgress()
      if (operationBeforePublish) {
        return {
          outcome: 'blocked',
          agentId,
          files: operationBeforePublish,
          reason: 'base-in-progress'
        }
      }
      const dirtyBeforePublish = this.blockingDirtyFiles(agentFiles)
      if (dirtyBeforePublish.length > 0) {
        return {
          outcome: 'blocked',
          agentId,
          files: dirtyBeforePublish,
          reason: 'base-dirty'
        }
      }
      if (this.git(this.baseRepo, ['rev-parse', 'HEAD']) !== baseSha) {
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
          reason: 'base-in-progress',
          detail: 'La base a avancé pendant la préparation de l’intégration.'
        }
      }

      if (!this.isExpectedBaseBranch(expectedBaseBranch)) {
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
          reason: 'base-in-progress',
          detail: 'La branche courante a changé pendant la préparation de l’intégration.'
        }
      }

      const expectedIndexTree = this.git(this.baseRepo, ['write-tree'])
      const publicationRef = this.publicationMarkerRef(agentId)
      const existingPublication = this.tryGitFn(this.baseRepo, [
        'rev-parse',
        '--verify',
        publicationRef
      ])
      let publicationSha = integratedSha
      let createPublicationMarker = false
      if (existingPublication.code === 0) {
        const candidate = existingPublication.stdout.trim()
        const validCandidate =
          this.revisionExists(candidate) &&
          this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', baseSha, candidate]).code ===
            0 &&
          this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', sha, candidate]).code === 0
        if (!validCandidate) {
          return {
            outcome: 'blocked',
            agentId,
            files: agentFiles,
            reason: 'merge-failed',
            detail: 'La transaction de publication durable ne correspond plus à ce run.'
          }
        }
        publicationSha = candidate
      } else {
        createPublicationMarker = true
      }

      const publishHooksPath = this.preparePublishHooks(
        agentId,
        integrationPath,
        baseSha,
        publicationSha,
        expectedBaseBranch,
        publicationRef,
        agentFiles,
        expectedIndexTree
      )
      if (createPublicationMarker) {
        const marker = this.tryGitFn(this.baseRepo, [
          '-c',
          `core.hooksPath=${shellPath(publishHooksPath)}`,
          'update-ref',
          publicationRef,
          integratedSha
        ])
        if (marker.code !== 0) {
          const markerDetail = causeGit(marker)
          const guarded = sortieGit(marker).includes('AUTOWIN_GUARD:')
          return {
            outcome: 'blocked',
            agentId,
            files: guarded ? this.workingTreeFiles(this.baseRepo) : agentFiles,
            reason: guarded ? 'base-in-progress' : 'merge-failed',
            detail: markerDetail || 'La transaction de publication n’a pas pu être rendue durable.'
          }
        }
      }
      options.onIntegrated?.(publicationSha, sha, baseSha)
      const publish = this.tryGitFn(this.baseRepo, [
        '-c',
        `core.hooksPath=${shellPath(publishHooksPath)}`,
        'merge',
        '--ff-only',
        publicationSha
      ])
      if (publish.code === 0 && existsSync(join(publishHooksPath, 'post-hook-change'))) {
        const hookRejected = existsSync(join(publishHooksPath, 'post-hook-rejected'))
        const compensation = this.compensatePostHookChange(
          agentId,
          publishHooksPath,
          agentFiles,
          baseSha,
          publicationSha,
          expectedBaseBranch
        )
        if (!compensation.ok) {
          return {
            outcome: 'blocked',
            agentId,
            files: compensation.files,
            reason: 'merge-failed',
            preserveAgentFiles: true,
            detail:
              compensation.detail ?? 'La publication compensée n’a pas pu être libérée sans course.'
          }
        }
        return {
          outcome: 'blocked',
          agentId,
          files: compensation.files,
          reason: hookRejected ? 'merge-failed' : 'base-in-progress',
          preserveAgentFiles: true,
          detail: hookRejected
            ? 'Le hook reference-transaction utilisateur a refusé la publication.'
            : 'L’index utilisateur a changé dans un hook pendant la publication.'
        }
      }
      if (publish.code === 0) {
        return { outcome: 'merged', agentId, committed, baseSha, publishedSha: publicationSha }
      }
      const publishDetail = causeGit(publish)
      if (existsSync(join(publishHooksPath, 'post-hook-change'))) {
        const hookRejected = existsSync(join(publishHooksPath, 'post-hook-rejected'))
        const compensation = this.compensatePostHookChange(
          agentId,
          publishHooksPath,
          agentFiles,
          baseSha,
          publicationSha,
          expectedBaseBranch,
          false
        )
        if (!compensation.ok) {
          return {
            outcome: 'blocked',
            agentId,
            files: compensation.files,
            reason: 'merge-failed',
            preserveAgentFiles: true,
            detail:
              compensation.detail ??
              'Le refus du hook n’a pas pu être compensé et libéré sans course.'
          }
        }
        return {
          outcome: 'blocked',
          agentId,
          files: compensation.files,
          reason: hookRejected ? 'merge-failed' : 'base-in-progress',
          preserveAgentFiles: true,
          detail: hookRejected
            ? 'Le hook reference-transaction utilisateur a refusé la publication.'
            : 'Le hook utilisateur a modifié le workspace ; la publication a été refusée.'
        }
      }
      if (!this.acknowledgePublication(agentId, publicationSha)) {
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
          reason: 'merge-failed',
          detail: 'La transaction refusée n’a pas pu être libérée sans course.'
        }
      }
      if (sortieGit(publish).includes('AUTOWIN_GUARD:index-changed')) {
        return {
          outcome: 'blocked',
          agentId,
          files: this.workingTreeFiles(this.baseRepo),
          reason: 'base-in-progress',
          detail: 'L’index utilisateur a changé pendant la publication.'
        }
      }

      const operationAfterPublish = this.operationInProgress()
      if (operationAfterPublish) {
        return {
          outcome: 'blocked',
          agentId,
          files: operationAfterPublish,
          reason: 'base-in-progress'
        }
      }
      if (this.git(this.baseRepo, ['rev-parse', 'HEAD']) !== baseSha) {
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
          reason: 'base-in-progress',
          detail: 'La base a avancé pendant la publication de l’intégration.'
        }
      }

      if (!this.isExpectedBaseBranch(expectedBaseBranch)) {
        return {
          outcome: 'blocked',
          agentId,
          files: agentFiles,
          reason: 'base-in-progress',
          detail: 'La branche courante a changé pendant la publication de l’intégration.'
        }
      }

      const currentDirtyFiles = this.blockingDirtyFiles(agentFiles)
      if (currentDirtyFiles.length > 0) {
        return {
          outcome: 'blocked',
          agentId,
          files: currentDirtyFiles,
          reason: 'base-dirty'
        }
      }
      return {
        outcome: 'blocked',
        agentId,
        files: agentFiles,
        reason: 'merge-failed',
        detail: publishDetail || undefined
      }
    })()
  } catch (erreur) {
    integrationResult = {
      outcome: 'blocked',
      agentId,
      files: agentFiles,
      reason: 'merge-failed',
      detail: detailFinalisationJetee(erreur)
    }
  }

  const publishHooksPath = join(integrationPath, '.autowin-publish-hooks')
  if (
    existsSync(join(publishHooksPath, 'post-hook-change')) &&
    !existsSync(join(publishHooksPath, 'compensation-complete'))
  ) {
    const durablePlan = this.readCompensationPlan(agentId)
    if (!durablePlan || durablePlan === 'invalid' || !this.compensationPlanRefsMatch(durablePlan)) {
      return {
        outcome: 'blocked',
        agentId,
        files: integrationResult.outcome === 'merged' ? agentFiles : integrationResult.files,
        reason: 'merge-failed',
        preserveAgentFiles: true,
        detail:
          (integrationResult.outcome === 'blocked' ? integrationResult.detail : undefined) ??
          'La copie d’intégration conserve les snapshots non encore promus de la compensation.'
      }
    }
  }
  const integrationCleanup = this.cleanupWorktree(integrationPath)
  if (!integrationCleanup.ok) {
    if (integrationResult.outcome !== 'merged') {
      return {
        outcome: 'blocked',
        agentId,
        files: agentFiles,
        reason: 'merge-failed',
        detail: 'La copie d’intégration en échec n’a pas pu être nettoyée.'
      }
    }
    return {
      outcome: 'cleanup-pending',
      agentId,
      files: agentFiles,
      baseSha: integrationResult.baseSha,
      publishedSha: integrationResult.publishedSha ?? sha,
      agentSha: sha,
      detail: 'La copie d’intégration n’a pas pu être nettoyée.'
    }
  }

  if (integrationResult.outcome === 'merged') {
    const lateCommit = this.headAdvance(path, sha)
    if (lateCommit.advanced) {
      return {
        outcome: 'published-residue',
        agentId,
        files: lateCommit.files,
        baseSha: integrationResult.baseSha,
        publishedSha: integrationResult.publishedSha ?? sha,
        agentSha: sha,
        detail: 'La copie a reçu un nouveau commit pendant sa publication.'
      }
    }
    const unpublishedFiles = this.unpublishedFiles(path)
    if (unpublishedFiles.length > 0) {
      return {
        outcome: 'published-residue',
        agentId,
        files: unpublishedFiles,
        baseSha: integrationResult.baseSha,
        publishedSha: integrationResult.publishedSha ?? sha,
        agentSha: sha,
        detail: 'La copie a reçu de nouveaux fichiers pendant sa publication.'
      }
    }
    const agentCleanup = this.cleanupAgentWorktree(agentId, path, sha)
    if (agentCleanup.advanced) {
      return {
        outcome: 'published-residue',
        agentId,
        files: agentCleanup.files,
        baseSha: integrationResult.baseSha,
        publishedSha: integrationResult.publishedSha ?? sha,
        agentSha: sha,
        detail: 'La copie a reçu un nouveau commit pendant son nettoyage.'
      }
    }
    if (!agentCleanup.ok) {
      if (agentCleanup.files.length > 0) {
        return {
          outcome: 'published-residue',
          agentId,
          files: agentCleanup.files,
          baseSha: integrationResult.baseSha,
          publishedSha: integrationResult.publishedSha ?? sha,
          agentSha: sha,
          detail: 'La copie a reçu de nouveaux fichiers pendant son rangement.'
        }
      }
      return {
        outcome: 'cleanup-pending',
        agentId,
        files: agentFiles,
        baseSha: integrationResult.baseSha,
        publishedSha: integrationResult.publishedSha ?? sha,
        agentSha: sha,
        detail: 'La base est publiée, mais la copie agent n’a pas pu être nettoyée.'
      }
    }
  }
  return integrationResult
}

export function isPublished(
  this: WorktreeManager,
  expectedSha: string,
  baseBranch?: string
): boolean {
  const target = baseBranch ? `refs/heads/${baseBranch}` : 'HEAD'
  return (
    this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', expectedSha, target]).code === 0
  )
}

export function publicationMarkerRef(this: WorktreeManager, agentId: string): string {
  assertSafeId(agentId, 'agentId')
  return `refs/autowin/publications/${agentId}`
}

/**
 * Référence de SECOURS : elle donne une adresse durable au travail d'un run dont la publication a
 * été refusée. Distincte de `publicationMarkerRef` À DESSEIN — celle-là est le candidat d'une
 * transaction dont la reprise valide l'ascendance ; celle-ci ne promet rien d'autre que « le
 * travail est là, atteignable, non publié ».
 *
 * Nommée en ANGLAIS comme tous les espaces de noms de refs de ce fichier (`publications`,
 * `compensations`, `locks`, `recovery`). Elle s'appelait `secours` : un juge externe a relevé le
 * 2026-08-18 que c'était le seul namespace français du dépôt, invisible à un `grep` anglais.
 */
export function rescueRef(this: WorktreeManager, agentId: string): string {
  assertSafeId(agentId, 'agentId')
  return `refs/autowin/rescue/${agentId}`
}

/**
 * Committe la copie si elle porte des changements non committés. Rend la SHA de sa tête.
 *
 * Le MÊME message que le commit de publication (`agent <id>`) est employé À DESSEIN : ce n'est pas
 * un commit de secours parallèle, c'est celui que la reprise publiera. Un libellé décoratif
 * polluait l'historique publié, et un test l'a attrapé en épinglant le message exact
 * (`worktree-recovery.integration`) — la bonne réaction était d'aligner le message, pas de
 * desserrer son assertion. Factorisé parce que `finalize` et `secureWorkBeforeRefusal` faisaient
 * la même séquence à l'identique (relevé par un juge externe).
 */
export function commitCopyIfDirty(
  this: WorktreeManager,
  agentId: string,
  path: string,
  task?: string
): { sha: string; committed: boolean } {
  const dirty = this.git(path, ['status', '--porcelain=v1', '-z']).length > 0
  if (dirty) {
    this.git(path, ['add', '-A'])
    const message = messageCommitAgent(agentId, task)
    try {
      this.git(path, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message])
    } catch (erreur) {
      throw new RefusDuCommitDeCopie(erreur)
    }
  }
  return { sha: this.git(path, ['rev-parse', 'HEAD']), committed: dirty }
}

/**
 * Le `git commit` d'une copie a échoué : le crochet du dépôt refuse, ou l'identité manque. Porte la
 * sortie de git ; distingue ce cas d'un échec de `git add`, qui n'est pas un refus.
 */
class RefusDuCommitDeCopie extends Error {
  readonly erreurGit: unknown
  constructor(erreurGit: unknown) {
    super('commit de copie refusé')
    this.erreurGit = erreurGit
  }
}

/**
 * La cause que git donne lui-même, sa sortie d'erreur. La ligne de commande de l'erreur n'est pas
 * reprise : elle contient le titre du commit.
 */
function causeDuCommitDeCopie(erreur: unknown): string {
  const sortie =
    typeof erreur === 'object' && erreur !== null && 'stderr' in erreur ? String(erreur.stderr) : ''
  return sortie.replace(/\s+/g, ' ').trim() || 'git n’a pas donné de cause'
}

/**
 * Committe le travail de la copie et lui donne une adresse durable, AVANT un refus de publication.
 *
 * Sans ça, un refus laissait le travail en fichiers libres dans un dossier de worktree : rien ne
 * le désignait, et le rapport disait « rien n'est publié » sans dire où regarder. Le geste est
 * volontairement minimal et sans effet sur la base : un commit dans la COPIE, puis un `update-ref`
 * d'une référence privée. Aucun hook de publication, aucune validation de l'arbre de
 * l'utilisateur — écrire ce ref ne touche ni sa branche, ni son index, ni ses fichiers.
 *
 * **FAIL-CLOSED sur l'ambiguïté.** Rend `true` uniquement sur preuve POSITIVE que la copie a
 * produit quelque chose. La version précédente déduisait « rien à sauver » de
 * `git rev-parse HEAD@{1}` : quand le reflog est absent (`core.logAllRefUpdates=false`, une
 * configuration git réelle et hors du contrôle de l'app), cette commande sort en 128, la garde ne
 * se déclenchait pas, et un ref était posé sur un commit STRICTEMENT INCHANGÉ en rendant `true` —
 * l'utilisateur lisait « travail atteignable » pour un travail inexistant. Un juge externe l'a
 * reproduit en isolation le 2026-08-18, sur du code déjà poussé, alors que le commentaire de cette
 * fonction affirmait exactement l'inverse. `rev-list --not --branches --remotes` répond à la vraie
 * question — « cette copie porte-t-elle des commits qu'aucune branche ne connaît ? » — sans
 * dépendre d'un reflog, et toute réponse illisible vaut refus.
 */
export function secureWorkBeforeRefusal(
  this: WorktreeManager,
  agentId: string,
  path: string,
  task?: string
): boolean {
  try {
    // Ordre choisi pour le COÛT : les lectures d'abord, et on sort au plus tôt. Ce chemin s'exécute
    // à CHAQUE refus, et un refus est la norme sur un dépôt partagé — deux tests de compensation,
    // déjà proches de leur budget, ont dépassé le délai sous charge quand la vérification
    // d'appartenance (3 appels git) était faite avant même de savoir s'il y avait quelque chose à
    // sauver. Le cas fréquent « rien à sauver » ne coûte donc plus qu'une lecture.
    const dirty = this.git(path, ['status', '--porcelain=v1', '-z']).length > 0
    if (!dirty) {
      // Répond à la vraie question — « cette copie porte-t-elle des commits qu'aucune branche ne
      // connaît ? » — sans dépendre d'un reflog. Toute réponse illisible vaut REFUS (fail-closed).
      const ahead = this.tryGitFn(path, [
        'rev-list',
        '--count',
        'HEAD',
        '--not',
        '--branches',
        '--remotes'
      ])
      if (ahead.code !== 0) return false
      if (Number.parseInt(ahead.stdout.trim() || '0', 10) === 0) return false
    }
    // JAMAIS d'écriture sans appartenance PROUVÉE, et ce contrôle vient AVANT le commit : trois
    // tests l'ont attrapé quand la sécurisation était trop large — une copie d'un autre dépôt, et
    // une copie dont l'appartenance Git est indémontrable, ne doivent recevoir AUCUNE écriture, pas
    // même un commit « pour les sauver ». Sécuriser est un service ; il ne justifie pas d'écrire là
    // où le reste du module s'interdit de toucher.
    if (this.ownershipIssue(path)) return false
    const { sha } = this.commitCopyIfDirty(agentId, path, task)
    return this.tryGitFn(this.baseRepo, ['update-ref', this.rescueRef(agentId), sha]).code === 0
  } catch {
    // Sécuriser est un BONUS : son échec ne doit jamais transformer un refus propre en exception.
    return false
  }
}

/** Supprime l'ancre transactionnelle seulement après persistance durable de la SHA publiée. */
export function acknowledgePublication(
  this: WorktreeManager,
  agentId: string,
  publishedSha: string
): boolean {
  const ref = this.publicationMarkerRef(agentId)
  const before = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
  if (before.code !== 0) return true
  if (before.stdout.trim() !== publishedSha) return false
  const deletion = this.tryGitFn(this.baseRepo, ['update-ref', '-d', ref, publishedSha])
  const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
  return deletion.code === 0 && current.code !== 0
}

/**
 * Reprend uniquement le rangement d'une copie dont la SHA est déjà dans la base.
 * Aucun commit ni merge n'est exécuté ici : une écriture tardive conserve le bureau.
 */
export function cleanupPublished(
  this: WorktreeManager,
  agentId: string,
  publishedSha: string,
  baseBranch?: string,
  agentSha = publishedSha
): FinalizeResult {
  assertSafeId(agentId, 'agentId')
  if (!this.isPublished(publishedSha, baseBranch)) {
    return {
      outcome: 'blocked',
      agentId,
      files: [],
      reason: 'merge-failed',
      detail: 'La publication annoncée n’est pas présente dans la base.'
    }
  }

  if (existsSync(this.worktreeRoot)) {
    for (const entry of readdirSync(this.worktreeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(`integration__${agentId}__`)) continue
      const cleanup = this.cleanupWorktree(join(this.worktreeRoot, entry.name))
      if (!cleanup.ok) {
        return {
          outcome: 'cleanup-pending',
          agentId,
          files: [],
          publishedSha,
          agentSha,
          detail: 'Le retour est publié ; le rangement de la copie technique sera réessayé.'
        }
      }
    }
  }

  const path = this.pathFor(agentId)
  if (!existsSync(path)) {
    const recoveryBranch = `autowin/recovery/${agentId}`
    const recoveryRef = this.tryGitFn(this.baseRepo, [
      'rev-parse',
      '--verify',
      `refs/heads/${recoveryBranch}`
    ])
    if (recoveryRef.code !== 0) return { outcome: 'merged', agentId, committed: false }
    const recoverySha = recoveryRef.stdout.trim()
    if (recoverySha !== agentSha) {
      const files = parseNullSeparatedPaths(
        this.tryGitFn(this.baseRepo, ['diff', '--name-only', '-z', `${agentSha}..${recoverySha}`])
          .stdout
      )
      return this.recoveredPublishedResidue(agentId, recoveryBranch, publishedSha, agentSha, files)
    }
    const deleteRef = this.deleteRecoveryRefIfExpected(recoveryBranch, agentSha)
    if (deleteRef.advanced) {
      return this.recoveredPublishedResidue(
        agentId,
        recoveryBranch,
        publishedSha,
        agentSha,
        deleteRef.files
      )
    }
    return deleteRef.deleted
      ? { outcome: 'merged', agentId, committed: false }
      : {
          outcome: 'cleanup-pending',
          agentId,
          files: [],
          publishedSha,
          agentSha,
          detail: 'Le retour est publié ; sa référence de récupération sera rangée plus tard.'
        }
  }
  const ownershipIssue = this.ownershipIssue(path)
  if (ownershipIssue) {
    return {
      outcome: 'cleanup-pending',
      agentId,
      files: [],
      publishedSha,
      agentSha,
      detail: ownershipIssue
    }
  }
  const lateCommit = this.headAdvance(path, agentSha)
  const unpublishedFiles = this.unpublishedFiles(path)
  if (lateCommit.advanced || unpublishedFiles.length > 0) {
    return {
      outcome: 'published-residue',
      agentId,
      files: [...new Set([...lateCommit.files, ...unpublishedFiles])],
      publishedSha,
      agentSha,
      detail: 'La copie a reçu du nouveau travail après sa publication et reste conservée.'
    }
  }
  const agentCleanup = this.cleanupAgentWorktree(agentId, path, agentSha)
  if (agentCleanup.advanced) {
    return {
      outcome: 'published-residue',
      agentId,
      files: agentCleanup.files,
      publishedSha,
      agentSha,
      detail: 'La copie a reçu un nouveau commit pendant son rangement.'
    }
  }
  if (!agentCleanup.ok) {
    if (agentCleanup.files.length > 0) {
      return {
        outcome: 'published-residue',
        agentId,
        files: agentCleanup.files,
        publishedSha,
        agentSha,
        detail: 'La copie a reçu de nouveaux fichiers pendant son rangement.'
      }
    }
    return {
      outcome: 'cleanup-pending',
      agentId,
      files: agentCleanup.files,
      publishedSha,
      agentSha,
      detail: 'Le retour est publié ; le rangement du bureau sera réessayé.'
    }
  }
  return { outcome: 'merged', agentId, committed: false }
}

/** Supprime la copie de l'agent (idempotent). */
export function remove(this: WorktreeManager, agentId: string): void {
  const path = this.pathFor(agentId)
  if (!existsSync(path)) return
  if (this.hasActiveProcesses(agentId)) {
    throw new Error(`La copie ${agentId} est encore utilisée par un CLI actif.`)
  }
  const expectedSha = this.git(path, ['rev-parse', 'HEAD'])
  const result = this.cleanupAgentWorktree(agentId, path, expectedSha)
  if (!result.ok) {
    throw new Error(`La copie ${agentId} contient encore du travail et a été conservée.`)
  }
}

/**
 * ANCRE le commit d'un bureau sur sa branche de secours, s'il apporte quelque chose.
 *
 * Le dossier d'un bureau en HEAD DETACHE est la SEULE chose qui rend son commit joignable : Git
 * compte le HEAD d'un worktree parmi ses racines, mais aucun `for-each-ref` ne le voit. Supprimer
 * le dossier sans avoir pose de ref, c'est donc rendre le commit invisible au recensement et
 * candidat au `gc` -- meme geste, meme perte, quelle que soit la porte de sortie emprunte.
 *
 * Idempotent, et volontairement SILENCIEUX en cas d'echec : poser une adresse est un filet, pas une
 * condition. Un bureau qui n'apporte rien par rapport a la base n'en recoit pas -- on ne garde pas
 * d'adresse pour du vide.
 */
export function ancrerAvantSuppression(this: WorktreeManager, agentId: string, path: string): void {
  const branche = `autowin/recovery/${agentId}`
  const tete = this.tryGitFn(path, ['rev-parse', 'HEAD'])
  if (tete.code !== 0) return
  if (!this.apporteQuelqueChose(tete.stdout.trim(), 'HEAD')) return
  this.mettreAlAbriSiDivergente(branche, tete.stdout.trim())
  this.tryGitFn(this.baseRepo, ['branch', '-f', branche, tete.stdout.trim()])
}

/**
 * GARE le travail qu'une adresse de secours porte DEJA, avant qu'on ecrive par-dessus.
 *
 * DEFAUT VECU le 2026-08-26, signale par un juge contrarian puis REPRODUIT par un test : l'identite
 * d'un bureau est STABLE par tache (`cleDeBureau` — c'est tout le levier anti-residus du 25/08), donc
 * deux tentatives sur la meme cible partagent le meme `agentId`, donc la meme adresse de secours. Un
 * `branch -f` y ecrivait sans regarder : le travail de la tentative 1, correctement ancre, etait
 * DESANCRE par l'ancrage de la tentative 2. La perte n'etait pas supprimee, seulement decalee d'un
 * cran — on ne perdait plus au premier balayage, on perdait au second.
 *
 * On n'ecrase que ce qui ne perd rien : une adresse absente, identique, ou dont le nouveau commit
 * DESCEND (fast-forward). Sinon l'ancien sommet part sous une adresse distincte, dans le meme espace
 * `autowin/recovery/` — donc toujours vue par le recensement, dont le filtre accepte ce nom.
 *
 * Un ancien sommet qui n'apporte plus rien par rapport a la base n'est pas gare : on ne garde pas
 * d'adresse pour du vide.
 */
export function mettreAlAbriSiDivergente(
  this: WorktreeManager,
  branche: string,
  nouveauSha: string
): void {
  const existant = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', `refs/heads/${branche}`])
  if (existant.code !== 0) return
  const ancien = existant.stdout.trim()
  if (!ancien || ancien === nouveauSha) return
  const descend =
    this.tryGitFn(this.baseRepo, ['merge-base', '--is-ancestor', ancien, nouveauSha]).code === 0
  if (descend) return
  if (!this.apporteQuelqueChose(ancien, 'HEAD')) return
  this.tryGitFn(this.baseRepo, ['branch', '-f', `${branche}-${ancien.slice(0, 12)}`, ancien])
}

/**
 * Abandon d'un bureau retenu.
 *
 * Se documentait « appele seulement apres confirmation UI » — ce n'etait plus vrai : `identiteDeBureau`
 * l'appelle pour RECYCLER un bureau a la tentative suivante, sans qu'aucun humain ne voie rien. On
 * ancre donc avant de balayer, comme les autres portes de sortie.
 */
/**
 * Retire les coquilles vides deja accumulees dans la racine des bureaux.
 *
 * La garde de `cleanupWorktree` tarit la PRODUCTION ; celle-ci nettoie le STOCK -- les coquilles
 * laissees avant qu'elle existe, ou par un chemin qui ne passe pas par le nettoyage (une session
 * concurrente, un `git worktree remove` lance a la main). `git worktree prune` ne les voit pas :
 * elles ne sont deja plus au registre.
 *
 * Ne retire QUE ce dont l'absence de valeur est demontree : aucun fichier hors `.git`.
 */
export function balayerLesCoquilles(this: WorktreeManager): string[] {
  /*
   * ANCRER AVANT DE BALAYER — la meme porte que `discard`, qui l'appelle deja.
   *
   * Trou trouve au cycle 2 de l'audit du 2026-08-26, a la couture de deux chantiers menes en
   * parallele. `estCoquilleVide` juge sur les FICHIERS ; or le residu que ce balayage existe pour
   * ramasser (un `git worktree remove` interrompu) laisse justement un dossier sans fichier de
   * travail mais avec un `.git` et un HEAD sur un commit ORPHELIN. La doc promettait qu'« un
   * bureau porteur de travail non repris n'est JAMAIS purge par ce chemin » : vrai quand la valeur
   * est dans les fichiers, FAUX quand elle est dans le commit.
   *
   * Et le recensement des bureaux detaches ne voit un commit que par `existsSync(bureau)` : le
   * dossier parti, le commit devient invisible pour toujours. Les deux reparations de la perte de
   * travail se detruisaient l'une l'autre a leur jonction.
   *
   * `ancrerAvantSuppression` ne pose une branche que si le commit APPORTE quelque chose : une
   * coquille sans travail propre est balayee comme avant, sans laisser de ref derriere elle.
   */
  if (existsSync(this.worktreeRoot)) {
    for (const entry of readdirSync(this.worktreeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('agent__')) continue
      const agentId = entry.name.slice('agent__'.length)
      if (!SAFE_ID.test(agentId)) continue
      const chemin = join(this.worktreeRoot, entry.name)
      if (!estCoquilleVide(chemin)) continue
      this.ancrerAvantSuppression(agentId, chemin)
    }
  }
  return balayerCoquillesVides(this.worktreeRoot)
}

export function discard(this: WorktreeManager, agentId: string): void {
  const path = this.pathFor(agentId)
  if (!existsSync(path)) return
  if (this.hasActiveProcesses(agentId)) {
    throw new Error(`La copie ${agentId} est encore utilisée par un CLI actif.`)
  }
  const ownershipIssue = this.ownershipIssue(path)
  if (ownershipIssue) throw new Error(ownershipIssue)
  this.ancrerAvantSuppression(agentId, path)
  const cleanup = this.cleanupWorktree(path, true)
  if (!cleanup.ok) {
    throw new Error(cleanup.detail ?? `La copie ${agentId} n’a pas pu être supprimée.`)
  }
}
