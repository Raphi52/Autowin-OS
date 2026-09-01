import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  configureClaudeAccountEnv,
  describeAccounts,
  withClaudeAccountEnv
} from './claude-accounts'
import { planProviderLogin, spawnLoginTerminal } from './provider-login'
import { AutowinOS } from './os'

vi.mock('./provider-login', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./provider-login')>()),
  spawnLoginTerminal: vi.fn()
}))

/**
 * INCIDENT REEL (2026-09-01) : l'utilisateur etait connecte en raphi5269@gmail.com sur le compte
 * par defaut, a ajoute un compte amitel.fr — et s'est retrouve avec DEUX puces identiques, le
 * compte gmail ayant disparu. Preuve hors-modele : les sauvegardes du CLI
 * (~/.claude/backups/.claude.json.backup.1788241304475) portent encore
 * `emailAddress: raphi5269@gmail.com` a 07:41, alors que ~/.claude.json porte amitel.fr ensuite.
 * Deux defauts distincts, un test chacun.
 */
describe('le login ne doit jamais atterrir dans un dossier HERITE', () => {
  it('claude sans dossier vise : la variable heritee est RETIREE avant le login', () => {
    const plan = planProviderLogin('claude') as { kind: string; command: string }
    // Sans cette purge, un terminal lance depuis un shell ou CLAUDE_CONFIG_DIR traine (le cas de
    // l'app demarree depuis un terminal d'agent) authentifie le dossier d'un AUTRE compte.
    expect(plan.command).toContain('Remove-Item Env:CLAUDE_CONFIG_DIR')
    expect(plan.command).toContain('claude auth login')
  })

  it('claude avec dossier vise : la variable est POSEE', () => {
    const plan = planProviderLogin('claude', undefined, 'D:\\a\\compte-2') as { command: string }
    expect(plan.command).toContain('$env:CLAUDE_CONFIG_DIR = "D:\\a\\compte-2"')
  })
})

describe('withClaudeAccountEnv — env enfant EXPLICITE', () => {
  beforeEach(() => configureClaudeAccountEnv(() => ({})))
  afterEach(() => configureClaudeAccountEnv(() => ({})))

  it('compte par defaut : retire un CLAUDE_CONFIG_DIR herite du processus', () => {
    const env = withClaudeAccountEnv({ PATH: 'p', CLAUDE_CONFIG_DIR: 'D:\\herite' })
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect('CLAUDE_CONFIG_DIR' in env).toBe(false)
    expect(env.PATH).toBe('p')
  })

  it('compte dedie : pose SON dossier, quel que soit l’herite', () => {
    const env = withClaudeAccountEnv(
      { CLAUDE_CONFIG_DIR: 'D:\\herite' },
      { CLAUDE_CONFIG_DIR: 'D:\\compte-2' }
    )
    expect(env.CLAUDE_CONFIG_DIR).toBe('D:\\compte-2')
  })
})

describe('describeAccounts — deux comptes REELLEMENT identiques', () => {
  it('quand email, niveau ET organisation coincident, l’id tranche', () => {
    const base = {
      addedAt: 'x',
      email: 'raphael.vilain@amitel.fr',
      subscriptionType: 'team',
      orgName: 'Amitel'
    }
    const noms = describeAccounts(
      [
        { ...base, id: 'default' },
        { ...base, id: 'compte-2' }
      ],
      'compte-2'
    ).map((account) => account.displayName)
    // Deux puces au texte identique = l'utilisateur ne peut pas savoir sur laquelle il bascule.
    expect(new Set(noms).size).toBe(2)
    expect(noms.join(' ')).toContain('compte-2')
  })
})

it('garde-fou : le test importe bien les symboles attendus', () => {
  expect(typeof withClaudeAccountEnv).toBe('function')
  vi.restoreAllMocks()
})

describe('« Se reconnecter » vise le compte ACTIF, jamais le compte par defaut', () => {
  it('utilise le CLAUDE_CONFIG_DIR du compte actif quand aucune cible n’est passee', () => {
    configureClaudeAccountEnv(() => ({ CLAUDE_CONFIG_DIR: 'D:\\a\\compte-2' }))
    const os = Object.create(AutowinOS.prototype) as AutowinOS
    Object.defineProperty(os, 'registry', { value: { get: () => ({}) } })
    os.startProviderLogin('claude')
    const commande = (spawnLoginTerminal as unknown as { mock: { calls: string[][] } }).mock
      .calls[0][0]
    expect(commande).toContain('compte-2')
    expect(commande).toContain('claude auth login')
    configureClaudeAccountEnv(() => ({}))
  })
})
