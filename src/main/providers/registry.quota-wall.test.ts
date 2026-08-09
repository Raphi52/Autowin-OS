import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAccountsStore, DEFAULT_ACCOUNT_ID } from '../claude-accounts'
import { ProviderRegistry } from './registry'
import type { Message, ProviderAdapter, SendOptions, SendResult, StreamChunk } from './types'

/**
 * UN QUOTA ÉPUISÉ DOIT FERMER LA PORTE, PAS SEULEMENT ÊTRE BIEN NOMMÉ.
 *
 * Dépouillement des 1894 runs rouges le 2026-08-06 : **852 d'entre eux (70 % des échecs réels) ont pour
 * unique cause le mur de quota codex** — « You've hit your usage limit … try again at Aug 8th ».
 *
 * Le correctif du 2026-08-04 (`9cb3be8`) avait ajouté la SIGNATURE `usage-limit-reached` pour cesser de
 * relancer à l'intérieur d'un tour. Mais rien n'empêchait de LANCER un run neuf vers le même provider
 * mort : 285 runs ont heurté le mur APRÈS ce correctif, le dernier le 2026-08-05 à 16:29. Le message de
 * ce commit annonçait « bloque enfin le provider » — le code ne le faisait pas.
 *
 * Le registre est « le seul point par lequel l'app envoie un tour » : le disjoncteur y couvre d'un coup
 * le chat, les phases, le fan-out, le juge et la réparation.
 */

class FauxProvider implements ProviderAdapter {
  appels = 0
  /** Erreur à lever au prochain appel ; `undefined` = réussir. */
  erreur: Error | undefined

  constructor(readonly id: string) {}

  async auth(): Promise<boolean> {
    return true
  }

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void messages
    void options
    this.appels += 1
    if (this.erreur) throw this.erreur
    return { text: 'ok', provider: this.id, systemInjected: false }
  }
}

/** Le refus tel que le provider l'écrit vraiment, relevé dans les journaux de production. */
const MUR_DE_QUOTA = new Error(
  'codex exec échec exit-code=1 last-event={"type":"turn.failed","error":{"message":' +
    '"You\'ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more ' +
    'credits or try again at Aug 8th, 2026 7:20 AM."}}'
)

/** Un rate-limit PASSAGER : même HTTP 429, mais il se rétablit en secondes. */
const RATE_LIMIT = new Error('codex responses HTTP 429 — rate limit exceeded, retry after 20s')

const UN_TOUR = [{ role: 'user' as const, content: 'travaille' }]

describe('disjoncteur de quota provider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('après un mur de quota, l’appel suivant est REFUSÉ sans toucher l’adaptateur', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)

    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()
    expect(codex.appels).toBe(1)

    // Le mur est maintenant connu : le second appel ne doit PAS repartir vers le provider.
    codex.erreur = undefined
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/quota/i)
    expect(codex.appels).toBe(1) // toujours 1 : rien n'a été lancé
  })

  it('le refus DIT pourquoi et jusqu’à quand — sinon il est indiscernable d’une panne', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)
    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()

    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/codex/)
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/quota/i)
  })

  it('un rate-limit PASSAGER n’ouvre PAS le disjoncteur — discriminant', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)

    codex.erreur = RATE_LIMIT
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()

    // Bloquer là-dessus transformerait une attente de 20 s en panne de provider pour tout le run.
    codex.erreur = undefined
    await expect(registry.send('codex', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })
    expect(codex.appels).toBe(2)
  })

  it('le mur d’un provider ne ferme pas la porte des AUTRES — discriminant', async () => {
    const codex = new FauxProvider('codex')
    const claude = new FauxProvider('claude')
    const registry = new ProviderRegistry().register(codex).register(claude)

    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()

    await expect(registry.send('claude', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })
    expect(claude.appels).toBe(1)
  })

  it('AUCUNE sonde automatique : le temps qui passe ne redéclenche aucun appel payant', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)

    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/quota/i)

    // Re-tester periodiquement si le quota est revenu COUTERAIT du quota, pour une verification que
    // personne n'a demandee. Meme six heures plus tard, rien ne repart de soi-meme : c'est l'utilisateur
    // qui leve le mur en relancant l'app, au moment ou il veut travailler.
    codex.erreur = undefined
    vi.setSystemTime(new Date('2026-08-06T16:00:00Z'))
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/quota/i)
    expect(codex.appels).toBe(1)
  })

  it('le refus dit COMMENT lever le mur — sinon il ressemble a une impasse', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)
    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()

    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/relancer l'app/i)
  })
})

/**
 * LE MUR DOIT ÊTRE PAR COMPTE, PAS PAR PROVIDER.
 *
 * Constaté le 2026-08-07 en cadrant le multi-comptes Claude : `quotaWalls` est indexé sur `route.id`,
 * l'id du PROVIDER. Deux abonnements Claude distincts (deux `CLAUDE_CONFIG_DIR`) partagent donc le
 * même mur — le quota épuisé de l'un condamne l'autre, alors que c'est exactement pour cela qu'on
 * paie deux abonnements. Le mur doit porter sur le COUPLE (provider, compte actif).
 */
describe('mur de quota — isolation par compte', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('le quota épuisé d’un compte ne mure PAS l’autre compte', async () => {
    const claude = new FauxProvider('claude')
    let compteActif = 'compte-A'
    const registry = new ProviderRegistry(undefined, undefined, () => compteActif).register(claude)

    // Compte A épuise son quota : il est mure.
    claude.erreur = MUR_DE_QUOTA
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow()
    claude.erreur = undefined
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota/i)
    const appelsApresMurA = claude.appels

    // Bascule sur le compte B : son quota est INTACT, l'appel doit PARTIR.
    compteActif = 'compte-B'
    const resultat = await registry.send('claude', UN_TOUR)
    expect(resultat.text).toBe('ok')
    expect(claude.appels).toBe(appelsApresMurA + 1)
  })

  it('le mur du compte A tient toujours quand on y revient', async () => {
    const claude = new FauxProvider('claude')
    let compteActif = 'compte-A'
    const registry = new ProviderRegistry(undefined, undefined, () => compteActif).register(claude)

    claude.erreur = MUR_DE_QUOTA
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow()
    claude.erreur = undefined

    compteActif = 'compte-B'
    await registry.send('claude', UN_TOUR)

    // Retour sur A : le mur ne doit pas avoir ete efface par le passage sur B.
    compteActif = 'compte-A'
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota/i)
  })

  it('sans resolveur de compte, le comportement d’avant est INCHANGÉ (non-régression)', async () => {
    const codex = new FauxProvider('codex')
    const registry = new ProviderRegistry().register(codex)
    codex.erreur = MUR_DE_QUOTA
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow()
    codex.erreur = undefined
    await expect(registry.send('codex', UN_TOUR)).rejects.toThrow(/quota/i)
    expect(codex.appels).toBe(1)
  })
})

/**
 * ROTATION D'ABONNEMENT — un abonnement epuise ne doit pas ARRETER le travail s'il en reste un autre.
 *
 * Suite directe de l'isolation par compte ci-dessus : separer les murs empeche la contamination, mais
 * ne fait pas encore SERVIR le second abonnement. Tant que la bascule est manuelle, l'utilisateur
 * decouvre le mur en pleine session et doit intervenir. La rotation ferme cette derniere marche.
 *
 * Contrat : le registre ne CHOISIT pas le compte (il ne connait pas le store) — il DEMANDE une
 * rotation au pool, qui bascule et rend le nouvel id. Le registre ne fait que constater le resultat.
 */
describe('rotation d’abonnement sur quota epuise', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /**
   * Un pool de deux comptes. Le quota appartient au COMPTE : `compte-A` est epuise, `compte-B` a
   * encore du sien — donc basculer sur B doit rendre les appels a nouveau possibles. C'est modelise
   * en liberant l'erreur du faux provider au moment de la bascule.
   */
  function poolDeDeuxComptes(provider: FauxProvider): {
    actif: () => string
    rotate: (providerId: string, walled: string) => string | undefined
    rotations: string[]
  } {
    let actif = 'compte-A'
    const rotations: string[] = []
    return {
      actif: () => actif,
      rotate: (_providerId, walled) => {
        const suivant = walled === 'compte-A' ? 'compte-B' : undefined
        if (suivant) {
          actif = suivant
          rotations.push(suivant)
          provider.erreur = undefined // le quota de B n'est pas epuise
        }
        return suivant
      },
      rotations
    }
  }

  it('un tour qui heurte le mur BASCULE et REUSSIT sur l’autre abonnement', async () => {
    const claude = new FauxProvider('claude')
    const pool = poolDeDeuxComptes(claude)
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => pool.actif(),
      pool.rotate
    ).register(claude)

    // Le premier appel echoue sur quota. Il ne doit PAS remonter l'erreur : le pool a un compte libre.
    claude.erreur = MUR_DE_QUOTA
    const rendu = await registry.send('claude', UN_TOUR)
    expect(rendu.text).toBe('ok')
    expect(pool.rotations).toEqual(['compte-B'])
    expect(claude.appels).toBe(2) // 1 refus + 1 reussite apres bascule
  })

  it('sans autre abonnement disponible, l’erreur remonte — pas de boucle', async () => {
    const claude = new FauxProvider('claude')
    const actif = 'compte-Z' // le pool ne sait pas ou aller depuis Z
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => actif,
      () => undefined
    ).register(claude)
    claude.erreur = MUR_DE_QUOTA
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/usage limit|quota/i)
    expect(claude.appels).toBe(1) // un seul essai : aucune relance en aveugle
  })

  it('le mur du compte epuise reste POSE apres la rotation', async () => {
    const claude = new FauxProvider('claude')
    const pool = poolDeDeuxComptes(claude)
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => pool.actif(),
      pool.rotate
    ).register(claude)

    claude.erreur = MUR_DE_QUOTA
    await registry.send('claude', UN_TOUR)

    // On revient a la main sur A : il doit toujours etre mure (son quota n'est pas revenu).
    claude.erreur = undefined
    const registryA = registry as unknown as { quotaWalls: Map<string, string> }
    expect([...registryA.quotaWalls.keys()].some((k) => k.includes('compte-A'))).toBe(true)
  })

  it('un rate-limit PASSAGER ne declenche AUCUNE rotation (discriminant)', async () => {
    const claude = new FauxProvider('claude')
    const pool = poolDeDeuxComptes(claude)
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => pool.actif(),
      pool.rotate
    ).register(claude)

    claude.erreur = RATE_LIMIT
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/429|rate limit/i)
    expect(pool.rotations).toEqual([]) // brûler un abonnement sur une attente de 20s serait absurde
  })

  it('deux refus concurrents du meme compte ne font qu une rotation et reprennent sur le successeur', async () => {
    let actif = 'compte-A'
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: string[] = []
    const rotations: string[] = []
    const claude: ProviderAdapter = {
      id: 'claude',
      async auth() {
        return true
      },
      // eslint-disable-next-line require-yield
      async *send() {
        const account = actif
        calls.push(account)
        if (account === 'compte-A') {
          await barrier
          throw MUR_DE_QUOTA
        }
        return { text: 'ok', provider: 'claude', systemInjected: false }
      }
    }
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => actif,
      (_providerId, walled) => {
        actif = walled === 'compte-A' ? 'compte-B' : 'compte-A'
        rotations.push(`${walled}->${actif}`)
        return actif
      }
    ).register(claude)

    const first = registry.send('claude', UN_TOUR)
    const second = registry.send('claude', UN_TOUR)
    await vi.waitFor(() => expect(calls).toEqual(['compte-A', 'compte-A']))
    release()

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ text: 'ok' }),
      expect.objectContaining({ text: 'ok' })
    ])
    expect(rotations).toEqual(['compte-A->compte-B'])
    expect(actif).toBe('compte-B')
    expect(calls).toEqual(['compte-A', 'compte-A', 'compte-B', 'compte-B'])
  })

  it('saute deux comptes epuises pour atteindre un troisieme compte valide', async () => {
    let actif = 'compte-A'
    const calls: string[] = []
    const rotations: string[] = []
    const claude: ProviderAdapter = {
      id: 'claude',
      async auth() {
        return true
      },
      // eslint-disable-next-line require-yield
      async *send() {
        calls.push(actif)
        if (actif !== 'compte-C') throw MUR_DE_QUOTA
        return { text: 'ok', provider: 'claude', systemInjected: false }
      }
    }
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => actif,
      (_providerId, walled) => {
        actif = walled === 'compte-A' ? 'compte-B' : walled === 'compte-B' ? 'compte-C' : actif
        rotations.push(`${walled}->${actif}`)
        return actif
      }
    ).register(claude)

    await expect(registry.send('claude', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })
    expect(calls).toEqual(['compte-A', 'compte-B', 'compte-C'])
    expect(rotations).toEqual(['compte-A->compte-B', 'compte-B->compte-C'])
  })

  it('parcourt A puis B puis C avec le vrai store branche comme en production', async () => {
    const store = new ClaudeAccountsStore('C:/state/accounts.json', 'C:/state/accounts', {
      readFile: () =>
        JSON.stringify({
          version: 1,
          activeId: DEFAULT_ACCOUNT_ID,
          accounts: [
            { id: DEFAULT_ACCOUNT_ID, addedAt: '2026-08-06T00:00:00.000Z' },
            {
              id: 'compte-2',
              dir: 'C:/state/accounts/compte-2',
              addedAt: '2026-08-06T00:00:00.000Z'
            },
            {
              id: 'compte-3',
              dir: 'C:/state/accounts/compte-3',
              addedAt: '2026-08-06T00:00:00.000Z'
            }
          ]
        }),
      writeFile: () => undefined,
      makeDir: () => undefined,
      removeDir: () => undefined,
      now: () => '2026-08-06T00:00:00.000Z'
    })
    const calls: string[] = []
    const claude: ProviderAdapter = {
      id: 'claude',
      async auth() {
        return true
      },
      // eslint-disable-next-line require-yield
      async *send() {
        const account = store.active().id
        calls.push(account)
        if (account !== 'compte-3') throw MUR_DE_QUOTA
        return { text: 'ok', provider: 'claude', systemInjected: false }
      }
    }
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => store.active().id,
      (_providerId, walled) => store.rotateAwayFrom(walled)
    ).register(claude)

    await expect(registry.send('claude', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })
    expect(calls).toEqual([DEFAULT_ACCOUNT_ID, 'compte-2', 'compte-3'])
    expect(store.active().id).toBe('compte-3')
  })
})
