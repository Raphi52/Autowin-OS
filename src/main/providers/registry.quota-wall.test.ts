import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAccountsStore, DEFAULT_ACCOUNT_ID } from './claude-accounts'
import { ProviderRegistry } from './registry'
import { estMurDeQuota, instantDeRetourAnnonce } from '../../shared/reprise-quota'
import {
  ProviderCallError,
  type Message,
  type ProviderAdapter,
  type SendOptions,
  type SendResult,
  type StreamChunk
} from './types'

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
 * QUOTA ÉPUISÉ : LE COMPTE NE CHANGE JAMAIS TOUT SEUL (2026-11-10).
 *
 * Le registre ne tourne plus vers un autre abonnement : un tour qui heurte le mur de son compte s'arrête
 * et le dit. Le changement de compte reste le geste de l'utilisateur, avec la puce du compte.
 */
describe('quota épuisé — le compte ne change jamais tout seul', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('un tour qui heurte le mur S’ARRÊTE sur le compte en cours : aucun autre compte n’est essayé', async () => {
    const claude = new FauxProvider('claude')
    const registry = new ProviderRegistry(undefined, undefined, () => 'compte-A').register(claude)

    claude.erreur = MUR_DE_QUOTA
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/usage limit|quota/i)
    expect(claude.appels).toBe(1) // un seul essai : aucun autre compte n'est tenté
  })

  it('un rate-limit PASSAGER ne pose AUCUN mur : l’appel suivant repart sans attendre', async () => {
    const claude = new FauxProvider('claude')
    const registry = new ProviderRegistry(undefined, undefined, () => 'compte-A').register(claude)

    claude.erreur = RATE_LIMIT
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/429|rate limit/i)
    claude.erreur = undefined
    await expect(registry.send('claude', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })
    expect(claude.appels).toBe(2)
  })

  it('le mur d’un compte épuisé tient : y revenir à la main ne rappelle PAS le provider', async () => {
    const claude = new FauxProvider('claude')
    let actif = 'compte-A'
    const registry = new ProviderRegistry(undefined, undefined, () => actif).register(claude)

    claude.erreur = MUR_DE_QUOTA
    await registry.send('claude', UN_TOUR).catch(() => undefined)

    // L'utilisateur bascule à la main sur B : B répond, A reste mûr.
    actif = 'compte-B'
    claude.erreur = undefined
    await expect(registry.send('claude', UN_TOUR)).resolves.toMatchObject({ text: 'ok' })

    // Revenir sur A ne relance rien : son quota n'est pas revenu.
    actif = 'compte-A'
    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/quota|usage limit/i)
    expect(claude.appels).toBe(2) // 1 refus de A + 1 réponse de B, rien de plus
  })

  it('avec le vrai store de comptes, branché comme en production, le compte actif ne bouge jamais', async () => {
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
        calls.push(store.active().id)
        throw MUR_DE_QUOTA
      }
    }
    const registry = new ProviderRegistry(undefined, undefined, () => store.active().id).register(
      claude
    )

    await expect(registry.send('claude', UN_TOUR)).rejects.toThrow(/usage limit|quota/i)
    expect(calls).toEqual([DEFAULT_ACCOUNT_ID])
    expect(store.active().id).toBe(DEFAULT_ACCOUNT_ID)
  })
})

/**
 * QUOTA ÉPUISÉ EN PLEIN TOUR, APRÈS DU TEXTE AFFICHÉ (2026-10-22).
 *
 * Cas réel : `run-stdout/c6ba0030-384c-4095-ac84-c96af2026180.stdout.jsonl` est UN appel de 31 min,
 * 96 blocs de texte affichés, qui finit sur « You've hit your session limit · resets 11:30am ». Le texte
 * affiché est réel : il reste. Rien ne se rejoue (il serait doublé), et l'erreur nomme le compte épuisé.
 */
describe('quota épuisé APRÈS du texte affiché : le tour s’arrête, rien ne se rejoue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-22T08:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Le refus RÉEL de Claude, tel que `claude.ts` le lève sur l'événement `result` en erreur. */
  const SESSION_LIMIT = (): ProviderCallError =>
    new ProviderCallError(
      "Claude a interrompu l'appel : You've hit your session limit · resets 11:30am (Europe/Paris)",
      { code: 'success', retryable: false }
    )

  /**
   * Un faux Claude multi-comptes : sur un compte de `epuises`, il AFFICHE d'abord du texte puis tombe
   * sur le mur — la forme exacte du tour de 31 min. Ailleurs, il répond.
   */
  function claudeQuiCoupeApresTexte(
    compteActif: () => string,
    epuises: Set<string>,
    pendantLAppel?: () => void
  ): ProviderAdapter & { appels: string[] } {
    const appels: string[] = []
    return {
      id: 'claude',
      appels,
      async auth() {
        return true
      },
      async *send() {
        const compte = compteActif()
        appels.push(compte)
        if (epuises.has(compte)) {
          yield { delta: 'Je commence le travail, je lis les fichiers…' }
          pendantLAppel?.()
          throw SESSION_LIMIT()
        }
        return { text: 'ok', provider: 'claude', systemInjected: false }
      }
    }
  }

  it('le tour s’arrête sur le compte coupé et le nomme : aucun autre compte n’est essayé', async () => {
    const actif = 'compte-A'
    const claude = claudeQuiCoupeApresTexte(() => actif, new Set(['compte-A']))
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => actif,
      undefined,
      (_providerId, compte) => (compte === 'compte-A' ? 'perso@gmail.com' : undefined)
    ).register(claude)

    const vus: string[] = []
    const erreur = await registry
      .send('claude', UN_TOUR, {}, (c) => vus.push(c.delta))
      .catch((e: unknown) => e)

    // Le texte déjà affiché reste, et rien ne se rejoue : un seul appel, sur le compte coupé.
    expect(vus).toEqual(['Je commence le travail, je lis les fichiers…'])
    expect(claude.appels).toEqual(['compte-A'])
    expect(actif).toBe('compte-A')
    expect(erreur).toBeInstanceOf(ProviderCallError)
    expect((erreur as Error).message).toContain('« perso@gmail.com »')
    expect((erreur as Error).message).toContain('choisis un autre compte')
  })

  it('une bascule faite à la main pendant l’appel n’est pas écrasée : le message nomme le compte appelé', async () => {
    const NOMS: Record<string, string> = {
      'compte-A': 'perso@gmail.com',
      'compte-C': 'pro@entreprise.fr'
    }
    let actif = 'compte-A'
    const claude = claudeQuiCoupeApresTexte(
      () => actif,
      new Set(['compte-A']),
      () => (actif = 'compte-C')
    )
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => actif,
      undefined,
      (_providerId, compte) => NOMS[compte]
    ).register(claude)

    const erreur = (await registry.send('claude', UN_TOUR).catch((e: unknown) => e)) as Error
    // Le compte APPELÉ est nommé, pas celui que l'utilisateur a choisi entre-temps.
    expect(erreur.message).toContain('« perso@gmail.com »')
    expect(erreur.message).not.toContain('pro@entreprise.fr')
    expect(actif).toBe('compte-C')
    expect(claude.appels).toEqual(['compte-A'])
  })
})

/**
 * DEUX COMPTES ÉPUISÉS : CHAQUE REFUS NOMME LE SIEN, À SON TOUR (2026-11-09).
 *
 * Cas réel (run-stdout f3c665df puis cdca4224, 2026-11-09 19:27) : le compte gmail atteint sa limite
 * hebdomadaire après 25 min de travail, puis le compte pro, à sa limite lui aussi. Le fil n'affichait que
 * le dernier refus, « You've hit your weekly limit · resets 1am », sans nommer de compte : l'utilisateur
 * y a lu une erreur de compte. Le compte ne change plus seul : chaque refus nomme le compte qui l'a donné.
 */
describe('deux comptes épuisés : chaque refus nomme le sien', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-09T18:27:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const REFUS_GMAIL =
    "Claude a interrompu l'appel : You've hit your weekly limit · resets Nov 12, 4am (Europe/Paris)"
  const REFUS_PRO =
    "Claude a interrompu l'appel : You've hit your weekly limit · resets 1am (Europe/Paris)"
  const NOMS: Record<string, string> = {
    'compte-3': 'perso@gmail.com',
    default: 'pro@entreprise.fr'
  }

  function banc() {
    let actif = 'compte-3'
    const appels: string[] = []
    const claude: ProviderAdapter = {
      id: 'claude',
      async auth() {
        return true
      },
      async *send() {
        const compte = actif
        appels.push(compte)
        yield {
          delta: compte === 'compte-3' ? 'Je lis les fichiers…' : "You've hit your weekly limit"
        }
        throw new ProviderCallError(compte === 'compte-3' ? REFUS_GMAIL : REFUS_PRO, {
          code: 'success',
          retryable: false
        })
      }
    }
    const registry = new ProviderRegistry(
      undefined,
      undefined,
      () => actif,
      undefined,
      (_providerId, compte) => NOMS[compte]
    ).register(claude)
    return {
      registry,
      appels,
      basculer: (vers: string): void => {
        actif = vers
      }
    }
  }

  it('le refus du compte en cours le nomme, avec sa date de retour', async () => {
    const { registry, appels } = banc()
    const erreur = (await registry.send('claude', UN_TOUR).catch((e: unknown) => e)) as Error
    expect(appels).toEqual(['compte-3'])
    expect(erreur.message).toContain('« perso@gmail.com »')
    expect(erreur.message).toContain('jeudi 12 novembre')
  })

  it('après une bascule à la main sur l’autre compte, son refus le nomme à son tour, avec SA date de retour', async () => {
    const { registry, appels, basculer } = banc()
    await registry.send('claude', UN_TOUR).catch(() => undefined)
    basculer('default') // l'utilisateur choisit l'autre compte à la main

    const erreur = (await registry.send('claude', UN_TOUR).catch((e: unknown) => e)) as Error
    expect(appels).toEqual(['compte-3', 'default'])
    expect(erreur).toBeInstanceOf(ProviderCallError)
    expect(erreur.message).toContain('« pro@entreprise.fr »')
    expect(erreur.message).toContain('mardi 10 novembre')
    expect(erreur.message).not.toContain('perso@gmail.com')
    // Le refus d'origine reste cité en entier : la reprise automatique y relit l'heure de retour.
    expect(erreur.message).toContain(REFUS_PRO)
    expect(estMurDeQuota(erreur.message)).toBe(true)
    expect(instantDeRetourAnnonce(erreur.message)).toBe(new Date('2026-11-10T00:00:00Z').valueOf())
  })

  it('sans compte (autre fournisseur), le refus reste celui d’avant — inchangé', async () => {
    const codex: ProviderAdapter = {
      id: 'codex',
      async auth() {
        return true
      },
      // eslint-disable-next-line require-yield
      async *send() {
        throw new ProviderCallError(REFUS_PRO, { code: 'success', retryable: false })
      }
    }
    const registry = new ProviderRegistry().register(codex)
    const erreur = (await registry.send('codex', UN_TOUR).catch((e: unknown) => e)) as Error
    expect(erreur.message).toBe(REFUS_PRO)
  })
})
