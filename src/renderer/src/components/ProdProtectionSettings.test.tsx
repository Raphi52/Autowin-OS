// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProdProtectionSettings } from './ProdProtectionSettings'
import type { EtatPorteProd, PropositionAutoriteProd } from '../../../shared/prod-protection'

/**
 * L'ÉCRAN DE RÉGLAGE DE LA PROTECTION — ce qui est vérifié ici :
 *   - l'état est DIT en clair, et une protection qui dort ne s'affiche jamais comme active ;
 *   - changer la phrase exige la phrase en cours ;
 *   - les champs masqués sont vidés à chaque sortie, réussie ou non.
 */
let hote: HTMLDivElement
let racine: Root

const PORTE_CONFIRMATION: EtatPorteProd = {
  active: true,
  niveau: 'confirmation' as const,
  raison: 'Chaque geste de production ouvre une fenêtre de confirmation.',
  phraseDefinie: false,
  declarees: 0,
  anomalies: [] as string[],
  chemin: 'C:/data/prod-autorite.json'
}

const PROPOSITION: PropositionAutoriteProd = {
  ok: true,
  exploitees: 2,
  ajoutees: [
    { nom: 'DB_ALPHA', classe: 'prod' },
    { nom: 'APP_DEV', classe: 'non-prod' }
  ],
  passeesEnProd: ['DB_PAPA'],
  conservees: 3,
  anomalies: [],
  contenu: '[\n  { "nature": "base", "nom": "DB_ALPHA", "classe": "prod" }\n]\n'
}

const PORTE_DORT: EtatPorteProd = {
  ...PORTE_CONFIRMATION,
  active: false,
  niveau: 'aucun' as const,
  raison: 'Protection désactivée : les gestes de production partent sans rien demander.'
}

const PORTE_ACTIVE: EtatPorteProd = {
  ...PORTE_CONFIRMATION,
  niveau: 'phrase' as const,
  raison: 'Chaque geste de production demande la phrase de passe.',
  phraseDefinie: true,
  declarees: 3,
  anomalies: ['classe « ouvert » invalide']
}

function poserApi(
  options: {
    definie?: boolean
    porte?: EtatPorteProd
    definir?: () => Promise<{ ok: boolean; erreur?: string }>
    proposition?: PropositionAutoriteProd
  } = {}
) {
  const api = {
    prodAutoriteProposition: vi.fn(async () => options.proposition ?? PROPOSITION),
    prodPorteEtat: vi.fn(async () => options.porte ?? PORTE_CONFIRMATION),
    prodPorteNiveau: vi.fn(async () => ({ ok: true }) as { ok: boolean; erreur?: string }),
    prodPassphraseEtat: vi.fn(async () => ({
      definie: options.definie ?? false,
      definieLe: 1,
      longueurMinimale: 12
    })),
    prodPassphraseDefinir: vi.fn(
      options.definir ?? (async (): Promise<{ ok: boolean; erreur?: string }> => ({ ok: true }))
    )
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return api
}

async function rendre(): Promise<void> {
  await act(async () => {
    racine.render(<ProdProtectionSettings />)
  })
  // La lecture initiale passe par `queueMicrotask` : on laisse la file se vider.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function champ(id: string): HTMLInputElement {
  return hote.querySelector(`#${id}`) as HTMLInputElement
}

async function taper(id: string, valeur: string): Promise<void> {
  const entree = champ(id)
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    'value'
  )?.set
  await act(async () => {
    setter?.call(entree, valeur)
    entree.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function valider(): Promise<void> {
  await act(async () => {
    ;(hote.querySelector('.prod-valider') as HTMLButtonElement).click()
  })
}

beforeEach(() => {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})

afterEach(async () => {
  await act(async () => racine.unmount())
  hote.remove()
  vi.restoreAllMocks()
})

describe('état affiché', () => {
  it('dit « Active » par défaut : toute requête prod ouvre une confirmation', async () => {
    poserApi()
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-etat"]')?.textContent).toBe('Active')
    expect(hote.textContent).toContain('fenêtre de confirmation')
  })

  it('dit « Inactive » SEULEMENT quand le niveau est « aucun »', async () => {
    poserApi({ porte: PORTE_DORT })
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-etat"]')?.textContent).toBe('Inactive')
    expect(hote.textContent).toContain('sans rien demander')
  })

  it('dit « Active » au niveau phrase', async () => {
    poserApi({ definie: true, porte: PORTE_ACTIVE })
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-etat"]')?.textContent).toBe('Active')
  })

  it('AVERTIT que zéro cible déclarée rendra tout bloquant', async () => {
    poserApi()
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-declarees"]')?.textContent).toContain(
      'maquettes comprises'
    )
  })

  it('montre le fichier de déclaration et les lignes écartées', async () => {
    poserApi({ definie: true, porte: PORTE_ACTIVE })
    await rendre()
    expect(hote.textContent).toContain('prod-autorite.json')
    expect(hote.querySelector('[data-testid="prod-protection-anomalies"]')?.textContent).toContain(
      'classe « ouvert » invalide'
    )
  })

  it('affiche « Inconnu » — jamais « Active » — quand l’état est illisible', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
      prodPorteEtat: vi.fn(async () => {
        throw new Error('canal coupé')
      }),
      prodPassphraseEtat: vi.fn(async () => {
        throw new Error('canal coupé')
      }),
      prodPassphraseDefinir: vi.fn()
    }
    await rendre()
    expect(hote.querySelector('[data-testid="prod-protection-etat"]')?.textContent).toBe('Inconnu')
  })
})

describe('définition et changement', () => {
  it('ne demande PAS de phrase actuelle au premier réglage', async () => {
    const api = poserApi()
    await rendre()
    expect(champ('prod-actuelle')).toBeNull()
    await taper('prod-nouvelle', 'ma-toute-premiere-phrase')
    await taper('prod-confirmation', 'ma-toute-premiere-phrase')
    await valider()
    expect(api.prodPassphraseDefinir).toHaveBeenCalledWith('ma-toute-premiere-phrase', undefined)
    expect(hote.textContent).toContain('Protection activée')
  })

  it('exige la phrase actuelle pour en changer, et la transmet', async () => {
    const api = poserApi({ definie: true, porte: PORTE_ACTIVE })
    await rendre()
    expect(champ('prod-actuelle')).not.toBeNull()
    await taper('prod-actuelle', 'phrase-de-passe-de-reference')
    await taper('prod-nouvelle', 'une-autre-phrase-longue')
    await taper('prod-confirmation', 'une-autre-phrase-longue')
    await valider()
    expect(api.prodPassphraseDefinir).toHaveBeenCalledWith(
      'une-autre-phrase-longue',
      'phrase-de-passe-de-reference'
    )
  })

  it('n’envoie RIEN quand les deux saisies diffèrent', async () => {
    const api = poserApi()
    await rendre()
    await taper('prod-nouvelle', 'une-phrase-bien-longue')
    await taper('prod-confirmation', 'une-phrase-differente')
    await valider()
    expect(api.prodPassphraseDefinir).not.toHaveBeenCalled()
    expect(hote.textContent).toContain('ne correspondent pas')
  })

  it('affiche le refus du processus principal et VIDE les champs', async () => {
    poserApi({
      definie: true,
      porte: PORTE_ACTIVE,
      definir: async () => ({ ok: false, erreur: 'Phrase de passe actuelle incorrecte.' })
    })
    await rendre()
    await taper('prod-actuelle', 'pas-la-bonne-du-tout')
    await taper('prod-nouvelle', 'une-autre-phrase-longue')
    await taper('prod-confirmation', 'une-autre-phrase-longue')
    await valider()
    expect(hote.textContent).toContain('actuelle incorrecte')
    expect(champ('prod-actuelle').value).toBe('')
    expect(champ('prod-nouvelle').value).toBe('')
    expect(champ('prod-confirmation').value).toBe('')
  })

  it('vide aussi les champs après une réussite', async () => {
    poserApi()
    await rendre()
    await taper('prod-nouvelle', 'ma-toute-premiere-phrase')
    await taper('prod-confirmation', 'ma-toute-premiere-phrase')
    await valider()
    expect(champ('prod-nouvelle').value).toBe('')
    expect(champ('prod-confirmation').value).toBe('')
  })

  it('n’affiche jamais la phrase : les champs sont masqués', async () => {
    poserApi({ definie: true, porte: PORTE_ACTIVE })
    await rendre()
    for (const id of ['prod-actuelle', 'prod-nouvelle', 'prod-confirmation']) {
      expect(champ(id).type).toBe('password')
    }
  })

  it('garde le bouton inactif tant que les champs neufs sont vides', async () => {
    poserApi()
    await rendre()
    expect(hote.querySelector<HTMLButtonElement>('.prod-valider')?.disabled).toBe(true)
  })

  it('relit l’état après un changement réussi : l’écran ne ment pas sur ce qui vient d’arriver', async () => {
    const api = poserApi()
    await rendre()
    await taper('prod-nouvelle', 'ma-toute-premiere-phrase')
    await taper('prod-confirmation', 'ma-toute-premiere-phrase')
    await valider()
    expect(api.prodPorteEtat.mock.calls.length).toBeGreaterThan(1)
  })
})

/**
 * LE CHOIX DU NIVEAU — la vraie décision de cet écran. Le défaut, `confirmation`, répond au besoin
 * énoncé : une fenêtre « voulez-vous continuer ? » avant toute requête sur une base de production.
 */
describe('choix du niveau', () => {
  it('coche le niveau en vigueur, sans rien changer', async () => {
    const api = poserApi()
    await rendre()
    expect(hote.querySelector<HTMLInputElement>('#prod-niveau-confirmation')?.checked).toBe(true)
    expect(api.prodPorteNiveau).not.toHaveBeenCalled()
  })

  it('change le niveau au clic, et relit l’état ensuite', async () => {
    const api = poserApi()
    await rendre()
    await act(async () => {
      ;(hote.querySelector('#prod-niveau-phrase') as HTMLInputElement).click()
    })
    expect(api.prodPorteNiveau).toHaveBeenCalledWith('phrase')
    expect(api.prodPorteEtat.mock.calls.length).toBeGreaterThan(1)
  })

  it('affiche le refus du processus principal quand il garde la main', async () => {
    const api = poserApi({ definie: true, porte: PORTE_ACTIVE })
    api.prodPorteNiveau.mockResolvedValueOnce({
      ok: false,
      erreur: 'Saisis la phrase de passe pour baisser la garde.'
    })
    await rendre()
    await act(async () => {
      ;(hote.querySelector('#prod-niveau-aucun') as HTMLInputElement).click()
    })
    expect(hote.textContent).toContain('baisser la garde')
  })

  it('ne montre le formulaire de phrase QU’AU niveau phrase', async () => {
    poserApi()
    await rendre()
    expect(hote.querySelector<HTMLElement>('.prod-formulaire')?.hidden).toBe(true)
  })

  /*
   * L'ATTRIBUT NE SUFFIT PAS (constaté le 2026-10-11, conv-242) : le test ci-dessus passait alors
   * que le champ « Phrase de passe » restait VISIBLE au niveau « confirmation ». La feuille pose
   * `display: grid` sur le formulaire, et une règle d'auteur passe devant le `display: none` que le
   * navigateur donne à `[hidden]`. On mesure donc l'affichage avec la VRAIE feuille.
   */
  it('le formulaire masqué est réellement invisible, feuille de style comprise', async () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/components/ProdProtectionSettings.css'),
      'utf8'
    )
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    try {
      poserApi()
      await rendre()
      const formulaire = hote.querySelector<HTMLElement>('.prod-formulaire') as HTMLElement
      expect(formulaire.hidden).toBe(true)
      expect(getComputedStyle(formulaire).display).toBe('none')

      // Au niveau « phrase », il réapparaît bien avec sa mise en page.
      await act(async () => racine.unmount())
      racine = createRoot(hote)
      poserApi({ porte: PORTE_ACTIVE, definie: true })
      await rendre()
      const visible = hote.querySelector<HTMLElement>('.prod-formulaire') as HTMLElement
      expect(visible.hidden).toBe(false)
      expect(getComputedStyle(visible).display).toBe('grid')
    } finally {
      style.remove()
    }
  })
})

/**
 * LA LISTE PROPOSÉE DEPUIS LE CATALOGUE SQL. Autowin n'écrit jamais le fichier de déclaration : il
 * PROPOSE un contenu, l'utilisateur le recopie lui-même. Rien n'est demandé au catalogue tant que
 * l'utilisateur n'a pas cliqué.
 */
describe('proposition depuis le catalogue', () => {
  async function proposer(): Promise<void> {
    await act(async () => {
      ;(hote.querySelector('[data-testid="prod-catalogue-proposer"]') as HTMLButtonElement).click()
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('n’interroge PAS le catalogue à l’ouverture de l’écran', async () => {
    const api = poserApi()
    await rendre()
    expect(api.prodAutoriteProposition).not.toHaveBeenCalled()
    expect(hote.querySelector('[data-testid="prod-catalogue-contenu"]')).toBeNull()
  })

  it('montre au clic ce qui serait ajouté, passé en production et repris, puis le contenu', async () => {
    const api = poserApi()
    await rendre()
    await proposer()
    expect(api.prodAutoriteProposition).toHaveBeenCalledTimes(1)
    const resume = hote.querySelector('[data-testid="prod-catalogue-resume"]')?.textContent ?? ''
    expect(resume).toContain('2 base(s) à ajouter')
    expect(resume).toContain('1 en production')
    expect(resume).toContain('1 hors production')
    expect(resume).toContain('3 entrée(s) actuelle(s) reprise(s)')
    expect(hote.querySelector('[data-testid="prod-catalogue-prod"]')?.textContent).toContain(
      'DB_PAPA'
    )
    const contenu = hote.querySelector(
      '[data-testid="prod-catalogue-contenu"]'
    ) as HTMLTextAreaElement
    expect(contenu.readOnly).toBe(true)
    expect(contenu.value).toBe(PROPOSITION.ok ? PROPOSITION.contenu : '')
  })

  it('DIT que le fichier n’est pas écrit par Autowin, et ne déclenche aucune écriture', async () => {
    const api = poserApi()
    await rendre()
    await proposer()
    expect(hote.querySelector('[data-testid="prod-catalogue"]')?.textContent).toContain(
      'Autowin n’écrit jamais ce fichier'
    )
    expect(api.prodPassphraseDefinir).not.toHaveBeenCalled()
    expect(api.prodPorteNiveau).not.toHaveBeenCalled()
  })

  it('affiche l’échec du catalogue, sans contenu à coller', async () => {
    poserApi({ proposition: { ok: false, erreur: 'Catalogue SQL illisible : délai dépassé.' } })
    await rendre()
    await proposer()
    expect(hote.querySelector('[data-testid="prod-catalogue"]')?.textContent).toContain(
      'Catalogue SQL illisible : délai dépassé.'
    )
    expect(hote.querySelector('[data-testid="prod-catalogue-contenu"]')).toBeNull()
  })

  it('dit quand la déclaration couvre déjà tout le catalogue', async () => {
    poserApi({
      proposition: { ...PROPOSITION, ajoutees: [], passeesEnProd: [] } as PropositionAutoriteProd
    })
    await rendre()
    await proposer()
    expect(hote.querySelector('[data-testid="prod-catalogue"]')?.textContent).toContain(
      'couvre déjà tout le catalogue'
    )
    expect(hote.querySelector('[data-testid="prod-catalogue-contenu"]')).toBeNull()
  })
})
