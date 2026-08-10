import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
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

describe('persistance — un compte non écrit est un compte perdu', () => {
  function storeWithFailingWrite(): ClaudeAccountsStore {
    return new ClaudeAccountsStore('C:/state/accounts.json', 'C:/state/accounts', {
      readFile: () => {
        throw new Error('ENOENT')
      },
      writeFile: () => {
        throw new Error('EACCES: permission denied')
      },
      makeDir: () => undefined,
      removeDir: () => undefined,
      now: () => '2026-08-06T00:00:00.000Z'
    })
  }

  it('ADD échoue bruyamment quand l’état ne peut pas être écrit', () => {
    // Vécu le 2026-08-07 : le compte apparaissait dans l’UI puis disparaissait a chaque
    // redemarrage, sans aucun signal — parce que l’echec d’ecriture etait avale en silence.
    const store = storeWithFailingWrite()
    expect(() => store.add()).toThrow(/EACCES/)
  })

  it('l’echec d’ecriture est EXPOSE, jamais avale', () => {
    const store = storeWithFailingWrite()
    try {
      store.add()
    } catch {
      // l’erreur est attendue ; ce qui compte ici c’est la trace laissee.
    }
    expect(store.persistError).toMatch(/EACCES/)
  })

  it('une BASCULE reste fail-open (ne casse pas l’appel en cours) mais trace l’echec', () => {
    const store = storeWithFailingWrite()
    expect(() => store.switchTo(DEFAULT_ACCOUNT_ID)).not.toThrow()
    expect(store.persistError).toMatch(/EACCES/)
  })
})

describe('relocation du userData — le dossier d’un compte suit la racine courante', () => {
  // Vecu le 2026-08-07 : le passage au stockage PORTABLE a deplace le userData dans le depot,
  // mais `dir` etait fige en ABSOLU dans l’etat -> le compte pointait encore sur l’ancien
  // %APPDATA%, hors du nouveau userData. Un chemin absolu persiste ne survit pas a un demenagement.
  const stale = JSON.stringify({
    version: 1,
    activeId: 'compte-2',
    accounts: [
      { id: 'default', addedAt: '2026-08-06T00:00:00.000Z' },
      {
        id: 'compte-2',
        dir: 'C:/ancien-emplacement/autowin-os/claude-accounts/compte-2',
        addedAt: '2026-08-06T00:00:00.000Z'
      }
    ]
  })

  function storeAt(root: string): ClaudeAccountsStore {
    return new ClaudeAccountsStore('C:/nouveau/accounts.json', root, {
      readFile: () => stale,
      writeFile: () => undefined,
      makeDir: () => undefined,
      removeDir: () => undefined,
      now: () => '2026-08-06T00:00:00.000Z'
    })
  }

  it('re-enracine le dossier du compte sur la racine COURANTE', () => {
    const store = storeAt('C:/nouveau/claude-accounts')
    const account = store.current().accounts.find((it) => it.id === 'compte-2')
    expect(account?.dir).toBe(join('C:/nouveau/claude-accounts', 'compte-2'))
  })

  it('l’env injecte au spawn pointe sur la racine COURANTE, pas l’ancienne', () => {
    const store = storeAt('C:/nouveau/claude-accounts')
    expect(store.env().CLAUDE_CONFIG_DIR).toBe(join('C:/nouveau/claude-accounts', 'compte-2'))
    expect(store.env().CLAUDE_CONFIG_DIR).not.toContain('ancien-emplacement')
  })

  it('le compte par defaut n’acquiert JAMAIS de dossier (non-regression)', () => {
    const store = storeAt('C:/nouveau/claude-accounts')
    const def = store.current().accounts.find((it) => it.id === 'default')
    expect(def?.dir).toBeUndefined()
  })
})

describe('rotation d’abonnement — choisir le compte suivant', () => {
  // Le store est le SEUL a connaitre la liste des comptes : la politique de choix vit donc ici, pas
  // dans le registre d'appels (qui, lui, connait les murs de quota mais pas les comptes).
  function storeAvecComptes(ids: string[]): ClaudeAccountsStore {
    const accounts = [
      { id: DEFAULT_ACCOUNT_ID, addedAt: '2026-08-06T00:00:00.000Z' },
      ...ids.map((id) => ({ id, dir: `C:/racine/${id}`, addedAt: '2026-08-06T00:00:00.000Z' }))
    ]
    return new ClaudeAccountsStore('C:/state/accounts.json', 'C:/racine', {
      readFile: () => JSON.stringify({ version: 1, activeId: DEFAULT_ACCOUNT_ID, accounts }),
      writeFile: () => undefined,
      makeDir: () => undefined,
      removeDir: () => undefined,
      now: () => '2026-08-06T00:00:00.000Z'
    })
  }

  it('bascule sur un AUTRE compte et le rend actif', () => {
    const store = storeAvecComptes(['compte-2'])
    const suivant = store.rotateAwayFrom(DEFAULT_ACCOUNT_ID)
    expect(suivant).toBe('compte-2')
    expect(store.active().id).toBe('compte-2')
  })

  it('ne rend RIEN quand il n’y a pas d’autre compte — pas de rotation en rond', () => {
    const store = storeAvecComptes([])
    expect(store.rotateAwayFrom(DEFAULT_ACCOUNT_ID)).toBeUndefined()
    expect(store.active().id).toBe(DEFAULT_ACCOUNT_ID)
  })

  it('ne rend JAMAIS le compte epuise lui-meme', () => {
    const store = storeAvecComptes(['compte-2', 'compte-3'])
    const suivant = store.rotateAwayFrom('compte-2')
    expect(suivant).not.toBe('compte-2')
    expect(['default', 'compte-3']).toContain(suivant)
  })

  it('avance dans le pool au lieu de reboucler entre les deux premiers comptes', () => {
    const store = storeAvecComptes(['compte-2', 'compte-3'])

    expect(store.rotateAwayFrom(DEFAULT_ACCOUNT_ID)).toBe('compte-2')
    expect(store.rotateAwayFrom('compte-2')).toBe('compte-3')
    expect(store.rotateAwayFrom('compte-3')).toBe(DEFAULT_ACCOUNT_ID)
  })

  it('un id inconnu ne casse rien et ne change pas le compte actif', () => {
    const store = storeAvecComptes(['compte-2'])
    const avant = store.active().id
    expect(() => store.rotateAwayFrom('compte-inexistant')).not.toThrow()
    expect(['default', 'compte-2']).toContain(store.active().id)
    void avant
  })
})
