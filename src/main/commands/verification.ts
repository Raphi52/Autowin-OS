// Commande `verify` : choix de la copie, lancement du script et portée du vert — méthodes de AppCommandBus
// sorties de commands.ts telles quelles (lot 6).
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { spawn } from 'node:child_process'
import { suivreArbre, tuerArbre } from '../verify/verify-extinction'
import { decoderSortieConsole, pageDeCodeConsole } from '../app/console-encoding'
import {
  capVerifyOutput,
  decideRelatedVerify,
  cibleDeVerification,
  decideVerifyCommand,
  decideVerifyScript,
  libelleDuVerifyCible,
  TYPES_DE_VERIFICATION,
  porteeDuVert,
  VERIFY_RELATED_ANGLE_MORT,
  porteeDerivableDesChangements,
  verifyTimeoutMs,
  verifyTimeoutOutcome,
  type VerifyOutcome
} from './verify-command'
import { battementDeVerification, VERIFY_BATTEMENT_MS } from '../verify/verify-battement'
import {
  bureauUtilisable,
  cleDuBureauDeVerification,
  fichiersCommitesHorsDeLaCopie,
  fichiersRestesDansLaCopie,
  synchroniserBureauDeVerification,
  VERIFY_SANS_ISOLATION
} from '../verify/verification-isolee'
import { readLastCommitFiles } from '../git/git-read-main'
import { readGitState } from '../git/git-read-main'
import { SAUT_PORTEE, archiverSortie } from './publication'

/**
 * VERIFICATION — le seul point d'execution ouvert a la demande d'un modele.
 *
 * Le modele ne transmet AUCUN argument : il demande « verifie », et `decideVerifyCommand` choisit
 * (ou refuse) a partir du script `test` declare par le projet. La voie alternative — donner Bash au
 * CLI avec `--allowedTools "Bash(npm test)"` — a ete testee sur le vrai binaire et INVALIDEE : le
 * pattern ne restreint rien (`echo BONJOUR` passait, avec et sans bypassPermissions). C'est donc
 * ici, et seulement ici, que la frontiere est tenue.
 *
 * `shell: false` + argv separes : aucune interpolation, donc aucune injection possible meme si la
 * liste blanche evoluait.
 */
/**
 * `verify` SE JOUE DANS UNE COPIE ISOLEE, PAS DANS LE DOSSIER PARTAGE.
 *
 * DEFAUT MESURE le 2026-09-02 : la suite tournait dans l'espace de travail partage.
 * Un autre agent y a reecrit `src/main/runs/conv-runs.ts` PENDANT le lot, et la suite a echoue au
 * chargement sur un fichier sain — un faux rouge, donc un verdict sans valeur. La meme fenetre
 * rend un faux VERT possible : un fichier remis a l'identique apres coup efface la trace.
 *
 * Meme geste que `edit_file` (`withIsolatedMutation`), aux deux differences pres qui comptent :
 * la copie n'est jamais publiee (on ne fait que LIRE un verdict), et l'etat COURANT y est reporte
 * avant de lancer — sinon on verifierait le dernier commit, ce que personne ne demande.
 *
 * Copie indisponible = comportement d'AVANT, mais DIT : le verdict part avec
 * `VERIFY_SANS_ISOLATION`. Se rabattre en silence sur le dossier partage rendrait de nouveau des
 * verdicts que rien ne distingue d'un vrai.
 */
export async function runVerify(
  bus: AppCommandBus,
  onProgress?: (text: string) => void,
  cible?: string,
  conversationId?: string,
  type?: string
): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
  /*
   * LE STOP DOIT ATTEINDRE `verify`, comme il atteint deja `run`.
   *
   * DEFAUT VECU (2026-10-15) : Stop clique pendant un `verify type:typecheck`. Le tour
   * etait clos, mais `tsc` a tourne encore 15 s et ses battements (15 s, 20 s, 25 s) sont arrives
   * a l'ecran APRES la fin du tour — l'utilisateur a vu son tour « relance 3x ». `spawnVerify`
   * savait deja tuer l'arbre sur signal ; seul `run` le lui passait.
   */
  const signal = conversationId ? bus.signalDuTour?.(conversationId) : undefined
  /*
   * TROIS PREUVES, UN SEUL POINT D'ENTREE. `lint` et `typecheck` ne passent PAS par la machinerie
   * de portee : `vitest related` n'a aucun sens pour eux, et un lint restreint ne prouve rien de
   * plus vite. On rejoue le script DECLARE par le projet, dans la meme copie isolee, et on rend
   * son code de sortie.
   *
   * PROVENANCE : recupere le 2026-09-09 d'une copie de travail isolee jamais publiee
   * (`agent__run-7ea9ff7647f9-1`).
   */
  if (type !== undefined && type !== '' && type !== 'test') {
    if (type !== 'lint' && type !== 'typecheck') {
      return {
        allowed: false,
        reason: `type de vérification inconnu : ${type} — valeurs acceptées : ${TYPES_DE_VERIFICATION.join(', ')}`,
        ok: false,
        exitCode: null,
        command: '',
        output: ''
      }
    }
    const bureauScript = await bus.bureauDeVerification(conversationId, onProgress)
    const cwd = bureauScript ?? bus.workspaceDuTour
    const decision = decideVerifyScript(type, cwd)
    if (!decision.allowed) {
      return {
        allowed: false,
        reason: decision.reason,
        ok: false,
        exitCode: null,
        command: '',
        output: ''
      }
    }
    const resultatScript = await bus.spawnVerify(
      decision.command.split(' '),
      decision.cwd,
      decision.command,
      onProgress,
      signal
    )
    return bureauScript
      ? resultatScript
      : {
          ...resultatScript,
          output: `${VERIFY_SANS_ISOLATION}${SAUT_PORTEE}${resultatScript.output}`
        }
  }
  const bureau = await bus.bureauDeVerification(conversationId, onProgress)
  if (bureau) return bus.runVerifyAt(bureau, onProgress, cible, signal)
  const resultat = await bus.runVerifyAt(bus.workspaceDuTour, onProgress, cible, signal)
  return { ...resultat, output: `${VERIFY_SANS_ISOLATION}${SAUT_PORTEE}${resultat.output}` }
}

/**
 * Obtient (ou reprend) la copie de verification de cette conversation et y reporte l'etat
 * courant. Rend `undefined` — jamais une exception — quand l'isolation n'est pas disponible :
 * une verification impossible a isoler doit encore pouvoir conclure, en le disant.
 */
export async function bureauDeVerification(
  bus: AppCommandBus,
  conversationId?: string,
  onProgress?: (text: string) => void
): Promise<string | undefined> {
  const workspace = bus.workspaceDuTour
  const worktrees = bus.os.worktrees
  if (!workspace || !worktrees) return undefined
  const runId = cleDuBureauDeVerification(conversationId)
  const beginOptions = {
    task: 'verify',
    role: 'command',
    ...(conversationId ? { conversationId } : {})
  }
  try {
    const bureau = worktrees.beginAsync
      ? await worktrees.beginAsync(runId, 'Commande verify', true, beginOptions)
      : worktrees.begin(runId, 'Commande verify', true, beginOptions)
    if (!bureauUtilisable(bureau)) return undefined
    // L'etat courant = le commit LOCAL + le travail non commite. La copie nait sur `origin` :
    // sans les fichiers commites localement depuis, elle melangeait vieux et neuf.
    const commites = await fichiersCommitesHorsDeLaCopie(workspace, bureau)
    // Les ecarts de la copie elle-meme passent EN DERNIER : ce qu'une verification d'avant y a
    // laisse, et que le depot ne nomme plus, revient a l'etat du depot.
    const rapport = synchroniserBureauDeVerification(workspace, bureau, [
      ...(commites ?? []),
      ...(await bus.fichiersNonCommites(workspace)),
      ...((await fichiersRestesDansLaCopie(bureau)) ?? [])
    ])
    // Le premier `verify` d'une conversation paie la creation de la copie : le dire evite de
    // lire cette attente comme un blocage.
    onProgress?.(
      `copie isolée prête — ${rapport.copies.length} fichier(s) à jour reporté(s)` +
        (rapport.supprimes.length ? `, ${rapport.supprimes.length} retiré(s)` : '') +
        (commites === null
          ? ' — ⚠ commits locaux non lus : la copie peut garder des fichiers anciens'
          : '')
    )
    return bureau
  } catch {
    return undefined
  }
}

export async function runVerifyAt(
  bus: AppCommandBus,
  workspaceRoot: string | undefined,
  onProgress?: (text: string) => void,
  cible?: string,
  /** Signal d'arret du tour : le Stop de l'utilisateur tue la verification en cours. */
  signal?: AbortSignal
): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
  const decision = decideVerifyCommand(workspaceRoot)
  if (!decision.allowed) {
    return {
      allowed: false,
      reason: decision.reason,
      ok: false,
      exitCode: null,
      command: '',
      output: ''
    }
  }
  /*
   * LA CIBLE, validee ici et nulle part ailleurs. Un refus est RENDU avec son motif plutot
   * qu'ignore en silence : un refus muet renverrait le modele a la devinette, et c'est exactement
   * ce qui a produit le diagnostic statique errone du 2026-08-25.
   *
   * `-- <fichier>` : npm transmet ce qui suit `--` au script, donc a vitest. L'argv reste construit
   * ICI, argument par argument, `shell: false` -- le chemin valide n'est jamais interpole.
   */
  let argv = decision.command.split(' ')
  let etiquette = decision.command
  if (cible !== undefined && cible.trim() !== '') {
    const verdict = cibleDeVerification(cible, decision.cwd)
    if (!verdict.ok) {
      return {
        allowed: false,
        reason: `cible refusée : ${verdict.raison}`,
        ok: false,
        exitCode: null,
        command: '',
        output: ''
      }
    }
    /*
     * UNE SOURCE PASSE PAR LA PORTEE, un test se joue directement.
     *
     * Corrige le 2026-08-25 : ce point refusait une cible source, alors qu'un agent
     * qui vient d'editer un fichier demande naturellement a le verifier. `runRelatedVerifyAt` joue
     * `vitest related <fichier> --run` -- les tests qui IMPORTENT le fichier -- et il existait deja.
     * On ROUTE donc, au lieu de refuser.
     */
    if (verdict.parPortee) {
      const parPortee = await bus.runRelatedVerifyAt(decision.cwd, [verdict.chemin], signal)
      // Portee indeterminable (projet sans vitest, chemin non exploitable) : on retombe sur la
      // suite complete plutot que de rendre un refus. Un vert plus large n'est jamais un faux vert.
      if (parPortee.allowed) return parPortee
    } else {
      argv = [...argv, '--', verdict.chemin]
      etiquette = libelleDuVerifyCible(decision.command, verdict.chemin)
    }
  }
  /*
   * SANS CIBLE, LA PORTEE VIENT DE CE QUI A CHANGE.
   *
   * DEFAUT VECU le 2026-08-25 : `verify` nu a rendu « verification arretee apres 600 s
   * (plafond) — rien n'est prouve ». Ce n'est pas un rouge, c'est une ABSENCE de verdict : dix
   * minutes d'attente pour apprendre qu'on ne sait rien. Et c'est le repli d'`edit_file` quand la
   * portee n'est pas derivable, donc une edition saine peut se faire refuser par un chronometre.
   *
   * La question que l'agent pose en pratique n'est pas « le depot entier est-il vert ? » mais
   * « est-ce que ce que je viens de changer casse quelque chose ? ». Cette portee-la existait deja
   * pour `edit_file` (2026-08-22) et pour une cible SOURCE (2026-08-25, plus haut dans cette
   * fonction) : elle manquait au seul cas sans cible. Les deux precedents mesurent 20 a 70 s la ou
   * la suite entiere depasse le plafond.
   *
   * ARBRE PROPRE : rien a cibler, donc la suite complete reste la reponse. C'est deliberate — sur
   * un arbre propre, « rien n'est casse » n'est PAS une reponse a « le depot est-il vert ? », et la
   * confondre fabriquerait exactement le faux vert que `porteeDuVert` sert a empecher.
   *
   * Et l'angle mort reste NOMME par la voie de portee elle-meme : un vert dont on ignore l'etendue
   * se lit plus large qu'il n'est.
   */
  /*
   * ARBRE PROPRE : LA PORTEE VIENT DU DERNIER COMMIT.
   *
   * DEFAUT VECU le 2026-08-25, APRES le correctif ci-dessus : plus rien de sale a
   * cibler, donc suite entiere, donc plafond — « rien n'est prouve » une fois de plus. Le menage
   * du depot avait rendu ce chemin actif. Mesure du meme jour : la suite entiere tourne PLUS DE
   * 40 MINUTES sans finir, sous un plafond de 600 s. Lancer une action dont l'echec est CERTAIN
   * n'est pas une verification.
   *
   * Sur un arbre propre la question naturelle n'est pas « le depot entier est-il vert ? » mais
   * « ce que je viens de COMMITTER casse-t-il quelque chose ? ». La portee est NOMMEE au verdict :
   * un vert plus etroit qui s'annonce vaut mieux qu'un plafond muet.
   *
   * Meme regle stricte : un commit qui touche autre chose que du code n'a pas de portee derivable,
   * et la suite entiere reprend la main.
   */
  const derivee =
    porteeDerivableDesChangements(await bus.fichiersNonCommites(decision.cwd)) ??
    porteeDerivableDesChangements(await readLastCommitFiles(decision.cwd))
  if (etiquette === decision.command && derivee) {
    const parPortee = await bus.runRelatedVerifyAt(decision.cwd, derivee, signal)
    // Portee indeterminable (projet sans vitest, chemin non exploitable) : on retombe sur la suite
    // complete plutot que de rendre un refus. Un vert plus large n'est jamais un faux vert.
    if (parPortee.allowed) {
      return {
        ...parPortee,
        output: `${VERIFY_RELATED_ANGLE_MORT}${SAUT_PORTEE}${parPortee.output}`
      }
    }
  }
  const resultat = await bus.spawnVerify(argv, decision.cwd, etiquette, onProgress, signal)
  // Le verdict NOMME sa portee. Sans cela, un vert obtenu dans un arbre sale se lit comme un
  // vert du depot : mesure du 2026-08-22, « exit 0, 713 fichiers » a ete conclu
  // « pret pour la fusion » alors qu'`origin/main` portait 3 rouges au meme instant.
  const portee = porteeDuVert(await bus.fichiersNonCommites(decision.cwd))
  return portee ? { ...resultat, output: `${portee}${SAUT_PORTEE}${resultat.output}` } : resultat
}

/** Fichiers non commites de la base, lus par le lecteur git DEJA en place (aucun doublon). */
export async function fichiersNonCommites(cwd: string): Promise<string[]> {
  try {
    const etat = await readGitState(cwd, 1)
    return (etat.state?.changes ?? []).map((c) => c.path)
  } catch {
    // Pas de git, pas de depot : on ne bloque pas la verification pour autant.
    return []
  }
}

/**
 * VERIFICATION DE PORTEE — ce que l'edition a REELLEMENT pu casser.
 *
 * Voie SEPAREE de `runVerifyAt`, et c'est deliberate : la commande `verify` nue, exposee au
 * modele, doit garder son verdict GLOBAL (elle repond « le depot est-il vert ? », une question
 * legitime et differente). Les fusionner aurait couple les deux sens du mot « verifier ».
 */
export async function runRelatedVerifyAt(
  bus: AppCommandBus,
  workspaceRoot: string | undefined,
  paths: readonly string[],
  signal?: AbortSignal
): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
  const decision = decideRelatedVerify(workspaceRoot, paths)
  if (!decision.allowed) {
    return {
      allowed: false,
      reason: decision.reason,
      ok: false,
      exitCode: null,
      command: '',
      output: ''
    }
  }
  return await bus.spawnVerify(decision.argv, decision.cwd, decision.command, undefined, signal)
}

/**
 * ANNULATION -- `signal` est le SECOND declencheur de mise a mort, a cote de l'horloge.
 *
 * Defaut mesure le 2026-09-09 : un `dotnet run` sur une application a fenetre ne rend
 * JAMAIS la main. Le tour restait bloque ici jusqu'au plafond, et le bouton Stop -- qui passe par
 * `abortOrchestration` ou `activeChatTurns` -- n'avait AUCUNE prise sur l'enfant lance par `run`.
 * L'utilisateur voyait un bouton sans effet, et le message qu'il envoyait ensuite n'etait pas lu.
 *
 * La mecanique de mise a mort existait deja (`tuerArbre`, utilisee par l'horloge plus bas) : il
 * manquait un declencheur autre que l'expiration du delai.
 */
export async function spawnVerify(
  bus: AppCommandBus,
  argv: string[],
  cwd: string,
  label: string,
  onProgress?: (text: string) => void,
  signal?: AbortSignal,
  /** Dossier des binaires à mettre en tête du PATH ; défaut : celui du dossier du tour. */
  binDir?: string
): Promise<VerifyOutcome & { allowed: boolean; reason?: string }> {
  const [file, ...rest] = argv
  const sharedBin =
    binDir ??
    (bus.workspaceDuTour ? join(bus.workspaceDuTour, 'node_modules', '.bin') : undefined)
  const env =
    sharedBin && existsSync(sharedBin)
      ? {
          ...process.env,
          PATH: `${sharedBin}${delimiter}${process.env.PATH ?? ''}`
        }
      : process.env
  // Lue une fois par session (`chcp`, meme invocation `cmd.exe /c` que ci-dessous) ; hors Windows : UTF-8.
  const pageOem = await pageDeCodeConsole()
  return await new Promise((resolve) => {
    // Windows : depuis le correctif CVE-2024-27980, Node REFUSE de spawner un `.cmd` sans shell
    // (`spawn EINVAL`) — constate en essai reel, l'agent recevait un echec d'environnement alors
    // que sa correction etait bonne. On passe donc par `cmd.exe /c` avec des ARGV SEPARES : pas de
    // chaine interpolee, donc aucune surface d'injection. ATTENTION : depuis l'ouverture de `run`
    // (2026-08-26) la commande PEUT venir du modele. Ce qui la borne n'est plus « le modele ne
    // choisit jamais » mais `decisionDeCommande` : refus par defaut, autorisation par binaire
    // ecrite par l'UTILISATEUR, et aucun enchainement shell. Le commentaire d'avant est conserve
    // ici sous sa forme corrigee plutot que supprime : il disait vrai, et ce n'est plus le cas.
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', file, ...rest], {
            shell: false,
            windowsHide: true,
            cwd,
            env
          })
        : spawn(file, rest, { shell: false, cwd, env })
    /*
     * L'arbre est SUIVI tant qu'il vit : si ce process s'arrete avant que l'horloge ci-dessous
     * ne tire, c'est la seule chose qui l'eteindra (defaut mesure le 2026-08-26 : trois chaines
     * `npm -> cmd -> node` survivantes depuis la veille, ~267 Mo, Autowin meme pas lance).
     */
    const oublierLArbre = suivreArbre(child.pid)
    /*
     * OCTETS BRUTS, decodes une seule fois (voir `console-encoding.ts`). Decoder chaque morceau en
     * UTF-8 rendait « ex�cutable » et « re�us » : `cmd.exe` ecrit en
     * page OEM (850 sur un poste francais), et un caractere pouvait etre coupe entre deux morceaux.
     */
    const morceaux: Buffer[] = []
    const collect = (chunk: Buffer): void => {
      morceaux.push(chunk)
    }
    const sortie = (): string => decoderSortieConsole(Buffer.concat(morceaux), pageOem)
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    /*
     * HORLOGE. Sans elle, une suite lente bloque le pilote DANS la commande : il ne draine plus
     * ses directives, le chat n'a plus aucune prise (defaut vecu le 22/08). L'arbre
     * entier est tue — sous Windows le `cmd.exe /c` n'est qu'un parent, tuer le seul pid laissait
     * le runner vivant et le `close` ne venait jamais.
     */
    /*
     * BATTEMENT — la seule chose qui distingue, A L'ECRAN, une suite qui travaille d'une suite
     * bloquee. Mesure le 2026-08-25 : dix minutes de « 1 action en cours » sans une
     * ligne de plus, puis un plafond. Le tampon est deja collecte ci-dessus ; on n'ajoute donc
     * aucune lecture, juste une projection periodique de son etat vers le fil.
     */
    const debut = Date.now()
    const battement = onProgress
      ? setInterval(
          () => onProgress(battementDeVerification(sortie(), Date.now() - debut)),
          VERIFY_BATTEMENT_MS
        )
      : undefined
    // Ne PAS retenir la boucle d'evenements en vie pour un simple signe de vie.
    battement?.unref?.()
    const plafond = verifyTimeoutMs()
    let expire = false
    const horloge = setTimeout(() => {
      expire = true
      clearInterval(battement)
      oublierLArbre()
      if (child.pid) tuerArbre(child.pid)
      else child.kill('SIGKILL')
      // La sortie deja collectee part AVEC le verdict : le plafond borne l'attente, il n'efface
      // pas ce que la suite avait prouve avant d'etre coupee (2026-08-25).
      resolve({ allowed: true, ...verifyTimeoutOutcome(label, plafond, sortie()) })
    }, plafond)
    horloge.unref?.()
    /*
     * STOP -- le meme geste que l'horloge, declenche par l'utilisateur au lieu du temps.
     *
     * `expire` est REUTILISE comme drapeau « verdict deja rendu » : les handlers `error` et
     * `close` le testent en premier, donc l'enfant qui meurt sous nos pieds ne resout pas une
     * seconde fois. Le drapeau est pose AVANT de tuer, sans quoi `close` gagnerait la course.
     */
    const surAnnulation = (): void => {
      if (expire) return
      expire = true
      clearTimeout(horloge)
      clearInterval(battement)
      oublierLArbre()
      if (child.pid) tuerArbre(child.pid)
      else child.kill('SIGKILL')
      // La sortie deja collectee part AVEC le verdict : l'arret borne l'attente, il n'efface pas
      // ce que la commande avait produit avant d'etre coupee.
      resolve({
        allowed: true,
        ok: false,
        exitCode: null,
        command: label,
        output: capVerifyOutput(
          `${sortie()}
[arret demande] ${label} — interrompu par l'utilisateur (Stop).`,
          undefined,
          archiverSortie
        )
      })
    }
    if (signal?.aborted) surAnnulation()
    else signal?.addEventListener('abort', surAnnulation, { once: true })
    child.on(
      'error',
      (error) =>
        expire ||
        (oublierLArbre(),
        clearTimeout(horloge),
        clearInterval(battement),
        resolve({
          allowed: true,
          ok: false,
          exitCode: null,
          command: label,
          output: capVerifyOutput(`lancement impossible : ${String(error)}`)
        }))
    )
    child.on(
      'close',
      (code) =>
        expire ||
        (oublierLArbre(),
        clearTimeout(horloge),
        clearInterval(battement),
        resolve({
          allowed: true,
          ok: code === 0,
          exitCode: code,
          command: label,
          output: capVerifyOutput(sortie(), undefined, archiverSortie)
        }))
    )
  })
}
