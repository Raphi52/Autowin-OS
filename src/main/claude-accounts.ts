import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Plusieurs comptes Claude sur la même machine, avec bascule en un clic — comme claude.exe.
 *
 * MÉCANISME, vérifié hors-modèle le 2026-08-06 avant d'écrire une ligne de ce fichier : le CLI
 * Claude honore `CLAUDE_CONFIG_DIR`. Preuve : `claude auth status` rend `loggedIn: true` avec
 * l'email réel, la MÊME commande avec `CLAUDE_CONFIG_DIR` sur un dossier vide rend
 * `loggedIn: false` — et le CLI a écrit son `.claude.json` dans ce dossier. Un compte est donc
 * exactement un dossier de configuration, et basculer revient à changer une variable
 * d'environnement au spawn. Rien n'est copié, rien n'est écrasé.
 *
 * LE COMPTE PAR DÉFAUT N'A PAS DE DOSSIER. `dir: undefined` signifie « n'injecte rien », donc le
 * CLI retombe sur `~/.claude`, l'identité que la machine avait déjà. C'est ce qui rend la
 * fonctionnalité sans régression : tant que l'utilisateur n'ajoute pas un second compte, le
 * comportement est bit pour bit celui d'avant.
 */
export interface ClaudeAccount {
  id: string
  /** Dossier `CLAUDE_CONFIG_DIR` dédié, ou `undefined` pour l'identité par défaut (`~/.claude`). */
  dir?: string
  /** Email lu via `claude auth status` — jamais saisi à la main, donc jamais faux. */
  email?: string
  /**
   * Le NIVEAU de l'abonnement (`subscriptionType` : team, max, pro…) et l'organisation.
   * Indispensables, pas décoratifs : deux comptes peuvent porter le MÊME email et ne différer
   * que par là — c'est le cas réel de l'utilisateur, deux comptes même adresse, deux niveaux.
   * Sans ces champs, les deux puces afficheraient le même texte et seraient inutilisables.
   */
  subscriptionType?: string
  orgName?: string
  /** Étiquette libre, quand l'utilisateur veut autre chose que l'identité lue. */
  label?: string
  addedAt: string
}

/** Ce que `claude auth status` rend, réduit à ce qui identifie un compte. */
export interface ClaudeIdentity {
  email?: string
  orgName?: string
  subscriptionType?: string
}

export interface ClaudeAccountsState {
  version: 1
  activeId: string
  accounts: ClaudeAccount[]
}

export const DEFAULT_ACCOUNT_ID = 'default'

const STATE_VERSION = 1

export function defaultState(now: string): ClaudeAccountsState {
  return {
    version: STATE_VERSION,
    activeId: DEFAULT_ACCOUNT_ID,
    accounts: [{ id: DEFAULT_ACCOUNT_ID, addedAt: now }]
  }
}

/**
 * Relit l'état en réparant tout ce qui peut l'être plutôt qu'en échouant : ce store est lu au
 * spawn de CHAQUE appel Claude, un throw ici couperait l'app entière. Un état illisible retombe
 * sur le compte par défaut, c'est-à-dire sur le comportement d'avant la fonctionnalité.
 */
export function parseState(raw: unknown, now: string): ClaudeAccountsState {
  if (!raw || typeof raw !== 'object') return defaultState(now)
  const candidate = raw as Partial<ClaudeAccountsState>
  if (candidate.version !== STATE_VERSION || !Array.isArray(candidate.accounts)) {
    return defaultState(now)
  }
  const accounts = candidate.accounts.filter(
    (account): account is ClaudeAccount =>
      !!account && typeof account === 'object' && typeof account.id === 'string' && !!account.id
  )
  if (accounts.length === 0) return defaultState(now)
  // Le compte par défaut ne se supprime pas : sans lui, plus aucun repli vers `~/.claude`.
  if (!accounts.some((account) => account.id === DEFAULT_ACCOUNT_ID)) {
    accounts.unshift({ id: DEFAULT_ACCOUNT_ID, addedAt: now })
  }
  const activeId =
    typeof candidate.activeId === 'string' &&
    accounts.some((account) => account.id === candidate.activeId)
      ? candidate.activeId
      : DEFAULT_ACCOUNT_ID
  return { version: STATE_VERSION, activeId, accounts }
}

/** Nom affiché : l'étiquette libre, sinon l'email, sinon l'id. Jamais vide. */
export function accountDisplayName(account: ClaudeAccount): string {
  if (account.label?.trim()) return account.label.trim()
  if (account.email?.trim()) return account.email.trim()
  return account.id === DEFAULT_ACCOUNT_ID ? 'Compte par défaut' : account.id
}

export interface DescribedAccount extends ClaudeAccount {
  displayName: string
  /** Le niveau, affiché en pastille à côté du nom (« team », « max »…). Vide si inconnu. */
  tier: string
  active: boolean
}

/**
 * Décrit une LISTE de comptes, en n'ajoutant que la distinction nécessaire.
 *
 * Le cas qui commande cette fonction : deux comptes avec la MÊME adresse mail et deux niveaux
 * d'abonnement différents (situation réelle de l'utilisateur dans claude.exe). Nommer chaque
 * compte isolément produirait deux puces au texte identique. Le niveau est donc TOUJOURS affiché
 * quand il est connu, et l'organisation puis l'id ne s'ajoutent que si l'ambiguïté persiste —
 * une puce ne porte jamais plus de texte qu'il n'en faut pour la distinguer de ses voisines.
 */
export function describeAccounts(
  accounts: readonly ClaudeAccount[],
  activeId: string
): DescribedAccount[] {
  const named = accounts.map((account) => ({
    account,
    name: accountDisplayName(account),
    tier: account.subscriptionType?.trim() ?? ''
  }))
  const countBy = (key: (entry: (typeof named)[number]) => string): Map<string, number> => {
    const counts = new Map<string, number>()
    for (const entry of named) counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1)
    return counts
  }
  const byName = countBy((entry) => entry.name)
  // L’organisation ne tranche que si elle DISTINGUE : deux comptes de meme email, meme
  // niveau ET meme organisation (cas reel du 2026-09-01, deux fois
  // « raphael.vilain@amitel.fr (Amitel) TEAM ») produisaient deux puces jumelles.
  const byNameTierOrg = countBy(
    (entry) => `${entry.name}\u0000${entry.tier}\u0000${entry.account.orgName?.trim() ?? ''}`
  )
  const byNameTier = countBy((entry) => `${entry.name}\u0000${entry.tier}`)

  return named.map(({ account, name, tier }) => {
    let suffix = ''
    // Même nom ET même niveau : il faut aller plus loin, sinon les deux puces sont jumelles.
    if ((byNameTier.get(`${name}\u0000${tier}`) ?? 0) > 1) {
      const org = account.orgName?.trim() ?? ''
      const orgDistingue =
        !!org && (byNameTierOrg.get(`${name}\u0000${tier}\u0000${org}`) ?? 0) === 1
      suffix = orgDistingue ? ` (${org})` : ` (${account.id})`
    } else if ((byName.get(name) ?? 0) > 1 && !tier) {
      // Noms identiques et aucun niveau connu (compte pas encore sondé) : l'id tranche.
      suffix = ` (${account.id})`
    }
    return {
      ...account,
      displayName: `${name}${suffix}`,
      tier,
      active: account.id === activeId
    }
  })
}

/** Extrait l'identité d'une sortie `claude auth status`. Rend `undefined` si non connecté. */
export function parseIdentity(raw: string): ClaudeIdentity | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.loggedIn !== true) return undefined
    const text = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value.trim() : undefined
    return {
      email: text(parsed.email),
      orgName: text(parsed.orgName),
      subscriptionType: text(parsed.subscriptionType)
    }
  } catch {
    return undefined
  }
}

/**
 * L'environnement à injecter au spawn pour un compte donné.
 *
 * Rend `{}` pour le compte par défaut — et c'est essentiel : injecter `CLAUDE_CONFIG_DIR` avec la
 * valeur du dossier `~/.claude` "en dur" reviendrait à figer un chemin que l'utilisateur ou un
 * autre outil peut déplacer. Ne rien injecter laisse le CLI décider, comme avant.
 */
export function accountEnv(account: ClaudeAccount | undefined): Record<string, string> {
  return account?.dir ? { CLAUDE_CONFIG_DIR: account.dir } : {}
}

export function activeAccountOf(state: ClaudeAccountsState): ClaudeAccount {
  return (
    state.accounts.find((account) => account.id === state.activeId) ??
    state.accounts.find((account) => account.id === DEFAULT_ACCOUNT_ID) ?? {
      id: DEFAULT_ACCOUNT_ID,
      addedAt: new Date(0).toISOString()
    }
  )
}

/** Id stable, lisible dans un chemin de dossier, et jamais en collision avec un existant. */
function nextAccountId(state: ClaudeAccountsState): string {
  for (let index = 2; ; index += 1) {
    const candidate = `compte-${index}`
    if (!state.accounts.some((account) => account.id === candidate)) return candidate
  }
}

/**
 * Point d'accès unique à l'env du compte actif, pour les trois endroits qui lancent le CLI Claude
 * (l'exécution d'un run, la sonde `auth status`, le login). Un provider injecté plutôt que le store
 * importé partout : ces modules sont testés sans Electron, et `app.getPath('userData')` n'y existe
 * pas. Par défaut il ne rend RIEN — donc un module non configuré se comporte exactement comme
 * avant la fonctionnalité, ce qui est le repli sûr.
 */
let activeAccountEnvProvider: () => Record<string, string> = () => ({})

export function configureClaudeAccountEnv(provider: () => Record<string, string>): void {
  activeAccountEnvProvider = provider
}

/**
 * Id du compte Claude actif — pour tout ce qui doit RAISONNER par compte plutôt que par provider.
 * Premier usage : le mur de quota du registre. Le quota appartient à l'ABONNEMENT ; sans cet id, un
 * compte épuisé condamnerait l'autre, ce qui viderait de son sens le fait d'en payer deux.
 * Même contrat que l'env ci-dessus : par défaut `undefined`, donc comportement d'avant inchangé.
 */
let activeAccountIdProvider: () => string | undefined = () => undefined

export function configureClaudeActiveAccountId(provider: () => string | undefined): void {
  activeAccountIdProvider = provider
}

export function claudeActiveAccountId(): string | undefined {
  try {
    return activeAccountIdProvider()
  } catch {
    return undefined // jamais casser un appel Claude à cause du store de comptes
  }
}

/**
 * Rotation d'abonnement, injectee comme les deux accesseurs ci-dessus. Par defaut elle ne fait RIEN
 * et rend `undefined` : un module non configure se comporte exactement comme avant la
 * fonctionnalite, donc un echec de quota remonte tel quel au lieu d'une bascule surprise.
 */
let rotateAccountProvider: (walledAccountId: string) => string | undefined = () => undefined

export function configureClaudeAccountRotation(
  provider: (walledAccountId: string) => string | undefined
): void {
  rotateAccountProvider = provider
}

export function claudeRotateAccount(walledAccountId: string): string | undefined {
  try {
    return rotateAccountProvider(walledAccountId)
  } catch {
    return undefined // une rotation impossible doit laisser l'echec d'origine parler
  }
}

/**
 * Env d'un processus fils Claude, EXPLICITE : `CLAUDE_CONFIG_DIR` y est POSE (compte dedie) ou
 * RETIRE (compte par defaut), jamais laisse a ce que le processus parent trainait.
 *
 * Vecu le 2026-09-01 : l'app lancee depuis un terminal ou `CLAUDE_CONFIG_DIR` etait deja defini
 * sondait le compte « par defaut » DANS le dossier d’un autre compte. Resultat lu a l’ecran :
 * deux puces portant la meme identite, et l'impression que le compte d'origine avait ete
 * « remplace ». `{ ...process.env, ...accountEnv(account) }` ne suffit donc pas : pour le compte
 * par defaut `accountEnv` rend `{}`, c'est-a-dire « n'ecrase rien », donc « herite ».
 */
export function withClaudeAccountEnv(
  base: Record<string, string | undefined>,
  accountEnvironment: Record<string, string> = claudeAccountEnv()
): Record<string, string | undefined> {
  const env = { ...base }
  delete env.CLAUDE_CONFIG_DIR
  if (accountEnvironment.CLAUDE_CONFIG_DIR) {
    env.CLAUDE_CONFIG_DIR = accountEnvironment.CLAUDE_CONFIG_DIR
  }
  return env
}

export function claudeAccountEnv(): Record<string, string> {
  try {
    return activeAccountEnvProvider()
  } catch {
    return {} // jamais casser un appel Claude à cause du store de comptes
  }
}

export interface AccountsStoreDeps {
  readFile?: (path: string) => string
  writeFile?: (path: string, data: string) => void
  makeDir?: (path: string) => void
  removeDir?: (path: string) => void
  now?: () => string
}

/** Store persistant. Les dépendances sont injectables pour que les tests ne touchent aucun disque. */
export class ClaudeAccountsStore {
  private state: ClaudeAccountsState
  private readonly deps: Required<AccountsStoreDeps>

  constructor(
    private readonly statePath: string,
    private readonly accountsRoot: string,
    deps: AccountsStoreDeps = {}
  ) {
    this.deps = {
      readFile: deps.readFile ?? ((path) => readFileSync(path, 'utf8')),
      writeFile: deps.writeFile ?? ((path, data) => writeFileSync(path, data, 'utf8')),
      makeDir: deps.makeDir ?? ((path) => void mkdirSync(path, { recursive: true })),
      removeDir: deps.removeDir ?? ((path) => rmSync(path, { recursive: true, force: true })),
      now: deps.now ?? (() => new Date().toISOString())
    }
    this.state = this.load()
  }

  private load(): ClaudeAccountsState {
    try {
      return this.reroot(
        parseState(JSON.parse(this.deps.readFile(this.statePath)), this.deps.now())
      )
    } catch {
      return defaultState(this.deps.now())
    }
  }

  /**
   * Le dossier d'un compte est DERIVE de la racine courante, jamais cru sur parole.
   *
   * Vecu le 2026-08-07 : l'etat persistait `dir` en chemin ABSOLU. Quand le userData a demenage
   * (passage au stockage portable, dans le depot), les comptes ont continue de pointer sur
   * l'ancien %APPDATA% — hors du nouveau userData. Un chemin absolu ne survit pas a un
   * demenagement de racine ; l'id, si.
   *
   * Le compte par defaut garde `dir: undefined` — c'est ce qui signifie « n'injecte AUCUN env »,
   * donc « comportement d'avant la fonctionnalite ». Le re-enracinement ne doit jamais lui en
   * donner un.
   */
  private reroot(state: ClaudeAccountsState): ClaudeAccountsState {
    return {
      ...state,
      accounts: state.accounts.map((account) =>
        account.dir ? { ...account, dir: join(this.accountsRoot, account.id) } : account
      )
    }
  }

  /**
   * Dernier échec d'écriture de l'état, ou null. Un fail-open MUET a coûté cher : les comptes
   * vivaient en mémoire et disparaissaient à chaque redémarrage, sans le moindre signal.
   */
  persistError: string | null = null

  private persist(): void {
    try {
      this.deps.makeDir(dirname(this.statePath))
      this.deps.writeFile(this.statePath, JSON.stringify(this.state, null, 2))
      this.persistError = null
    } catch (error) {
      // Fail-open volontaire sur l'APPEL (une bascule non persistée vaut mieux qu'un appel Claude
      // qui casse), mais plus jamais SILENCIEUX : sans persistance, tout compte ajouté est perdu
      // au prochain démarrage — c'est un defaut majeur qui doit se voir.
      this.persistError = error instanceof Error ? error.message : String(error)
      console.error(`[claude-accounts] persist ECHEC sur ${this.statePath}:`, error)
    }
  }

  current(): ClaudeAccountsState {
    return { ...this.state, accounts: this.state.accounts.map((account) => ({ ...account })) }
  }

  /**
   * ROTATION D'ABONNEMENT : rend actif un compte AUTRE que celui dont le quota vient d'etre epuise,
   * et rend son id. `undefined` s'il n'y en a pas d'autre — l'appelant remonte alors l'echec plutot
   * que de tourner en rond.
   *
   * La politique vit ICI parce que le store est le seul a connaitre la liste des comptes ; le
   * registre d'appels, lui, connait les murs de quota mais pas les comptes. Chacun decide de ce
   * qu'il sait.
   *
   * Le store ne voit pas les murs déjà posés. Il avance donc dans l'ordre stable du pool à partir du
   * compte refusé ; le registre saute les comptes déjà murés et arrête au retour sur un compte visité.
   * Choisir « le premier différent » rebouclerait A→B→A et rendrait C inaccessible.
   */
  rotateAwayFrom(walledAccountId: string): string | undefined {
    const walledIndex = this.state.accounts.findIndex((account) => account.id === walledAccountId)
    if (walledIndex < 0 || this.state.accounts.length < 2) return undefined
    const suivant = this.state.accounts[(walledIndex + 1) % this.state.accounts.length]
    if (!suivant) return undefined
    this.switchTo(suivant.id)
    return suivant.id
  }

  active(): ClaudeAccount {
    return activeAccountOf(this.state)
  }

  /** L'env à fusionner dans TOUT spawn du CLI Claude (run, sonde d'auth, login). */
  env(): Record<string, string> {
    return accountEnv(this.active())
  }

  add(label?: string): ClaudeAccount {
    const id = nextAccountId(this.state)
    const dir = join(this.accountsRoot, id)
    this.deps.makeDir(dir)
    const account: ClaudeAccount = {
      id,
      dir,
      label: label?.trim() || undefined,
      addedAt: this.deps.now()
    }
    this.state = { ...this.state, accounts: [...this.state.accounts, account] }
    this.persist()
    // Contrairement a la bascule, un AJOUT non persiste ne vaut rien : le compte disparait au
    // prochain demarrage en laissant un dossier orphelin. On refuse plutot que de mentir.
    if (this.persistError) {
      this.state = { ...this.state, accounts: this.state.accounts.filter((it) => it.id !== id) }
      throw new Error(`compte Claude non enregistre (etat non ecrit) : ${this.persistError}`)
    }
    return account
  }

  switchTo(id: string): ClaudeAccount {
    if (!this.state.accounts.some((account) => account.id === id)) {
      throw new Error(`compte Claude inconnu : ${id}`)
    }
    this.state = { ...this.state, activeId: id }
    this.persist()
    return this.active()
  }

  /**
   * Retire un compte. Le compte par défaut est INSUPPRIMABLE — c'est le seul repli garanti vers
   * l'identité de la machine ; le supprimer laisserait un état sans sortie.
   */
  remove(id: string): void {
    if (id === DEFAULT_ACCOUNT_ID) throw new Error('le compte par défaut ne peut pas être retiré')
    const account = this.state.accounts.find((entry) => entry.id === id)
    if (!account) return
    const accounts = this.state.accounts.filter((entry) => entry.id !== id)
    this.state = {
      ...this.state,
      accounts,
      activeId: this.state.activeId === id ? DEFAULT_ACCOUNT_ID : this.state.activeId
    }
    if (account.dir) {
      try {
        this.deps.removeDir(account.dir)
      } catch {
        // Le dossier peut être verrouillé par un CLI encore vivant : l'entrée disparaît quand même
        // de la liste, ce que l'utilisateur a demandé. Un dossier orphelin ne casse rien.
      }
    }
    this.persist()
  }

  /**
   * Enregistre l'identité OBSERVÉE — appelé après une sonde `claude auth status` réelle, jamais
   * saisie à la main. `undefined` (compte non connecté) efface les champs plutôt que de laisser
   * traîner l'identité d'une session révoquée, qui ferait mentir la puce.
   */
  setIdentity(id: string, identity: ClaudeIdentity | undefined): void {
    this.state = {
      ...this.state,
      accounts: this.state.accounts.map((account) =>
        account.id === id
          ? {
              ...account,
              email: identity?.email,
              orgName: identity?.orgName,
              subscriptionType: identity?.subscriptionType
            }
          : account
      )
    }
    this.persist()
  }

  /** Le compte visé, ou `undefined`. Utile au principal pour retrouver son dossier avant sonde. */
  find(id: string): ClaudeAccount | undefined {
    return this.state.accounts.find((account) => account.id === id)
  }
}
