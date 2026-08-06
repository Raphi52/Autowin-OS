import { describe, expect, it } from 'vitest'
import {
  ClaudeAccountsStore,
  DEFAULT_ACCOUNT_ID,
  accountDisplayName,
  accountEnv,
  describeAccounts,
  parseIdentity,
  parseState
} from './claude-accounts'

function makeStore(initial?: string): {
  store: ClaudeAccountsStore
  written: () => string | undefined
  dirs: string[]
  removed: string[]
} {
  let file = initial
  const dirs: string[] = []
  const removed: string[] = []
  const store = new ClaudeAccountsStore('C:/state/accounts.json', 'C:/state/accounts', {
    readFile: () => {
      if (file === undefined) throw new Error('ENOENT')
      return file
    },
    writeFile: (_path, data) => {
      file = data
    },
    makeDir: (path) => void dirs.push(path),
    removeDir: (path) => void removed.push(path),
    now: () => '2026-08-06T00:00:00.000Z'
  })
  return { store, written: () => file, dirs, removed }
}

describe('ClaudeAccountsStore', () => {
  it('démarre sur le compte par défaut, qui n’injecte AUCUN env', () => {
    const { store } = makeStore()
    expect(store.active().id).toBe(DEFAULT_ACCOUNT_ID)
    // Le cœur de la non-régression : sans second compte, le spawn est identique à avant.
    expect(store.env()).toEqual({})
  })

  it('bascule vers un compte ajouté et injecte SON dossier', () => {
    const { store, dirs } = makeStore()
    const added = store.add('perso')
    expect(dirs).toContain(added.dir)
    store.switchTo(added.id)
    expect(store.env()).toEqual({ CLAUDE_CONFIG_DIR: added.dir })
  })

  it('revient au défaut, et l’env redevient vide', () => {
    const { store } = makeStore()
    const added = store.add()
    store.switchTo(added.id)
    store.switchTo(DEFAULT_ACCOUNT_ID)
    expect(store.env()).toEqual({})
  })

  it('persiste la bascule', () => {
    const { store, written } = makeStore()
    const added = store.add()
    store.switchTo(added.id)
    const reloaded = parseState(JSON.parse(written()!), 'now')
    expect(reloaded.activeId).toBe(added.id)
  })

  it('refuse de basculer vers un compte inconnu plutôt que de retomber en silence', () => {
    const { store } = makeStore()
    expect(() => store.switchTo('fantome')).toThrow(/inconnu/)
    expect(store.active().id).toBe(DEFAULT_ACCOUNT_ID)
  })

  it('interdit de supprimer le compte par défaut', () => {
    const { store } = makeStore()
    expect(() => store.remove(DEFAULT_ACCOUNT_ID)).toThrow(/défaut/)
  })

  it('supprimer le compte ACTIF rebascule sur le défaut au lieu de laisser un état sans sortie', () => {
    const { store, removed } = makeStore()
    const added = store.add()
    store.switchTo(added.id)
    store.remove(added.id)
    expect(store.active().id).toBe(DEFAULT_ACCOUNT_ID)
    expect(store.env()).toEqual({})
    expect(removed).toContain(added.dir)
  })

  it('donne des ids distincts à des comptes successifs', () => {
    const { store } = makeStore()
    expect(store.add().id).not.toBe(store.add().id)
  })

  it('enregistre l’identité observée et l’utilise comme nom affiché', () => {
    const { store } = makeStore()
    const added = store.add()
    store.setIdentity(added.id, { email: 'autre@amitel.fr', subscriptionType: 'max' })
    const account = store.find(added.id)!
    expect(accountDisplayName(account)).toBe('autre@amitel.fr')
    expect(account.subscriptionType).toBe('max')
  })

  it('efface l’identité quand la sonde dit « non connecté » (pas de puce qui ment)', () => {
    const { store } = makeStore()
    const added = store.add()
    store.setIdentity(added.id, { email: 'x@y.fr', subscriptionType: 'team' })
    store.setIdentity(added.id, undefined)
    const account = store.find(added.id)!
    expect(account.email).toBeUndefined()
    expect(account.subscriptionType).toBeUndefined()
  })
})

describe('parseState — un état abîmé ne doit jamais casser un appel Claude', () => {
  it('retombe sur le défaut si le JSON n’a pas la bonne forme', () => {
    for (const raw of [null, 42, 'texte', {}, { version: 99 }, { version: 1, accounts: 'x' }]) {
      expect(parseState(raw, 'now').activeId).toBe(DEFAULT_ACCOUNT_ID)
    }
  })

  it('réinjecte le compte par défaut s’il a disparu du fichier', () => {
    const state = parseState(
      { version: 1, activeId: 'compte-2', accounts: [{ id: 'compte-2', addedAt: 'x' }] },
      'now'
    )
    expect(state.accounts.some((account) => account.id === DEFAULT_ACCOUNT_ID)).toBe(true)
    expect(state.activeId).toBe('compte-2')
  })

  it('ignore un activeId qui ne désigne aucun compte', () => {
    const state = parseState(
      { version: 1, activeId: 'disparu', accounts: [{ id: DEFAULT_ACCOUNT_ID, addedAt: 'x' }] },
      'now'
    )
    expect(state.activeId).toBe(DEFAULT_ACCOUNT_ID)
  })
})

describe('accountEnv', () => {
  it('n’injecte rien sans dossier — y compris pour un compte non défaut sans dir', () => {
    expect(accountEnv(undefined)).toEqual({})
    expect(accountEnv({ id: 'x', addedAt: 'x' })).toEqual({})
  })

  it('injecte CLAUDE_CONFIG_DIR quand le compte a un dossier', () => {
    expect(accountEnv({ id: 'x', dir: 'C:/a', addedAt: 'x' })).toEqual({
      CLAUDE_CONFIG_DIR: 'C:/a'
    })
  })
})


describe('describeAccounts — deux comptes, MÊME email, niveaux différents', () => {
  const base = { addedAt: 'x' }
  const sameMail = [
    { ...base, id: 'default', email: 'raphael.vilain@amitel.fr', subscriptionType: 'team' },
    { ...base, id: 'compte-2', email: 'raphael.vilain@amitel.fr', subscriptionType: 'max' }
  ]

  it('les distingue par le NIVEAU, sans alourdir le nom', () => {
    const described = describeAccounts(sameMail, 'default')
    // Le nom reste l'email pour les deux : c'est la pastille de niveau qui tranche.
    expect(described.map((account) => account.displayName)).toEqual([
      'raphael.vilain@amitel.fr',
      'raphael.vilain@amitel.fr'
    ])
    expect(described.map((account) => account.tier)).toEqual(['team', 'max'])
    // Et le couple (nom, niveau) est bien unique — c'est ce qui rend les puces utilisables.
    const keys = described.map((account) => `${account.displayName}|${account.tier}`)
    expect(new Set(keys).size).toBe(2)
  })

  it('marque l’actif', () => {
    expect(describeAccounts(sameMail, 'compte-2').map((a) => a.active)).toEqual([false, true])
  })

  it('va plus loin quand email ET niveau sont identiques : l’organisation tranche', () => {
    const described = describeAccounts(
      [
        { ...base, id: 'default', email: 'a@b.fr', subscriptionType: 'team', orgName: 'Amitel' },
        { ...base, id: 'compte-2', email: 'a@b.fr', subscriptionType: 'team', orgName: 'Perso' }
      ],
      'default'
    )
    expect(described.map((account) => account.displayName)).toEqual([
      'a@b.fr (Amitel)',
      'a@b.fr (Perso)'
    ])
  })

  it('en dernier recours, l’id — jamais deux puces au texte identique', () => {
    const described = describeAccounts(
      [
        { ...base, id: 'default', email: 'a@b.fr' },
        { ...base, id: 'compte-2', email: 'a@b.fr' }
      ],
      'default'
    )
    expect(new Set(described.map((account) => account.displayName)).size).toBe(2)
  })

  it('n’ajoute AUCUN suffixe quand les comptes sont déjà distincts', () => {
    const described = describeAccounts(
      [
        { ...base, id: 'default', email: 'pro@amitel.fr', subscriptionType: 'team' },
        { ...base, id: 'compte-2', email: 'perso@gmail.com', subscriptionType: 'max' }
      ],
      'default'
    )
    expect(described.map((account) => account.displayName)).toEqual([
      'pro@amitel.fr',
      'perso@gmail.com'
    ])
  })
})

describe('parseIdentity', () => {
  it('lit email, organisation et niveau d’une sortie réelle de `claude auth status`', () => {
    expect(
      parseIdentity(
        JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          email: 'raphael.vilain@amitel.fr',
          orgId: '1b869168',
          orgName: 'Amitel',
          subscriptionType: 'team'
        })
      )
    ).toEqual({
      email: 'raphael.vilain@amitel.fr',
      orgName: 'Amitel',
      subscriptionType: 'team'
    })
  })

  it('rend undefined quand le compte n’est pas connecté', () => {
    expect(parseIdentity(JSON.stringify({ loggedIn: false, authMethod: 'none' }))).toBeUndefined()
  })

  it('rend undefined sur une sortie illisible plutôt que d’inventer', () => {
    for (const raw of ['', 'pas du json', '{"loggedIn":"oui"}']) {
      expect(parseIdentity(raw)).toBeUndefined()
    }
  })
})
