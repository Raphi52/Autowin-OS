/**
 * RÉPARER un prérequis rouge depuis la popup de diagnostic, au lieu de lire une commande à recopier.
 *
 * Constaté en réel (2026-07-29) : la popup affichait « ✗ Session OAuth Codex — npm run codex:login »
 * et c'est tout. L'utilisateur doit quitter l'app, trouver un terminal, se placer dans le bon dossier.
 * Or l'app SAIT déjà faire les deux réparations possibles — `spawnLoginTerminal` (page Routeur) et
 * `ensureBrainServerStarted` (démarrage). Le savoir-faire existait, le bouton manquait.
 *
 * HONNÊTETÉ, la règle du module : on ne renvoie un plan QUE pour ce qu'on sait réellement réparer.
 *  - `codex-session` → ouvre le login OAuth (le CLI gère la saisie ; l'app ne voit aucun credential).
 *  - `brain`         → tente de démarrer le brain_server local.
 *  - `brain-token`   → AUCUN plan : un secret ne s'invente pas.
 *  - `claude-session` → ouvre le login Anthropic ; CLI absent → la console l'INSTALLE puis enchaîne
 *    le login (2026-09-02 : afficher « installe-le, puis re-vérifie » était un cul-de-sac — le
 *    bouton semblait sans effet. « + Ajouter un compte » du Routeur, lui, exécute).
 * Un check sans plan n'affiche PAS de bouton, plutôt qu'un bouton qui ne peut pas tenir sa promesse.
 *
 * Et une réparation LANCÉE n'est pas une réparation FAITE : le login est interactif, le serveur met
 * ~30-40 s à ouvrir son port. On rend donc `started` + un détail, jamais « réparé » — c'est le
 * re-diagnostic qui tranche.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, parse } from 'node:path'
import { ensureBrainServerStarted, resetBrainLaunchAttempt } from './brain-server-launch'
import { resolveBinOnPath } from './preflight-probes'
import { resolveClaudeBin } from './providers/claude'
import { claudeAccountEnv } from './claude-accounts'
import { planProviderLogin, spawnLoginTerminal } from './provider-login'

/**
 * Installation du CLI claude, EXÉCUTÉE dans la console de login quand le binaire manque.
 * `-g` pose les shims dans le préfixe npm — déjà sur le PATH de la console — donc le `auth login`
 * enchaîné juste après le trouve sans rouvrir de terminal.
 */
export const CLAUDE_CLI_INSTALL_COMMAND = 'npm i -g @anthropic-ai/claude-code'

/** Nom du package du dépôt Autowin OS : l'IDENTITÉ exigée d'un candidat, pas juste un script. */
export const AUTOWIN_PACKAGE_NAME = 'autowin-os'

/**
 * Où lancer `npm run codex:login`. Le script vit dans le package.json du REPO : lancé ailleurs, npm
 * répond « Missing script » et le bouton échoue en silence. En dev `process.cwd()` suffit — l'app
 * EMPAQUETÉE, elle, démarre depuis n'importe où (raccourci bureau), donc on ne suppose pas : on
 * CHERCHE le premier dossier qui déclare réellement le script, en remontant les parents.
 * `undefined` si aucun ne le déclare → on le dit, plutôt que d'ouvrir une console qui va échouer.
 *
 * SÉCURITÉ — pourquoi « déclare le script » ne suffit PAS : la remontée finit par atteindre `C:\`,
 * dont la racine autorise par défaut la création de fichiers aux utilisateurs authentifiés. Un
 * `C:\package.json` planté avec `{"scripts":{"codex:login":"<payload>"}}` serait adopté comme « le
 * repo Autowin OS », puis exécuté (`npm run`, via `powershell -ExecutionPolicy Bypass`). On exige
 * donc l'IDENTITÉ du dépôt (`name: autowin-os`), on refuse les candidats non absolus, et on
 * n'inspecte jamais une racine de volume.
 */
export function resolveCodexLoginCwd(
  candidates: readonly string[],
  exists: (p: string) => boolean = existsSync,
  read: (p: string) => string = (p) => readFileSync(p, 'utf8')
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue
    // Un candidat relatif se résoudrait depuis le cwd du process : indéterminé, donc refusé.
    if (!isAbsolute(candidate)) continue
    let dir = candidate
    // Remontée bornée : un chemin Windows profond reste sous ~12 niveaux.
    for (let depth = 0; depth < 12; depth++) {
      // Racine de volume : ACL laxistes par défaut, jamais un dépôt. On s'arrête AVANT de la lire.
      if (dir === parse(dir).root) break
      const manifest = join(dir, 'package.json')
      if (exists(manifest)) {
        try {
          const parsed = JSON.parse(read(manifest)) as {
            name?: unknown
            scripts?: Record<string, string>
          }
          if (parsed.name === AUTOWIN_PACKAGE_NAME && parsed.scripts?.['codex:login']) return dir
        } catch {
          /* manifeste illisible → ce n'est pas le bon, on continue de remonter */
        }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return undefined
}

export type PreflightRepairPlan =
  /** Ouvre une console où le CLI mène son propre flow d'authentification. */
  | { kind: 'login'; provider: 'codex' | 'claude'; label: string; note: string }
  /** Tente un démarrage local du brain_server (jamais un kill/restart : instance par machine). */
  | { kind: 'brain-start'; label: string; note: string }
  /** Ouvre une console sur le bootstrap qui POSE le runtime Python du Brain (venv + tooling). */
  | { kind: 'brain-install'; label: string; note: string }

export interface PreflightRepairOutcome {
  /** L'action a bien été LANCÉE. Ne dit pas que le prérequis est réparé. */
  started: boolean
  /** Ce qui s'est passé, à afficher tel quel. */
  detail: string
}

/**
 * Plan de réparation d'un check, ou `undefined` s'il n'y a rien d'honnête à proposer.
 * Pur : aucun effet de bord, l'appelant décide de l'exécuter.
 */
export function planPreflightRepair(checkId: string): PreflightRepairPlan | undefined {
  switch (checkId) {
    case 'codex-session':
      return {
        kind: 'login',
        provider: 'codex',
        label: 'Se connecter',
        note: 'Une console s’ouvre : le login OAuth s’y fait. Rien n’est saisi dans Autowin.'
      }
    case 'claude-session':
      return {
        kind: 'login',
        provider: 'claude',
        label: 'Se connecter',
        note: 'Une console s’ouvre : le CLI est installé s’il manque, puis le login Anthropic s’y fait. Rien n’est saisi dans Autowin.'
      }
    case 'brain':
      return {
        kind: 'brain-start',
        label: 'Démarrer',
        note: 'Tente de lancer le brain_server local (le port s’ouvre après ~30-40 s de préchauffage).'
      }
    case 'brain-venv':
      return {
        kind: 'brain-install',
        label: 'Installer',
        note: 'Ouvre une console sur scripts/bootstrap-deps.ps1 : il pose le venv et le tooling du Brain (plusieurs minutes).'
      }
    // brain-token : un secret ne s'invente pas.
    default:
      return undefined
  }
}

export interface PreflightRepairDeps {
  /** Injectable en test : par défaut le spawn de console visible de la page Routeur. */
  openLoginTerminal?: (command: string, opts: { cwd?: string }) => void
  /** Injectable en test : par défaut la tentative de démarrage du brain_server. */
  startBrain?: () => Promise<{ status: string; detail: string }>
  /** Ping utilisé par le démarrage pour ne pas doubler une instance vivante. */
  pingBrain?: () => Promise<boolean>
  /** Dossiers où chercher le repo déclarant `codex:login` (le 1ᵉʳ qui le déclare gagne). */
  cwdCandidates?: readonly string[]
  resolveLoginCwd?: (candidates: readonly string[]) => string | undefined
  spawnFn?: typeof spawn
  /** Injectable en test. Défaut : la MÊME résolution que la sonde de session et que le run. */
  resolveClaudeBin?: () => string
  /** Injectable en test. Défaut : `existsSync`. */
  exists?: (path: string) => boolean
  /** Injectable en test. Défaut : `resolveBinOnPath` (lecture du PATH, sans exécuter). */
  resolveOnPath?: (which: string) => string | null
}

/**
 * Exécute la réparation d'un check. Ne throw JAMAIS : un échec de réparation est un résultat à
 * afficher, pas une exception qui casse la popup de diagnostic.
 */
export async function repairPreflightCheck(
  checkId: string,
  deps: PreflightRepairDeps = {}
): Promise<PreflightRepairOutcome> {
  const plan = planPreflightRepair(checkId)
  if (!plan) {
    return { started: false, detail: 'Aucune réparation automatique connue pour ce prérequis.' }
  }
  try {
    if (plan.kind === 'login' && plan.provider === 'claude') {
      // `claude auth login` s'adresse au CLI GLOBAL : contrairement à `npm run codex:login`, il ne
      // dépend d'aucun script du repo, donc aucun cwd à résoudre — en exiger un ferait échouer le
      // bouton sur l'app empaquetée, qui démarre depuis n'importe où.
      const open =
        deps.openLoginTerminal ??
        ((command, opts): void => spawnLoginTerminal(command, { ...opts, spawnFn: deps.spawnFn }))
      // ON AUTHENTIFIE LE BINAIRE SONDÉ (audit 2026-07-30). La sonde de session résout par
      // `resolveClaudeBin` ; lancer le NOM NU laissait le PATH du terminal élire une AUTRE
      // installation. Sur un poste à deux installations aux stores d'auth distincts — cas mesuré —
      // le login réussissait et le check restait rouge, sans explication.
      const resolveBin = deps.resolveClaudeBin ?? ((): string => resolveClaudeBin())
      const exists = deps.exists ?? existsSync
      const onPath = deps.resolveOnPath ?? resolveBinOnPath
      const bin = resolveBin()
      // `resolveClaudeBin` rend `'claude'` UNIQUEMENT en dernier recours ; toute autre valeur vient de
      // `CLAUDE_BIN` ou du binaire natif trouvé, et doit être authentifiée TELLE QUELLE — y compris un
      // nom nu (`CLAUDE_BIN=claude-next` pour une seconde installation), que `isAbsolute` ne voit pas.
      const designated = bin !== 'claude'
      if (designated) {
        // Un binaire DÉSIGNÉ qui n'existe pas : ouvrir une console serait un faux fix — elle
        // échouerait sous les yeux de l'utilisateur. Absolu → le disque tranche ; sinon → le PATH.
        const reachable = isAbsolute(bin) ? exists(bin) : onPath(bin) !== null
        if (!reachable) {
          return {
            started: false,
            detail: `Binaire claude introuvable (${bin}) : corrige CLAUDE_BIN ou réinstalle le CLI.`
          }
        }
      }
      // Aucun binaire désigné ET rien dans le PATH : le CLI n'est pas installé. On n'AFFICHE PLUS la
      // commande à recopier — c'était un cul-de-sac (« le bouton ne fait rien », 2026-09-02). Comme
      // « + Ajouter un compte » du Routeur, le bouton OUVRE la console et EXÉCUTE : l'installation
      // d'abord, le login enchaîné dans la MÊME console (le shim npm est alors sur son PATH).
      const missing = !designated && onPath('claude') === null
      // Source unique de la commande de login (provider-login.ts) : pas de littéral dupliqué ici,
      // qui divergerait le jour où le CLI renomme sa sous-commande.
      // Le dossier du compte ACTIF est passe explicitement : sans lui, reparer la session
      // authentifiait toujours le dossier par defaut — et pouvait ecraser la session du compte
      // que l'utilisateur venait d'ajouter (incident 2026-09-01).
      const loginPlan = planProviderLogin(
        'claude',
        designated ? bin : undefined,
        claudeAccountEnv().CLAUDE_CONFIG_DIR
      )
      if (loginPlan.kind !== 'terminal') {
        return { started: false, detail: 'Le login claude ne passe pas par une console.' }
      }
      open(missing ? `${CLAUDE_CLI_INSTALL_COMMAND}; ${loginPlan.command}` : loginPlan.command, {})
      return {
        started: true,
        detail: missing
          ? 'Console ouverte : installation du CLI claude, puis login enchaîné. Termine, puis re-vérifie.'
          : 'Console de connexion ouverte. Termine le login, puis re-vérifie.'
      }
    }
    if (plan.kind === 'login') {
      // `npm run codex:login` peuple le store LU par l'app → doit tourner dans le repo qui déclare
      // le script. On le RÉSOUT : ouvrir une console qui répond « Missing script » serait un faux fix.
      const candidates = deps.cwdCandidates ?? [
        process.env.AUTOWIN_OS_WORKSPACE ?? '',
        process.cwd(),
        process.execPath
      ]
      const resolve = deps.resolveLoginCwd ?? ((c) => resolveCodexLoginCwd(c))
      const cwd = resolve(candidates.filter((c) => Boolean(c)))
      if (!cwd) {
        return {
          started: false,
          detail:
            'Repo Autowin OS introuvable depuis l’app : lance « npm run codex:login » dans le dossier du repo.'
        }
      }
      const open =
        deps.openLoginTerminal ??
        ((command, opts): void => spawnLoginTerminal(command, { ...opts, spawnFn: deps.spawnFn }))
      open('npm run codex:login', { cwd })
      return {
        started: true,
        detail: 'Console de connexion ouverte. Termine le login, puis re-vérifie.'
      }
    }
    if (plan.kind === 'brain-install') {
      // MÊME résolution que `npm run codex:login` : le script vit dans le repo, et l'identité du
      // dépôt (`name: autowin-os`) est exigée — sans quoi la remontée pourrait élire un
      // `package.json` planté dans une racine de volume, puis l'exécuter.
      const candidates = deps.cwdCandidates ?? [
        process.env.AUTOWIN_OS_WORKSPACE ?? '',
        process.cwd(),
        process.execPath
      ]
      const resolve = deps.resolveLoginCwd ?? ((c) => resolveCodexLoginCwd(c))
      const cwd = resolve(candidates.filter((c) => Boolean(c)))
      if (!cwd) {
        return {
          started: false,
          detail:
            'Repo Autowin OS introuvable depuis l’app : lance « powershell -File scripts/bootstrap-deps.ps1 » dans le dossier du repo.'
        }
      }
      const open =
        deps.openLoginTerminal ??
        ((command, opts): void => spawnLoginTerminal(command, { ...opts, spawnFn: deps.spawnFn }))
      // `-SkipCli -SkipGraphify` : le bouton répare CE prérequis, pas les autres. Élargir en douce
      // ferait installer des CLI que l'utilisateur n'a pas demandées depuis un bouton « Installer »
      // posé sous « runtime Brain ».
      open('./scripts/bootstrap-deps.ps1 -SkipCli -SkipGraphify', { cwd })
      return {
        started: true,
        detail:
          'Console d’installation ouverte (plusieurs minutes). Elle affiche ce qui manque encore, puis re-vérifie.'
      }
    }
    const start =
      deps.startBrain ??
      ((): Promise<{ status: string; detail: string }> => {
        // Un clic sur « Démarrer » est une intention MANUELLE et explicite. La garde « une tentative
        // par session » de `ensureBrainServerStarted` existe pour empêcher le backoff AUTOMATIQUE de
        // spammer des spawns — pas pour désarmer l'utilisateur. Sans ce réarmement, dès que le
        // démarrage auto du lancement avait échoué, le bouton restait inopérant pour toute la session
        // et répondait « démarrage déjà tenté cette session — pas de nouveau spawn » sans rien tenter.
        // (Constaté 2026-09-01 : brain_server mort, bouton cliqué en vain.)
        resetBrainLaunchAttempt()
        return ensureBrainServerStarted(deps.pingBrain ?? (async () => false))
      })
    const result = await start()
    // `already-up` n'est PAS un démarrage : le dire, au lieu de laisser croire qu'on a agi.
    return { started: result.status === 'starting', detail: result.detail }
  } catch (error) {
    return {
      started: false,
      detail: `Réparation impossible : ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
