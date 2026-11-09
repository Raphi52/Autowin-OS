// Travail non publié, travail trié et rétention des refs : méthodes de WorktreeManager déplacées telles quelles depuis worktree-manager.ts
// (lot 3). Chacune reçoit l'instance en `this` ; elles sont rattachées au prototype
// par attacherMethodes dans worktree-manager.ts, donc les appels `this.x(...)` restent identiques.
import { createHash } from 'node:crypto'
import type { EntreeBalayage } from './balayage-retention'
import { verdictDeBureau, type VerdictBureau } from './verdict-bureau'
import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { estUneCopieDAgent } from '../copies/chemins-de-copies'
import {
  SAFE_ID,
  HEX_SHA,
  PASSE_RETENTION_TIMEOUT_MS,
  tryGitAsync,
  ARGS_REFS_RETENTION,
  type VerdictRetention,
  refsDeRetention,
  entreeDeRetention,
  cheminDeStatutPorcelain
} from './worktree-manager-outils'
import { WorktreeManager } from './worktree-manager'

/** Inventorie les copies Autowin récupérables après un arrêt du processus. */
/**
 * Les runs dont le travail est TERMINE mais JAMAIS PUBLIE : leur branche de secours existe et
 * n'est pas fusionnee dans la base.
 *
 * Mesure du 2026-08-23 : trois travaux finis et prouves ont ete perdus de vue le meme jour -- un
 * fond d'ecran, un correctif d'historique, un export Markdown. Chacun dormait sur une branche que
 * personne n'a fusionnee, pendant que l'utilisateur ecrivait « T'as toujours pas fais le fond
 * d'ecran ». Le travail existait ; rien ne le disait.
 *
 * UNE seule commande git repond, et c'est ce qui rend la question posable a chaque affichage :
 * `for-each-ref --no-merged <base>` filtre deja cote git. Ce jour-la : 14 non fusionnees sur 22.
 */
/**
 * Cette branche apporte-t-elle quelque chose que la base n'a PAS deja ?
 *
 * `--no-merged` juge sur l'ASCENDANCE, et c'est insuffisant : une branche dont le contenu est deja
 * dans la base -- parce qu'il a ete republie, repris a la main, ou passe par un cherry-pick --
 * reste signalee comme « travail non publie » pour toujours. Mesure le 2026-08-24 : l'utilisateur a
 * vu ce bandeau sur un travail bel et bien publie, et le seul moyen de l'eteindre etait une fusion
 * de scellement dont le diff etait VIDE.
 *
 * `git cherry` repond a la bonne question : il compare par `patch-id`, donc il reconnait un commit
 * REAPPLIQUE sous un autre SHA -- exactement ce qu'un cherry-pick produit. Une ligne prefixee `+`
 * est un commit dont aucun equivalent n'existe dans la base ; sans aucune, la branche n'apporte
 * rien et n'a rien a annoncer.
 *
 * COUT : un appel git par branche DEJA signalee, pas par branche existante. Le lot est petit par
 * construction, et le coordinateur met ce resultat en cache soixante secondes
 * (`travauxNonPubliesCaches`) -- ce qui etait precisement la raison d'etre de ce cache.
 *
 * En cas d'echec on repond OUI. Le bandeau doit se tromper du cote qui n'efface rien : signaler un
 * travail deja publie coute une verification, en taire un qui ne l'est pas coute le travail.
 */
/** La ref durable qui porte le verdict TRIE d'un travail. Un namespace a part : jamais fusionnee,
 * jamais poussee, et invisible de `git branch` — elle annote, elle ne represente pas du travail. */
export function refTravailTrie(this: WorktreeManager, agentId: string): string {
  return `refs/autowin/trie/${agentId}`
}

/** Le SHA marque TRIE pour ce travail, ou `undefined`. */
export function shaTravailTrie(this: WorktreeManager, agentId: string): string | undefined {
  if (!SAFE_ID.test(agentId)) return undefined
  const sortie = this.tryGitFn(this.baseRepo, [
    'rev-parse',
    '--verify',
    `${this.refTravailTrie(agentId)}^{commit}`
  ])
  return sortie.code === 0 ? sortie.stdout.trim() : undefined
}

/**
 * Enregistre « ce travail a ete TRIE » — fusion manuelle, reecriture, abandon assume.
 *
 * NE SUPPRIME RIEN, et c'est le point : la branche de secours reste le seul endroit ou ce travail
 * existe encore. On pose une annotation a cote, sur le SHA exact qui a ete juge. Rend `false`
 * quand aucun travail de ce nom n'est trouvable — marquer le vide fabriquerait un acquittement
 * qui ne protege rien.
 */
export function marquerTravailTrie(this: WorktreeManager, agentId: string): boolean {
  if (!SAFE_ID.test(agentId)) return false
  /*
   * LE TROISIEME PORTEUR : l'adresse d'ATTENTE posee par `poserAttenteDIntegration`.
   *
   * Mesure du 2026-09-12 : un travail publie-refuse pour arbre sale vit sur
   * `refs/autowin/integration/<agentId>` et NULLE PART ailleurs — ni branche de secours, ni
   * sauvetage, ni bureau (la copie avait ete nettoyee). Le recensement le listait, ce marquage
   * ne savait pas le resoudre : le bandeau criait un travail que rien ne pouvait refermer,
   * exactement le defaut que cette methode existe pour supprimer. Un gisement recense doit etre
   * un gisement marquable.
   */
  const candidats = [
    `refs/heads/autowin/recovery/${agentId}`,
    `refs/autowin/rescue/${agentId}`,
    `refs/autowin/integration/${agentId}`
  ]
  let sha: string | undefined
  for (const ref of candidats) {
    const sortie = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', `${ref}^{commit}`])
    if (sortie.code === 0) {
      sha = sortie.stdout.trim()
      break
    }
  }
  // Le bureau en HEAD detache est l'autre moitie du recensement : son commit n'a aucune ref.
  if (!sha) sha = this.headsDesBureaux().get(agentId)
  /*
   * LE QUATRIEME GISEMENT SE MARQUE AUSSI. Un bureau SALI peut n'avoir aucun commit a lui : son
   * seul travail est le diff non committe. Marquer le SHA de son HEAD ne le refermerait pas — ce
   * SHA appartient a la base et ne bouge pas. On marque donc l'EMPREINTE du diff, en plus du SHA
   * quand il existe.
   */
  const empreinte = this.empreinteBureauSali(agentId)
  const empreinteMarquee =
    empreinte !== undefined &&
    this.tryGitFn(this.baseRepo, ['config', '--local', this.cleTrieSali(agentId), empreinte])
      .code === 0
  if (!sha) return empreinteMarquee
  const shaMarque =
    this.tryGitFn(this.baseRepo, ['update-ref', this.refTravailTrie(agentId), sha]).code === 0
  return shaMarque || empreinteMarquee
}

/** Retire le verdict TRIE : le travail redevient un candidat a part entiere. */
export function oublierTravailTrie(this: WorktreeManager, agentId: string): boolean {
  if (!SAFE_ID.test(agentId)) return false
  const refOubliee =
    this.tryGitFn(this.baseRepo, ['update-ref', '-d', this.refTravailTrie(agentId)]).code === 0
  const empreinteOubliee =
    this.tryGitFn(this.baseRepo, ['config', '--local', '--unset', this.cleTrieSali(agentId)])
      .code === 0
  return refOubliee || empreinteOubliee
}

/**
 * L'ADRESSE D'UN TRAVAIL QUI N'A PAS DE SHA.
 *
 * Un bureau SALI ne porte aucun commit : son travail n'est qu'un diff. Le marquer par le SHA de
 * son HEAD serait un marquage « pour toujours » — le HEAD ne bouge pas quand l'utilisateur
 * re-modifie le bureau, donc le travail suivant naitrait deja tu. C'est exactement le defaut que
 * le verdict TRIE devait eviter pour les branches.
 *
 * L'empreinte prend donc ce qui CHANGE : le HEAD, l'etat porcelain (donc les fichiers non
 * suivis), le diff complet par rapport a HEAD, et le hash de chaque fichier non suivi (sinon un
 * fichier neuf reecrit garderait la meme empreinte). Rend `undefined` quand le bureau ne porte
 * rien : il n'y a alors rien a marquer.
 */
export function empreinteBureauSali(this: WorktreeManager, agentId: string): string | undefined {
  if (!SAFE_ID.test(agentId)) return undefined
  const bureau = this.pathFor(agentId)
  if (!existsSync(bureau) || !existsSync(join(bureau, '.git'))) return undefined
  try {
    const tete = this.git(bureau, ['rev-parse', 'HEAD']).trim()
    if (!HEX_SHA.test(tete) || /^0+$/.test(tete)) return undefined
    const etat = this.git(bureau, ['status', '--porcelain']).trim()
    if (etat.length === 0) return undefined
    const diff = this.git(bureau, ['diff', 'HEAD'])
    const contenus = etat
      .split(/\r?\n/)
      .filter((ligne) => ligne.startsWith('?? '))
      .map((ligne) => ligne.slice(3).trim().replace(/^"|"$/g, ''))
      .filter((chemin) => chemin.length > 0 && existsSync(join(bureau, chemin)))
      .map((chemin) => {
        const sortie = this.tryGitFn(bureau, ['hash-object', '--', chemin])
        return `${chemin}:${sortie.code === 0 ? sortie.stdout.trim() : 'illisible'}`
      })
    return createHash('sha256')
      .update([tete, etat, diff, ...contenus].join('\u0000'))
      .digest('hex')
  } catch {
    // Un bureau illisible ne prouve rien : sans empreinte, le travail continue de crier.
    return undefined
  }
}

/** La cle durable qui porte le verdict TRIE d'un bureau SALI (aucun objet git a creer). */
export function cleTrieSali(this: WorktreeManager, agentId: string): string {
  return `autowin-trie-sali.${agentId}.empreinte`
}

/** L'empreinte marquee TRIE pour ce bureau sali, ou `undefined`. */
export function empreinteTravailTrie(this: WorktreeManager, agentId: string): string | undefined {
  if (!SAFE_ID.test(agentId)) return undefined
  const sortie = this.tryGitFn(this.baseRepo, [
    'config',
    '--local',
    '--get',
    this.cleTrieSali(agentId)
  ])
  const valeur = sortie.code === 0 ? sortie.stdout.trim() : ''
  return /^[0-9a-f]{64}$/.test(valeur) ? valeur : undefined
}

export function apporteQuelqueChose(
  this: WorktreeManager,
  travail: string,
  baseRef: string
): boolean {
  try {
    const sortie = this.git(this.baseRepo, ['cherry', baseRef, travail])
    return sortie.split(/\r?\n/).some((ligne) => ligne.trim().startsWith('+'))
  } catch {
    return true
  }
}

/**
 * Deux chemins désignent le même dossier. fix-ok: Git et Node ne rendent pas toujours la même forme Windows (nom long ou nom court) du même dossier ; la comparaison passe par realpath.
 */
function memeDossier(a: string, b: string): boolean {
  const normaliser = (chemin: string): string => {
    let reel = resolve(chemin)
    try {
      reel = realpathSync.native(reel)
    } catch {
      // Dossier absent : on compare le chemin résolu tel quel.
    }
    return reel.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  }
  return normaliser(a) === normaliser(b)
}

/**
 * OU VIT le travail d'un agent -- sa branche de secours, ou son bureau reste en HEAD DETACHE.
 *
 * DEFAUT VECU le 2026-08-26 (run `ef845009a251-1`). Le recensement ne connaissait qu'une seule
 * adresse : `autowin/recovery/<id>`. Or l'orchestrateur laisse aussi des bureaux en HEAD detache,
 * dont le commit n'est reference par AUCUNE ref -- invisible a tout `for-each-ref`, donc invisible
 * au bandeau, a l'IPC et a l'agent. L'utilisateur a demande « fusionne », l'agent a repondu « rien
 * a fusionner », et le commit `7467f237` etait la, dans le bureau, a cote.
 *
 * La branche de secours PRIME quand elle existe : c'est l'adresse durable, celle qui survit a la
 * suppression du bureau. Le HEAD detache n'est que le dernier recours -- mais c'est precisement
 * celui qui manquait.
 */
/**
 * Le HEAD de CHAQUE bureau, en UNE commande. `git worktree list --porcelain` rend deja tout ce
 * qu'un `rev-parse` par dossier allait rechercher un par un.
 */
export function headsDesBureaux(this: WorktreeManager): Map<string, string> {
  const heads = new Map<string, string>()
  let dossier: string | undefined
  try {
    for (const ligne of this.git(this.baseRepo, ['worktree', 'list', '--porcelain']).split(
      /\r?\n/
    )) {
      if (ligne.startsWith('worktree ')) {
        const nom = ligne
          .slice('worktree '.length)
          .trim()
          .replace(/[\\/]+$/, '')
        const base = nom.split(/[\\/]/).pop() ?? ''
        const parent = nom.slice(0, nom.length - base.length)
        // fix-ok: une copie posée directement sous la racine unique se recense par son nom nu, donc son HEAD est pris en compte ; les copies d'avant gardent le préfixe agent__.
        const sousLaRacineUnique = memeDossier(parent, this.racineCopiesDeTaches)
        dossier = base.startsWith('agent__')
          ? base.slice('agent__'.length)
          : sousLaRacineUnique && estUneCopieDAgent(base)
            ? base
            : undefined
        if (dossier !== undefined && !SAFE_ID.test(dossier)) dossier = undefined
      } else if (ligne.startsWith('HEAD ') && dossier !== undefined) {
        const sha = ligne.slice('HEAD '.length).trim()
        if (HEX_SHA.test(sha)) heads.set(dossier, sha)
        dossier = undefined
      }
    }
  } catch {
    // Un depot qui ne repond pas ne prouve AUCUNE perte : on n'annonce rien plutot que d'alarmer.
  }
  return heads
}

/**
 * Un commit qu'AUCUNE ref ne contient : la signature d'un travail fabrique dans un bureau.
 *
 * LA POLARITE DU REPLI EST LE POINT. L'audit du 2026-08-26 a releve que ce `catch` rendait
 * `false` -- donc « pas orphelin », donc INVISIBLE -- alors que son voisin `apporteQuelqueChose`
 * rend `true`, et que ce fichier ecrit deux fois la regle : « le bandeau doit se tromper du cote
 * qui n'efface rien ». Sur cet arbre partage ou plusieurs sessions verrouillent l'index, un
 * `for-each-ref` qui echoue transitoirement faisait donc disparaitre un travail reel, sans trace.
 *
 * Le SHA nul (`0000…`) est un cas a part et il est REEL sur ce depot : un bureau pose sur une
 * branche non nee. `for-each-ref --contains` leve dessus (exit 129), et le rattraper en « a
 * signaler » inventerait un travail qui n'existe pas. On l'ecarte explicitement, au lieu de
 * dependre de l'ordre d'evaluation du `&&` en aval.
 */
export function estOrphelin(this: WorktreeManager, sha: string): boolean {
  if (/^0+$/.test(sha)) return false
  try {
    return !this.git(this.baseRepo, [
      'for-each-ref',
      '--contains',
      sha,
      '--count=1',
      '--format=%(refname)'
    ]).trim()
  } catch {
    // Se tromper du cote qui n'efface rien : un depot qui ne repond pas ne prouve pas l'absence.
    return true
  }
}

/**
 * Un bureau porte-t-il du travail JAMAIS COMMITTE ?
 *
 * Tout le reste du recensement juge sur des commits — branche de secours, commit orphelin, ref de
 * sauvetage. Reproduit en direct le 2026-08-26 : une demande reelle a produit un livrable
 * (`HomeView.css`, +7/-3, plus un test neuf), l'orchestration s'est arretee au controle final, et
 * l'agent a repondu « le livrable est en place et vert ». Le travail n'a jamais ete committe : il
 * dormait, modifie, dans son bureau, invisible de tous les ecrans.
 *
 * C'est le cas le plus couteux des trois, parce qu'il suit une annonce de succes.
 */
export function bureauPorteDuTravailNonCommitte(this: WorktreeManager, agentId: string): boolean {
  if (!SAFE_ID.test(agentId)) return false
  const bureau = this.pathFor(agentId)
  if (!existsSync(bureau)) return false
  /*
   * SANS SON `.git`, UN DOSSIER DE BUREAU N'EST PLUS UN BUREAU — et git ne dit pas non pour
   * autant : il REMONTE au depot parent. `rev-parse HEAD` rend alors le HEAD de la base et
   * `status --porcelain` les modifications de l'ARBRE PRINCIPAL, attribuees a un bureau qui
   * n'existe plus. Le garde-fou du HEAD non ne ne mord pas : ce sha est parfaitement valide.
   *
   * DEFAUT VECU le 2026-08-27 : apres `git worktree remove`, le dossier survivait
   * en portant son seul `node_modules` (non versionne, donc non supprime par git). Le
   * recensement a signale les quatre fichiers en cours de l'utilisateur dans main comme
   * « travail non publie » du bureau `run-bac93a8f28b6-1`. Le `.git` d'un worktree lie est un
   * FICHIER : sa presence est le discriminant exact entre un bureau et une coquille.
   */
  if (!existsSync(join(bureau, '.git'))) return false
  try {
    /*
     * UN HEAD NON NE N'EST PAS DU TRAVAIL. `checkout --orphan` laisse l'index rempli des fichiers
     * de la base : `status --porcelain` les rend tous AJOUTES, et le bureau parait porter un
     * chantier entier alors qu'il n'a rien produit. Un test existant protegeait deja ce bord
     * (`reste MUET sur un bureau pose sur une branche NON NEE`) et il a bien mordu.
     *
     * `rev-parse HEAD` leve sur une branche jamais commitee : c'est exactement le discriminant.
     */
    const tete = this.git(bureau, ['rev-parse', 'HEAD']).trim()
    if (!HEX_SHA.test(tete) || /^0+$/.test(tete)) return false
    return this.git(bureau, ['status', '--porcelain']).trim().length > 0
  } catch {
    // Un bureau illisible ne prouve AUCUNE perte : on n'invente pas un travail pour alarmer.
    return false
  }
}

export function commitDuTravail(this: WorktreeManager, agentId: string): string | undefined {
  if (!SAFE_ID.test(agentId)) return undefined
  const secours = `autowin/recovery/${agentId}`
  if (this.revisionExists(secours)) return secours
  /*
   * LE SAUVETAGE EST UN PORTEUR LEGITIME, pas un residu.
   *
   * Quand la publication echoue, le travail est pose sur `refs/autowin/rescue/<agentId>` pour
   * rester atteignable APRES disparition du bureau. Sans cette lecture, un travail correctement
   * sauve devient introuvable des que sa copie est nettoyee : douze refs accumulees depuis le
   * 16/08 sur le depot reel, dont trois du 2026-08-26, qu'aucun ecran ne montrait.
   *
   * En DERNIER recours : un bureau encore present porte l'etat le plus recent, le sauvetage n'est
   * qu'un filet.
   */
  const sauvetage = `refs/autowin/rescue/${agentId}`
  const bureau = this.pathFor(agentId)
  if (!existsSync(bureau)) return this.revisionExists(sauvetage) ? sauvetage : undefined
  try {
    const sha = this.git(bureau, ['rev-parse', 'HEAD']).trim()
    if (!HEX_SHA.test(sha)) return undefined
    /*
     * LE DISCRIMINANT : un bureau ne compte que si son commit est ORPHELIN.
     *
     * Faux positif mesure sur le vrai depot juste apres le premier jet : SIX bureaux signales pour
     * UN seul vrai travail. Un bureau simplement OUVERT sur une base divergente « apporte » des
     * commits au sens de `git cherry`, sans avoir rien produit -- et cinq cris pour un signal,
     * c'est le defaut du 2026-08-24 rouvert (un bandeau qu'on n'ecoute plus).
     *
     * Un commit fabrique par l'agent dans son bureau detache n'est contenu dans AUCUNE ref ; une
     * base, par construction, en a une. `--contains` tranche donc exactement la bonne question.
     */
    return this.estOrphelin(sha) ? sha : undefined
  } catch {
    // Un bureau sans `.git` lisible ne prouve aucune perte : on ne l'invente pas.
    return undefined
  }
}

/**
 * RECENSE l'etat de retention du depot -- LECTURE SEULE, aucune suppression, aucun ref touche.
 *
 * Alimente `planifierBalayage` avec ce que git sait vraiment :
 *  - les branches `autowin/*` et les refs `refs/autowin/*` ;
 *  - `apporteQuelqueChose` par EMPREINTE DE CORRECTIF (`git cherry`), jamais par ascendance : une
 *    publication par cherry-pick recree le commit sous un autre SHA, et l'ascendance seule
 *    signalait donc pour toujours un travail deja en base (cause tranchee le 2026-08-24) ;
 *  - `shaConsigne` par la presence du SHA dans les registres verses au depot.
 *
 * Les marqueurs `trie/` ne sont PAS interroges par `git cherry` : ils annotent un travail, ils
 * n'en portent pas. Les questionner couterait un appel git par marqueur -- 152 sur ce depot le
 * 2026-09-08 -- pour une reponse que la regle ignore de toute facon.
 */
export function recenserRetention(
  this: WorktreeManager,
  consigne: (sha: string) => boolean
): EntreeBalayage[] {
  return this.verdictsRetention().map((v) =>
    entreeDeRetention(v.candidat, v.apporteQuelqueChose, consigne)
  )
}

/**
 * La part GIT du recensement, sans la consigne : c'est elle que le worker execute, parce qu'une
 * fonction (`consigne`) ne traverse pas `postMessage`. La regle reste appliquee cote appelant.
 */
export function verdictsRetention(this: WorktreeManager): VerdictRetention[] {
  const lignes = this.tryGitFn(this.baseRepo, ARGS_REFS_RETENTION)
  if (lignes.code !== 0) return []
  return refsDeRetention(lignes.stdout, Date.now()).map((candidat) => ({
    candidat,
    apporteQuelqueChose:
      candidat.famille === 'trie'
        ? false
        : this.tryGitFn(this.baseRepo, ['cherry', 'HEAD', candidat.nom]).stdout.includes('+')
  }))
}

/**
 * MEME RECENSEMENT, SANS FIGER LA FENETRE — c'est la version que le demarrage doit appeler.
 *
 * Le prix ne change pas (un `git cherry` par ref) ; ce qui change, c'est qu'il est paye dans des
 * processus fils attendus un par un, la boucle d'evenements restant libre entre deux. Mesure du
 * 2026-09-08 : la version synchrone tenait le thread principal 11 720 ms au demarrage, pendant la
 * construction de la fenetre. La regle, elle, est partagee mot pour mot avec `recenserRetention`.
 */
export async function recenserRetentionAsync(
  this: WorktreeManager,
  consigne: (sha: string) => boolean,
  executerInjecte?: (repo: string, args: string[]) => Promise<{ code: number; stdout: string }>
): Promise<EntreeBalayage[]> {
  /*
   * DANS LE WORKER des qu'il existe (2026-10-16). `execFile` n'attend pas git sur
   * le fil principal, mais il y CREE chaque processus — synchrone sous Windows. Une passe = 78
   * processus sur ce depot (631 ms cumulees a vide), et `gels.jsonl` porte 3 gels
   * `spawn git cherry` de 3,7 a 8,8 s, tous dans la passe du demarrage. Dans le worker, les memes
   * commandes calent le worker, jamais la fenetre.
   */
  if (!executerInjecte && this.operationClient) {
    const verdicts = await this.operationClient.run<VerdictRetention[]>(
      { operation: 'verdictsRetention' },
      {},
      { timeoutMs: PASSE_RETENTION_TIMEOUT_MS }
    )
    return verdicts.map((v) => entreeDeRetention(v.candidat, v.apporteQuelqueChose, consigne))
  }
  const executer = executerInjecte ?? tryGitAsync
  const lignes = await executer(this.baseRepo, ARGS_REFS_RETENTION)
  if (lignes.code !== 0) return []
  const entrees: EntreeBalayage[] = []
  for (const candidate of refsDeRetention(lignes.stdout, Date.now())) {
    const apporteQuelqueChose =
      candidate.famille === 'trie'
        ? false
        : (await executer(this.baseRepo, ['cherry', 'HEAD', candidate.nom])).stdout.includes('+')
    entrees.push(entreeDeRetention(candidate, apporteQuelqueChose, consigne))
  }
  return entrees
}

/**
 * CE BUREAU PRECIS PEUT-IL PORTER DU TRAVAIL ? — question a UN bureau, prix d'UN bureau.
 *
 * DEFAUT MESURE le 2026-09-04 : `edit_file` commence par demander la liste COMPLETE
 * des travaux non publies (`travauxNonPublies` + apercu, jusqu'a 100 entrees) uniquement pour
 * savoir si LE bureau qu'il s'apprete a prendre porte deja quelque chose. Sur ce depot, avec 40
 * copies accumulees, ce recensement coute 18 699 ms MESURES — payes avant la moindre edition, et
 * dans le meme budget que l'operation worktree : au-dela du delai, l'edition echoue avec
 * « Operation worktree interrompue », sans qu'aucune ligne n'ait ete ecrite. Le cout croit avec
 * le nombre de copies : allonger le delai ne fait que deplacer le mur.
 *
 * La sortie courte est SURE parce qu'elle est NEGATIVE : sans dossier de bureau, sans branche de
 * secours et sans sauvetage pour cet identifiant, le recensement ne pouvait rien trouver non
 * plus. Des que l'un des trois existe, on repasse par le recensement complet — meme reponse.
 */
export function bureauPeutPorterDuTravail(this: WorktreeManager, agentId: string): boolean {
  if (!SAFE_ID.test(agentId)) return false
  if (existsSync(this.pathFor(agentId))) return true
  for (const ref of [`refs/heads/autowin/recovery/${agentId}`, `refs/autowin/rescue/${agentId}`]) {
    if (this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', '--quiet', ref]).code === 0) {
      return true
    }
  }
  return false
}

export function travauxNonPublies(this: WorktreeManager, baseRef = 'HEAD'): string[] {
  try {
    const branches = this.git(this.baseRepo, [
      'for-each-ref',
      '--no-merged',
      baseRef,
      '--format=%(refname:strip=4)',
      'refs/heads/autowin/recovery/'
    ])
      .split('\n')
      .map((ligne) => ligne.trim())
      .filter((agentId) => SAFE_ID.test(agentId))
      .filter((agentId) => !WorktreeManager.ARCHIVE_SALVAGE.test(agentId))
    /*
     * LES BUREAUX EN HEAD DETACHE, l'autre moitie du recensement (cf. `commitDuTravail`).
     *
     * Le scan de dossiers est le SEUL moyen de les voir : leur commit n'a pas de ref. Le cout est
     * un `rev-parse` par bureau -- borne par le nombre de bureaux vivants, et paye seulement ici.
     * `apporteQuelqueChose` (patch-id) fait ensuite le tri, exactement comme pour les branches :
     * un bureau vide, ou dont le travail a deja ete repris a la main, ne dit rien.
     */
    const detaches = this.listAgentIds().filter((agentId) => !branches.includes(agentId))
    /*
     * UN SEUL `git worktree list` POUR TOUS LES HEADS, et un verdict MEMOISE PAR SHA.
     *
     * Mesure du 2026-08-26 sur ce depot : la version naive faisait quatre processus git par
     * bureau -- 76 au total, 10,4 SECONDES. Deux gachis se cumulaient : un `rev-parse` par bureau
     * alors qu'une seule commande les rend tous, et le meme sha reteste autant de fois qu'il y a
     * de bureaux poses dessus (dix-neuf bureaux ne portaient que six shas distincts, la plupart
     * des bases partagees).
     */
    const heads = this.headsDesBureaux()
    const verdictParSha = new Map<string, boolean>()
    const apporte = (sha: string): boolean => {
      const connu = verdictParSha.get(sha)
      if (connu !== undefined) return connu
      const verdict = this.estOrphelin(sha) && this.apporteQuelqueChose(sha, baseRef)
      verdictParSha.set(sha, verdict)
      return verdict
    }
    /*
     * LE TROISIEME GISEMENT : les travaux SAUVES dont le bureau n'existe plus.
     *
     * Les deux recensements ci-dessus couvrent les branches de secours et les bureaux encore
     * poses sur le disque. Ils manquent le cas ou la publication a echoue PUIS la copie a ete
     * nettoyee : le commit ne survit alors que par `refs/autowin/rescue/<agentId>`, qu'aucun des
     * deux ne regarde. C'est exactement le travail que l'utilisateur finit par refaire.
     *
     * Meme filtre de CONTENU que les autres (`apporteQuelqueChose`, patch-id) : un sauvetage deja
     * repris dans la base se tait. Les deux bords comptent — taire un travail perdu le fait
     * refaire, crier sur un travail publie fabrique le bandeau qu'on n'ecoute plus.
     */
    const sauvetages = this.git(this.baseRepo, [
      'for-each-ref',
      '--format=%(refname:strip=3)',
      'refs/autowin/rescue/'
    ])
      .split('\n')
      .map((ligne) => ligne.trim())
      .filter((agentId) => SAFE_ID.test(agentId))
      .filter((agentId) => !branches.includes(agentId) && !detaches.includes(agentId))
      .filter((agentId) => this.apporteQuelqueChose(`refs/autowin/rescue/${agentId}`, baseRef))
    /*
     * CINQUIEME GISEMENT : les travaux poses sur une ADRESSE D'ATTENTE.
     *
     * Quand la publication est refusee parce que l'arbre principal est SALE,
     * `poserAttenteDIntegration` depose le commit sur `refs/autowin/integration/<agentId>`. Si la
     * copie est ensuite nettoyee, cette adresse devient le SEUL porteur du travail : ni branche de
     * secours, ni sauvetage, ni bureau. Aucun des quatre gisements ci-dessus ne la regarde.
     *
     * Mesure du 2026-09-12 : 26 adresses d'attente dormaient dans le depot, dont
     * QUATRE portant du travail jamais applique — invisibles au bandeau, donc jamais triees. Le
     * defaut est exactement celui du troisieme gisement, une porte plus loin : un travail que
     * l'utilisateur finit par refaire parce que rien ne le lui montre.
     *
     * Meme filtre de CONTENU que les autres (`apporteQuelqueChose`, patch-id) : une adresse dont
     * le travail est deja repris dans la base se tait.
     */
    const attentes = this.git(this.baseRepo, [
      'for-each-ref',
      '--format=%(refname:strip=3)',
      'refs/autowin/integration/'
    ])
      .split(/\r?\n/)
      .map((ligne) => ligne.trim())
      .filter((agentId) => SAFE_ID.test(agentId))
      .filter(
        (agentId) =>
          !branches.includes(agentId) &&
          !detaches.includes(agentId) &&
          !sauvetages.includes(agentId)
      )
      .filter((agentId) => this.apporteQuelqueChose(`refs/autowin/integration/${agentId}`, baseRef))
    /*
     * QUATRIEME GISEMENT : le travail jamais committe. Un bureau simplement PROPRE reste tu — sinon
     * chaque bureau ouvert crierait, et c'est ainsi qu'on fabrique le bandeau qu'on n'ecoute plus.
     */
    const salis = this.listAgentIds().filter((agentId) => {
      if (!this.bureauPorteDuTravailNonCommitte(agentId)) return false
      /*
       * Le verdict TRIE porte ici l'EMPREINTE du diff, jamais l'identifiant seul : re-modifier le
       * bureau change l'empreinte, donc le travail ressort de lui-meme.
       */
      const empreinte = this.empreinteBureauSali(agentId)
      return empreinte === undefined || this.empreinteTravailTrie(agentId) !== empreinte
    })
    /*
     * LE TROISIEME VERDICT, celui qui manquait : TRIE.
     *
     * `git cherry` ne connait que deux reponses — applique au patch-id pres, ou pas. Il ne voit
     * donc PAS une reecriture : un travail deja repris dans la base sous une meilleure forme
     * compte comme non publie, a jamais. Mesure le 2026-08-27 : deux salvages
     * successifs concluent « SUPERSEDED, deja dans main », conservent les branches comme le
     * protocole l'exige, et le bandeau repasse identique trente secondes plus tard. Aucun geste
     * ne pouvait le refermer, parce que rien n'enregistrait la conclusion.
     *
     * Le marquage porte le SHA du travail trie, jamais l'identifiant seul : une branche qui
     * REPREND ressort d'elle-meme. Un marquage « pour toujours » aurait remplace un bandeau qui
     * crie par un bandeau qui se tait, ce qui est pire — c'est le defaut d'origine du 2026-08-23.
     */
    const trie = (agentId: string, sha: string | undefined): boolean =>
      sha !== undefined && this.shaTravailTrie(agentId) === sha
    const shaDe = (ref: string): string | undefined => {
      const sortie = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', `${ref}^{commit}`])
      return sortie.code === 0 ? sortie.stdout.trim() : undefined
    }
    return [
      ...new Set([
        ...branches.filter(
          (agentId) =>
            this.apporteQuelqueChose(`autowin/recovery/${agentId}`, baseRef) &&
            !trie(agentId, shaDe(`refs/heads/autowin/recovery/${agentId}`))
        ),
        ...detaches.filter((agentId) => {
          const sha = heads.get(agentId)
          return sha !== undefined && apporte(sha) && !trie(agentId, sha)
        }),
        ...sauvetages.filter((agentId) => !trie(agentId, shaDe(`refs/autowin/rescue/${agentId}`))),
        ...attentes.filter(
          (agentId) => !trie(agentId, shaDe(`refs/autowin/integration/${agentId}`))
        ),
        ...salis
      ])
    ].filter((agentId) => !WorktreeManager.EDITION_OUTIL.test(agentId))
  } catch {
    // Un depot qui ne repond pas ne prouve AUCUNE perte : on n'annonce rien plutot que d'alarmer.
    return []
  }
}

/**
 * De quoi est fait un travail non publie -- pour les PREMIERS seulement.
 *
 * Le sujet du commit de secours ne sert a rien : il repete l'identifiant de la copie (« travail
 * preserve de la copie command-edit-04789dcc… »). Verifie le 2026-08-23 sur les 14 branches. Le
 * seul label qu'un humain reconnait, ce sont les FICHIERS touches -- « app-shell.css », il sait
 * ce que c'est ; un UUID, non.
 *
 * BORNE a `limite` branches, et c'est le point de conception : lister les fichiers coute un appel
 * git PAR branche. On ne paie donc que ce qui sera reellement AFFICHE (trois), jamais les
 * quatorze. Le COMPTE, lui, reste gratuit -- une seule commande, cf. `travauxNonPublies`.
 */
export function apercuTravauxNonPublies(
  this: WorktreeManager,
  baseRef = 'HEAD',
  limite = 3
): Array<{
  agentId: string
  date: string
  fichiers: string[]
  verdict: VerdictBureau
  /** VRAI quand `fichiers` est l'echo d'une lecture ratee, pas une constatation de vide. */
  lectureEchouee?: boolean
}> {
  return this.travauxNonPublies(baseRef)
    .slice(0, Math.max(0, limite))
    .map((agentId) => {
      const commit = this.commitDuTravail(agentId)
      const branche = commit ?? `autowin/recovery/${agentId}`
      let fichiers: string[] = []
      let date = ''
      let lectureEchouee = false
      try {
        fichiers = this.git(this.baseRepo, ['diff', '--name-only', `${baseRef}...${branche}`])
          .split('\n')
          .map((ligne) => ligne.trim())
          .filter(Boolean)
        date = this.git(this.baseRepo, [
          'log',
          '-1',
          '--format=%cd',
          '--date=short',
          branche
        ]).trim()
      } catch {
        // Une branche illisible ne doit pas faire disparaitre les autres du bandeau -- mais elle
        // ne doit PAS NON PLUS passer pour un bureau vide : en aval, `decisionDeReutilisation`
        // jetait le bureau sur ce silence. On DIT que la lecture a echoue.
        lectureEchouee = true
      }
      /*
       * REPLI : LES FICHIERS DU BUREAU, quand il n'y a aucun commit a diffuser.
       *
       * Un bureau au travail jamais committe n'a ni branche de secours ni commit orphelin : le
       * `diff` ci-dessus ne peut RIEN nommer. Sans ce repli, le bandeau annonce « travail non
       * publie » sans dire lequel — or le seul label qu'un humain reconnait, ce sont les fichiers.
       * Constate le 2026-08-26 : trois bureaux recenses, trois fois `fichiers: []`.
       */
      if (!fichiers.length) {
        const bureau = this.pathFor(agentId)
        if (existsSync(bureau)) {
          try {
            const sales = this.git(bureau, ['status', '--porcelain'])
              .split('\n')
              .map((ligne) => cheminDeStatutPorcelain(ligne))
              .filter(Boolean)
            if (sales.length) {
              fichiers = sales
              lectureEchouee = false
            }
          } catch {
            // Le bureau ne repond pas : on garde l'indetermination deja posee, on n'invente rien.
          }
        }
      }
      // Le VERDICT accompagne la liste : sans lui, il faut ouvrir chaque patch pour savoir si
      // un bureau vaut quelque chose — le tri manuel que ce chantier existe pour supprimer.
      return {
        agentId,
        date,
        fichiers,
        verdict: verdictDeBureau({ fichiers, aUnCommit: !!commit, lectureEchouee }),
        ...(lectureEchouee ? { lectureEchouee } : {})
      }
    })
}

/**
 * Le PATCH d'un travail non publie, pour le lire avant d'en decider.
 *
 * Constate le 2026-08-23 : aucune vue de l'app ne listait ces travaux. La vue Workspace ne montre
 * que les bureaux VIVANTS -- elle affichait « 0 bureau » alors que 14 travaux attendaient. Sans un
 * moyen de les LIRE, la seule option restante etait de fusionner ou supprimer a l'aveugle.
 *
 * Borne en taille : un patch de plusieurs milliers de lignes n'est pas lisible dans un panneau, et
 * le transporter par IPC pour rien coute. On tronque, et on le DIT.
 */
export function patchTravailNonPublie(
  this: WorktreeManager,
  agentId: string,
  baseRef = 'HEAD',
  maxCaracteres = 20_000
): { patch: string; tronque: boolean } {
  if (!SAFE_ID.test(agentId)) return { patch: '', tronque: false }
  const travail = this.commitDuTravail(agentId)
  if (!travail) return { patch: '', tronque: false }
  try {
    const patch = this.git(this.baseRepo, ['diff', `${baseRef}...${travail}`])
    return patch.length > maxCaracteres
      ? { patch: patch.slice(0, maxCaracteres), tronque: true }
      : { patch, tronque: false }
  } catch {
    return { patch: '', tronque: false }
  }
}

/**
 * RECREER la copie d'un travail a partir de sa branche de secours.
 *
 * Le chemin etait DOCUMENTE (« restaure par `git worktree add <chemin> autowin/recovery/<id>` »)
 * mais jamais cable. Consequence mesuree le 2026-08-23 : une fois la garde de reprise desserree,
 * la reprise partait quand meme en `merge-failed` -- il n'y avait plus de copie a partir de
 * laquelle fusionner. Ouvrir la porte ne sert a rien si la route derriere est coupee.
 *
 * Rend `true` si une copie utilisable existe apres l'appel -- y compris si elle existait deja.
 */
export function restaurerCopieDepuisSecours(this: WorktreeManager, agentId: string): boolean {
  if (!SAFE_ID.test(agentId)) return false
  const chemin = this.pathFor(agentId)
  if (existsSync(chemin)) return true
  try {
    // `git worktree add` echoue si la branche est deja extraite ailleurs : c'est une protection,
    // pas un obstacle a contourner. On laisse l'echec remonter en `false`.
    this.git(this.baseRepo, [
      '-c',
      'core.longpaths=true',
      'worktree',
      'add',
      chemin,
      `autowin/recovery/${agentId}`
    ])
    return existsSync(chemin)
  } catch {
    return false
  }
}

/**
 * Meme geste que `restaurerCopieDepuisSecours`, sans tenir le thread principal.
 * Mesure (`gels.jsonl`, 2026-10-10 06:58) : la forme synchrone de `git worktree add` a fige
 * l'app 6 416 ms puis 2 460 et 2 982 ms, appelee depuis les chemins async du coordinateur.
 */
export async function restaurerCopieDepuisSecoursAsync(
  this: WorktreeManager,
  agentId: string,
  executer: (
    repo: string,
    args: string[]
  ) => Promise<{ code: number; stdout: string }> = tryGitAsync
): Promise<boolean> {
  if (!SAFE_ID.test(agentId)) return false
  const chemin = this.pathFor(agentId)
  if (existsSync(chemin)) return true
  const r = await executer(this.baseRepo, [
    '-c',
    'core.longpaths=true',
    'worktree',
    'add',
    chemin,
    `autowin/recovery/${agentId}`
  ])
  return r.code === 0 && existsSync(chemin)
}
