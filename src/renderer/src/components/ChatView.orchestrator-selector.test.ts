import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildOrchestratorModelGroups } from './chat-view-model'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'
import { TEXTES_FR as TEXTES_PANNEAUX_FR } from '../textes-ecrans/chat-panneaux'

const source = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/ChatView.tsx'),
  'utf8'
)
const selectorSource = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/components/OrchestratorModelSelector.tsx'),
  'utf8'
)

describe('selecteur orchestrateur Chat', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  let container: HTMLDivElement | null = null
  let rendu: Root | null = null

  afterEach(() => {
    /*
     * DÉMONTER, pas seulement retirer le conteneur : le menu vit dans un PORTAIL de
     * `document.body`. Sans démontage, le menu d'un test survivait dans la page et le test suivant
     * comptait ses options en double (constaté le 2026-10-11 en ajoutant les tests conv-239).
     */
    act(() => rendu?.unmount())
    rendu = null
    container?.remove()
    container = null
  })

  async function renderSelector(
    props: Partial<ComponentProps<typeof OrchestratorModelSelector>> = {}
    // Rend la PAGE (`document.body`) et non plus le conteneur : le menu part dans un portail.
  ): Promise<HTMLElement> {
    container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    rendu = root
    await act(async () => {
      root.render(
        createElement(OrchestratorModelSelector, {
          busy: false,
          catalogLoaded: true,
          models: [],
          binding: { provider: 'codex', model: 'gpt-5' },
          pending: false,
          error: null,
          onSelect: vi.fn(),
          ...props
        })
      )
    })
    /*
     * Le menu du selecteur est devenu une fenetre FLOTTANTE : il est rendu dans `document.body`
     * par un portail, et seulement apres l'evenement `toggle` qui mesure sa position. Ces tests
     * cherchaient les options dans le conteneur, ou elles ne sont plus.
     */
    const details = container.querySelector('details') as HTMLDetailsElement | null
    if (details)
      await act(async () => {
        details.open = true
        details.dispatchEvent(new Event('toggle'))
      })
    return document.body
  }

  it('rend honnêtement un catalogue models() vide sans option inventée ni faux succès', async () => {
    const dom = await renderSelector()
    const selector = dom.querySelector('[data-testid="chat-orchestrator-model"]') as HTMLElement
    expect(selector.textContent).toContain('Aucun modèle disponible')
    expect(selector.dataset.disabled).toBe('true')
    expect(dom.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(dom.textContent).toContain('Catalogue de modèles vide.')
    expect(dom.textContent).not.toMatch(/enregistré|réussi/i)
  })

  it('ouvert en tête de conversation, le menu se pose SOUS le bouton (conv-239)', async () => {
    await renderSelector({
      models: [{ id: 'c1', provider: 'codex', model: 'gpt-5', label: 'GPT-5' }],
      ouverture: 'bas'
    })
    const menu = document.body.querySelector<HTMLElement>('.model-select-menu.is-flottant')
    expect(menu).not.toBeNull()
    expect(menu?.classList.contains('is-ouverture-bas')).toBe(true)
    // `top` posé, `bottom` neutralisé : la règle de base `bottom: calc(100% + 7px)` écraserait
    // sinon la hauteur du menu à zéro.
    expect(menu?.style.top).not.toBe('')
    expect(menu?.style.bottom).toBe('auto')
  })

  it('par défaut le menu reste posé AU-DESSUS du bouton (Routage inchangé)', async () => {
    await renderSelector({
      models: [{ id: 'c1', provider: 'codex', model: 'gpt-5', label: 'GPT-5' }]
    })
    const menu = document.body.querySelector<HTMLElement>('.model-select-menu.is-flottant')
    expect(menu?.style.top).toBe('')
    expect(menu?.style.bottom).not.toBe('')
    expect(document.body.querySelector('[data-testid="conv-model-defaut"]')).toBeNull()
  })

  it('une conversation qui a choisi son modèle peut revenir au défaut de l’application', async () => {
    const onChoisir = vi.fn()
    await renderSelector({
      models: [{ id: 'c1', provider: 'codex', model: 'gpt-5', label: 'GPT-5' }],
      ouverture: 'bas',
      defaut: { label: 'Opus 5.5', actif: false, onChoisir }
    })
    const bloc = document.body.querySelector('[data-testid="conv-model-defaut"]')
    expect(bloc?.textContent).toContain('Revenir au modèle par défaut')
    expect(bloc?.textContent).toContain('Opus 5.5')
    expect(bloc?.textContent).toContain('Ce choix ne vaut que pour cette conversation')
    await act(async () => {
      bloc?.querySelector('button')?.click()
    })
    expect(onChoisir).toHaveBeenCalledTimes(1)
  })

  it('une conversation qui suit déjà le défaut ne propose pas d’y revenir', async () => {
    const onChoisir = vi.fn()
    await renderSelector({
      models: [{ id: 'c1', provider: 'codex', model: 'gpt-5', label: 'GPT-5' }],
      ouverture: 'bas',
      defaut: { label: 'Opus 5.5', actif: true, onChoisir }
    })
    const bouton = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="conv-model-defaut"] button'
    )
    expect(bouton?.textContent).toContain('Suit le modèle par défaut')
    expect(bouton?.disabled).toBe(true)
  })

  it('signale la disparition du binding tout en ne proposant que le catalogue dynamique', async () => {
    const onSelect = vi.fn()
    const dom = await renderSelector({
      models: [{ id: 'c1', provider: 'codex', model: 'gpt-5', label: 'GPT-5' }],
      binding: { provider: 'legacy', model: 'gone' },
      onSelect
    })
    const options = [...dom.querySelectorAll('[role="option"]')]
    expect(options.map((option) => option.querySelector('strong')?.textContent)).toEqual(['GPT-5'])
    expect(dom.textContent).toContain('legacy · gone (indisponible)')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('ouvre le sous-menu du modèle et transmet explicitement son effort', async () => {
    const onSelect = vi.fn()
    const dom = await renderSelector({
      models: [
        {
          id: 'c1',
          provider: 'codex',
          model: 'gpt-5.6-terra',
          label: 'GPT-5.6 Terra',
          reasoningEfforts: ['low', 'high', 'ultra'],
          defaultReasoningEffort: 'high'
        }
      ],
      binding: { provider: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
      onSelect
    })
    expect(dom.querySelector('summary')?.textContent).toContain('GPT-5.6 TerraÉlevé')
    // Les efforts vivent désormais DANS la popup, en matrice par provider : aucun sous-menu.
    expect(dom.querySelector('.model-effort-menu')).toBeNull()
    const crans = [...dom.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    expect(crans.map((item) => item.querySelector('em')?.textContent)).toEqual([
      'Léger',
      'Élevé',
      'Ultra'
    ])
    await act(async () => {
      crans.find((item) => item.querySelector('em')?.textContent === 'Ultra')?.click()
    })
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'codex',
        model: 'gpt-5.6-terra',
        reasoningEffort: 'ultra'
      })
    )
  })

  it('closes on an outside click without blocking internal interactions', async () => {
    const dom = await renderSelector({
      models: [
        {
          id: 'c1',
          provider: 'codex',
          model: 'gpt-5.6-terra',
          label: 'GPT-5.6 Terra',
          reasoningEfforts: ['low']
        }
      ]
    })
    const selector = dom.querySelector<HTMLDetailsElement>(
      '[data-testid="chat-orchestrator-model"]'
    )!
    await act(async () => {
      selector.setAttribute('open', '')
      selector.dispatchEvent(new Event('toggle'))
    })

    expect(selector.open).toBe(true)
    // La matrice vit dans le portail du menu flottant, plus DANS le `details`.
    expect(document.body.querySelector('[data-testid="effort-matrix"]')).not.toBeNull()

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(selector.open).toBe(false)
  })

  it('ne présente pas l’absence d’effort comme un niveau Défaut', async () => {
    const onSelect = vi.fn()
    const dom = await renderSelector({
      models: [
        {
          id: 'h1',
          provider: 'native',
          model: 'llama',
          label: 'Llama',
          reasoningEfforts: ['none'],
          defaultReasoningEffort: 'none'
        }
      ],
      binding: { provider: 'native', model: 'llama', reasoningEffort: 'none' },
      onSelect
    })
    expect(dom.textContent).not.toContain('Défaut')
    await act(async () => {
      dom.querySelector<HTMLButtonElement>('[role="option"]')?.click()
    })
    expect(dom.querySelector('.model-effort-menu')).toBeNull()
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'native', model: 'llama', reasoningEffort: 'none' })
    )
  })

  it('restitue un rejet setRole sans faux succès et conserve le binding runtime confirmé', async () => {
    const models = [
      { id: 'c1', provider: 'codex', model: 'gpt-5', label: 'GPT-5' },
      { id: 'h1', provider: 'native', model: 'llama', label: 'Llama' }
    ]
    const setRole = vi.fn().mockRejectedValue(new Error('refus fixture'))
    function RejectionHarness(): React.JSX.Element {
      const [error, setError] = useState<string | null>(null)
      return createElement(OrchestratorModelSelector, {
        busy: false,
        catalogLoaded: true,
        models,
        binding: { provider: 'codex', model: 'gpt-5' },
        pending: false,
        error,
        onSelect: async (option) => {
          try {
            await setRole('orchestrator', option.provider, option.model, option.reasoningEffort)
          } catch (reason) {
            setError(
              `Changement non enregistré : ${reason instanceof Error ? reason.message : String(reason)}`
            )
          }
        }
      })
    }
    container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    rendu = root
    await act(async () => root.render(createElement(RejectionHarness)))
    // Menu flottant : on l'ouvre, puis on cherche dans la PAGE (le portail y depose le menu).
    const detailsRejet = container.querySelector('details') as HTMLDetailsElement | null
    if (detailsRejet)
      await act(async () => {
        detailsRejet.open = true
        detailsRejet.dispatchEvent(new Event('toggle'))
      })
    const dom = document.body
    const llama = [...dom.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (option) => option.querySelector('strong')?.textContent === 'Llama'
    )
    await act(async () => {
      llama?.click()
    })
    const effort = [...dom.querySelectorAll<HTMLButtonElement>('.model-effort-menu button')].find(
      (button) => button.textContent?.includes('Défaut')
    )
    await act(async () => {
      effort?.click()
    })
    expect(setRole).toHaveBeenCalledWith('orchestrator', 'native', 'llama', 'none')
    expect(dom.querySelector('summary')?.textContent).toContain('GPT-5')
    expect(dom.querySelector('[role="status"]')?.textContent).toContain(
      'Changement non enregistré : refus fixture'
    )
    expect(dom.textContent).not.toMatch(/réussi|appliqué/i)
  })

  it('regroupe par éditeur et preserve le modele courant disparu', () => {
    const result = buildOrchestratorModelGroups(
      [
        { id: 'c1', provider: 'gateway', model: 'gpt-5', label: 'GPT-5' },
        { id: 'h1', provider: 'gateway', model: 'llama', label: 'Llama' }
      ],
      { provider: 'legacy', model: 'gone' }
    )
    // ChatGPT (rang 1) avant Meta (rang 2).
    expect(result.groups.map((group) => group.key)).toEqual(['openai', 'meta'])
    expect(result.groups.map((group) => group.label)).toEqual(['ChatGPT', 'Meta (Llama)'])
    expect(result.currentMissing).toEqual({
      provider: 'legacy',
      model: 'gone',
      label: 'legacy · gone (indisponible)',
      reasoningEfforts: []
    })
  })

  it('ordonne les catégories : Anthropic, ChatGPT, puis les autres éditeurs', () => {
    const result = buildOrchestratorModelGroups([
      { id: 'h1', provider: 'gateway', model: 'llama', label: 'Llama' },
      { id: 'c1', provider: 'gateway', model: 'gpt-5', label: 'GPT-5' },
      { id: 'a1', provider: 'gateway', model: 'claude-opus', label: 'Opus' }
    ])
    expect(result.groups.map((group) => group.label)).toEqual([
      'Anthropic',
      'ChatGPT',
      'Meta (Llama)'
    ])
  })

  it('éclate le catalogue gateway en catégories éditeur propres', () => {
    const result = buildOrchestratorModelGroups([
      { id: 'o0', provider: 'gateway', model: 'zeta-model', label: 'Zeta' },
      { id: 'o1', provider: 'gateway', model: 'gpt-5.6-terra', label: 'GPT-5.6' },
      { id: 'o2', provider: 'gateway', model: 'auto/pro-coding', label: 'Pro Code' },
      { id: 'o3', provider: 'gateway', model: 'claude-opus-4-6', label: 'Opus' },
      { id: 'o4', provider: 'gateway', model: 'auto/best-chat', label: 'Best Chat' },
      { id: 'o5', provider: 'gateway', model: 'auto/best-coding', label: 'Best Code' }
    ])
    // Catégories dans l'ordre : Anthropic, ChatGPT, Sélection automatique, Autres.
    expect(result.groups.map((group) => group.key)).toEqual([
      'anthropic',
      'openai',
      'auto',
      'other'
    ])
    expect(result.groups[0].options.map((option) => option.model)).toEqual(['claude-opus-4-6'])
    expect(result.groups[1].options.map((option) => option.model)).toEqual(['gpt-5.6-terra'])
    // Dans la catégorie auto : Chat puis Code (best avant pro) — sous-tri conservé.
    expect(result.groups[2].options.map((option) => option.model)).toEqual([
      'auto/best-chat',
      'auto/best-coding',
      'auto/pro-coding'
    ])
    expect(result.groups[3].options.map((option) => option.model)).toEqual(['zeta-model'])
  })

  it('sort les auto/claude d’Anthropic, masque no-think, trie du plus récent au plus vieux', () => {
    const result = buildOrchestratorModelGroups([
      { id: 'm1', provider: 'gateway', model: 'cc/claude-opus-4-5-20251101', label: 'Opus 4.5' },
      { id: 'm2', provider: 'gateway', model: 'cc/claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'm3', provider: 'gateway', model: 'cc/claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'm4', provider: 'gateway', model: 'cc/claude-opus-4-7', label: 'Opus 4.7' },
      { id: 'm7', provider: 'gateway', model: 'cc/claude-fable-5', label: 'Fable 5' },
      {
        id: 'm5',
        provider: 'gateway',
        model: 'no-think/cc/claude-opus-4-8',
        label: 'Opus 4.8 · Sans raisonnement'
      },
      { id: 'm6', provider: 'gateway', model: 'auto/claude-opus', label: 'Auto Claude Opus' }
    ])
    const anthropic = result.groups.find((group) => group.key === 'anthropic')
    // Fable en tête ; no-think masqué ; auto/claude ABSENT d’ici.
    // Seule la DERNIÈRE version de chaque famille est proposée (demande utilisateur 2026-08-25) :
    // Opus 4.7 et Opus 4.5 sont désormais couverts par Opus 4.8 ; Sonnet, autre famille, reste.
    expect(anthropic?.options.map((option) => option.model)).toEqual([
      'cc/claude-fable-5',
      'cc/claude-opus-4-8',
      'cc/claude-sonnet-4-6'
    ])
    // La route auto/claude-opus vit dans la catégorie « Sélection automatique ».
    expect(result.groups.find((group) => group.key === 'auto')?.options[0]?.model).toBe(
      'auto/claude-opus'
    )
  })

  it('liste id-par-id PAR FOURNISSEUR : le meme id chez deux providers donne deux lignes', () => {
    const result = buildOrchestratorModelGroups([
      { id: 'cli', provider: 'claude', model: 'claude-opus-4-8', label: 'Opus 4.8 · CLI' },
      { id: 'api', provider: 'anthropic', model: 'claude-opus-4-8', label: 'Opus 4.8 · API' }
    ])
    const anthropic = result.groups.find((group) => group.key === 'anthropic')
    // La vue « famille » n'en gardait qu'UNE : le second fournisseur disparaissait du menu ET de
    // la matrice MODEL × EFFORT, sans aucun signal.
    expect(anthropic?.options.map((option) => `${option.provider}:${option.model}`)).toEqual([
      // Meme famille et meme version : l'egalite est tranchee par le LIBELLE (API avant CLI).
      'anthropic:claude-opus-4-8',
      'claude:claude-opus-4-8'
    ])
  })

  it('ne dedouble PAS un couple (fournisseur, id) present deux fois dans le catalogue', () => {
    // Entree qui ferait ECHOUER ce test si la correction supprimait toute deduplication :
    // le meme couple provider+model apparait deux fois (deux entrees de catalogue, un seul modele).
    const result = buildOrchestratorModelGroups([
      { id: 'a', provider: 'claude', model: 'claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'b', provider: 'claude', model: 'claude-opus-4-8', label: 'Opus 4.8 (doublon)' }
    ])
    const anthropic = result.groups.find((group) => group.key === 'anthropic')
    expect(anthropic?.options).toHaveLength(1)
    expect(anthropic?.options[0].label).toBe('Opus 4.8')
  })

  it('change le modèle de LA conversation sans toucher le rôle partagé', () => {
    // conv-239 (2026-10-11) : « rends le modèle propre à chaque conversation ». Le sélecteur ne
    // réécrit plus le rôle orchestrateur global (celui de TOUS les fils) ; il pose le modèle de la
    // conversation ouverte, que le main relit au départ de chacun de ses tours.
    expect(source).not.toMatch(/window\.api\.setRole\(\s*'orchestrator'/)
    const choix = source.slice(source.indexOf('async function changerModeleDuFil('))
    const corps = choix.slice(0, choix.indexOf('\n  }\n'))
    expect(corps).toContain('window.api.conversationSetModel(')
    expect(corps).toContain('option ? option.provider : null')
    expect(corps).toContain('option?.model')
    expect(corps).toContain('option?.reasoningEffort')
    // Sans conversation ouverte, le choix est ARMÉ pour le fil qui va naître…
    expect(corps).toContain('setModeleNouveauFil(')
    // … et posé sur lui AVANT son premier tour, sur les deux chemins de création.
    expect(source.match(/await poserModeleArme\(/g)).toHaveLength(2)
    // Le sélecteur vit en TÊTE de conversation, ouvert vers le bas, et plus dans la barre de saisie.
    const tete = source.slice(source.indexOf('data-testid="chat-runtime-identity"'))
    expect(tete.slice(0, tete.indexOf('data-testid="chat-runtime-conv"'))).toMatch(
      /<OrchestratorModelSelector[\s\S]*?ouverture="bas"/
    )
    const saisie = source.slice(source.indexOf('metaNode={'))
    expect(saisie.slice(0, 600)).not.toContain('<OrchestratorModelSelector')
    expect(source.match(/<OrchestratorModelSelector\b/g)).toHaveLength(1)
    expect(source).toContain('generation === runtimeRefreshGenerationRef.current')
    // L'indicateur de quotas reste alimente par l'identite runtime — et RIEN d'autre : depuis le
    // 2026-09-06 la jauge de contexte a son PROPRE bouton et son propre panneau, elle ne transite
    // plus par la popup des quotas.
    // Les quotas suivent le fournisseur du MODÈLE DU FIL (son choix propre, sinon le défaut).
    expect(source).toMatch(/<ModelQuotaIndicator\s+provider=\{bindingEffectif\?\.provider\}/)
    expect(source).not.toContain('contextGauge={activeId != null ? contextGauges[activeId]')
    /*
     * La jauge de contexte est passee dans un PANNEAU (`contextPanelNode`) rendu par
     * `ContextGaugeDetail`, alimente par la seule jauge courante. Ce qui est verifie reste le
     * meme : UN objet jauge deja calcule, jamais une recherche par conversation dans la vue
     * (garde par l'assertion negative juste au-dessus).
     */
    expect(source).toMatch(/<ContextGaugeDetail\s+gauge=\{j\}/)
    expect(source).toContain('const j = jaugeCourante')
    // AUCUN REPLI SUR LE CUMUL DANS LA VUE. `inputTokens` est le cumul du tour, un MAJORANT :
    // l'afficher comme une occupation rejouait la jauge fausse que le moteur refuse d'ecrire
    // (`chat/run-pilot-chat.ts`). La vue passe par `occupationDeFenetre` et n'affiche rien quand
    // il annonce un repli.
    expect(source).toContain('occupationDeFenetre({')
    expect(source).toContain('occupation.replicumul')
    expect(source).not.toContain('usage.derniereEntree ?? usage.inputTokens')
    // COMPACTION AUTOMATIQUE : le palier critique DECLENCHE, il ne se contente plus d'etre peint.
    expect(source).toContain('doitCompacterAutomatiquement(')
    expect(source).toContain('compactionAutoRef.current.add(conversationId)')
    expect(source).toContain('send(COMPACT_REQUEST, { targetConversationId: conversationId })')
    // Rendu du sélecteur : extrait dans OrchestratorModelSelector.
    // Pendant un tour, le MODÈLE est verrouillé mais pas le COMPTE (conv-1039, 2026-10-21) : la
    // pop-up reste ouvrable quand elle porte le bloc « Compte ». Le refus du modèle ligne par ligne
    // est vérifié en comportement par ChatView.compte-pendant-tour.test.tsx.
    expect(selectorSource).toContain(
      'const disabled = (busy && !porteDesComptes) || pending || models.length === 0'
    )
    // Menu devenu FLOTTANT : il porte `is-flottant` en plus et part dans un portail. Ce qui est
    // verifie reste qu'il existe UNE seule classe de menu, portee par le composant extrait.
    expect(selectorSource).toContain('className={`model-select-menu is-flottant')
    expect(selectorSource).toContain('createPortal(')
    // L'aide vit dans la table de textes depuis la traduction anglaise (conv-1170).
    expect(selectorSource).toContain("t('selecteur.aide.application')")
    expect(TEXTES_PANNEAUX_FR['selecteur.aide.application']).toContain(
      'Le changement s’appliquera au prochain tour'
    )
    expect(selectorSource).not.toMatch(
      /model-select[\s\S]{0,800}(navigate|newConv|location\.reload)/
    )
  })
})
