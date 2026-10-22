// @vitest-environment happy-dom
/**
 * BLOC DES JUGES monté sur la VRAIE trace du run jugé de conv-253 (4 passages du même juge).
 * Choix « 1 · Nacre » du /draft de conv-328 : bandeau, À corriger avec adresse et déjà-corrigé,
 * état du suivi, juges en pied qui déplient le verdict complet.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JugesPanel, JugesPanelEnDirect } from './JugesPanel'
import type { StepDeRun } from './juges-votes'
import type { ScopedLiveRun } from './chat-view-model'
import { RunsEnDirect } from './runs-en-direct'
import type { EvenementDuRun, LecteurDuRunPerdu } from './run-relu-du-disque'
import trace from './juges-bloc.conv253.fixture.json'

async function monter(steps: readonly StepDeRun[]): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(JugesPanel, { conversationId: 'conv-253', charger: async () => steps })
    )
  })
  return host
}

const texte = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** Le bloc est plié par défaut (conv-1081) : un clic sur le bandeau le déplie. */
async function deplier(host: HTMLElement): Promise<void> {
  const bandeau = host.querySelector<HTMLButtonElement>('[data-testid="jpan-bandeau"]')!
  if (bandeau.getAttribute('aria-expanded') !== 'true') await act(async () => bandeau.click())
}

describe('JugesPanel — bloc Nacre', () => {
  it('plié par défaut : le bandeau seul, un clic déplie puis replie', async () => {
    const host = await monter(trace as StepDeRun[])
    const bandeau = host.querySelector<HTMLButtonElement>('[data-testid="jpan-bandeau"]')!
    expect(bandeau.getAttribute('aria-expanded')).toBe('false')
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('3 objections à corriger')
    expect(host.querySelector('.jpan-section')).toBeNull()
    expect(host.querySelectorAll('[data-testid="jpan-objection"]')).toHaveLength(0)
    expect(host.querySelectorAll('[data-testid="jpan-ligne"]')).toHaveLength(0)

    await act(async () => bandeau.click())
    expect(bandeau.getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelectorAll('[data-testid="jpan-objection"]')).toHaveLength(3)
    expect(host.querySelectorAll('[data-testid="jpan-ligne"]')).toHaveLength(1)

    await act(async () => bandeau.click())
    expect(bandeau.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('[data-testid="jpan-objection"]')).toHaveLength(0)
  })

  it('un seul juge en pied, pas un par passage de réparation', async () => {
    const host = await monter(trace as StepDeRun[])
    await deplier(host)
    const juges = host.querySelectorAll('[data-testid="jpan-ligne"]')
    expect(juges).toHaveLength(1)
    expect(texte(juges[0].querySelector('.jpan-juge-nom'))).toBe('claude-opus-5-5')
    expect(texte(juges[0].querySelector('.jpan-score'))).toBe('80')
  })

  it('le bandeau dit le verdict, le nombre d’objections et le suivi', async () => {
    const host = await monter(trace as StepDeRun[])
    expect(host.querySelector('[data-testid="juges-panel"]')?.getAttribute('data-verdict')).toBe(
      'defaut'
    )
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('3 objections à corriger')
    expect(texte(host.querySelector('.jpan-sous'))).toBe(
      '2 reprises · 1 nouvelle · 1 corrigée en partie'
    )
    expect(texte(host.querySelector('.jpan-quorum'))).toBe('0/1 valide')
  })

  it('chaque objection porte son état, son adresse, et la 1re son déjà-corrigé', async () => {
    const host = await monter(trace as StepDeRun[])
    await deplier(host)
    const objections = [...host.querySelectorAll('[data-testid="jpan-objection"]')]
    expect(objections.map((o) => texte(o.querySelector('.jpan-suivi')))).toEqual([
      'REPRISE · EN PARTIE',
      'REPRISE',
      'NOUVELLE'
    ])
    expect(
      [...objections[1].querySelectorAll('[data-testid="jpan-adresses"] code')].map(texte)
    ).toEqual(['src/main/video-ffprobe.ts', 'l.11-12'])
    expect(objections[0].querySelectorAll('.jpan-corrige-ligne')).toHaveLength(2)
    expect(objections[1].querySelector('[data-testid="jpan-corrige"]')).toBeNull()
  })

  it('le verdict complet se déplie au clic sur le juge', async () => {
    const host = await monter(trace as StepDeRun[])
    await deplier(host)
    expect(host.querySelector('[data-testid="jpan-verdict"]')).toBeNull()
    const juge = host.querySelector<HTMLButtonElement>('[data-testid="jpan-ligne"]')!
    await act(async () => juge.click())
    expect(juge.getAttribute('aria-expanded')).toBe('true')
    expect(texte(host.querySelector('[data-testid="jpan-verdict"]'))).toContain('SCORE: 80')
  })

  it('un long texte se replie et se déplie', async () => {
    const host = await monter(trace as StepDeRun[])
    await deplier(host)
    const premiere = host.querySelector('[data-testid="jpan-objection"]')!
    expect(premiere.querySelector('.jpan-obj-texte.is-replie')).not.toBeNull()
    await act(async () => premiere.querySelector<HTMLButtonElement>('.jpan-suite')!.click())
    expect(premiere.querySelector('.jpan-obj-texte.is-replie')).toBeNull()
  })

  it('un VALIDE sans objection : bandeau vert, aucune section À corriger', async () => {
    const host = await monter([
      {
        step: 'judge',
        model: 'm',
        detail: 'vote: VALIDE',
        text: 'VALIDE\nSCORE: 92\nOBJECTIONS:\n- OK: 12 tests verts'
      }
    ])
    expect(host.querySelector('[data-testid="juges-panel"]')?.getAttribute('data-verdict')).toBe(
      'valide'
    )
    expect(texte(host.querySelector('.jpan-titre'))).toBe(
      'Aucune objection à corriger1 constat vérifié'
    )
    await deplier(host)
    expect(host.querySelector('.jpan-section')).toBeNull()
  })

  it('aucun vote : rien n’est rendu', async () => {
    const host = await monter([{ step: 'exec', model: 'w', text: 'x' }])
    expect(host.querySelector('[data-testid="juges-panel"]')).toBeNull()
  })
})

/**
 * EN DIRECT (conv-1021, « pendant que ça judge ça remplisse le bloc en live ») : le bloc d'un tour
 * en cours suit le run que le fil reçoit, sans attendre la trace écrite à la fin.
 */
describe('JugesPanelEnDirect — le bloc se remplit pendant que ça juge', () => {
  const steps = trace as StepDeRun[]
  const verdictFinal = steps[27].text ?? ''
  const debutObjections = verdictFinal.indexOf('OBJECTIONS:')
  const finPremiere = verdictFinal.indexOf('\n- MINEUR', debutObjections + 'OBJECTIONS:'.length + 2)
  const run = (partiel: Partial<ScopedLiveRun<StepDeRun>>): ScopedLiveRun<StepDeRun> => ({
    convId: 'conv-253',
    task: 't',
    steps: steps.slice(0, 27),
    status: 'running',
    ...partiel
  })

  async function monterEnDirect(): Promise<{
    host: HTMLElement
    pousser: (r: ScopedLiveRun<StepDeRun> | undefined) => Promise<void>
  }> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const pousser = async (r: ScopedLiveRun<StepDeRun> | undefined): Promise<void> => {
      await act(async () => {
        root.render(
          createElement(
            RunsEnDirect.Provider,
            { value: r ? { 'conv-253': r } : {} },
            createElement(JugesPanelEnDirect, { conversationId: 'conv-253' })
          )
        )
      })
    }
    return { host, pousser }
  }

  it('suit le juge qui écrit, puis montre son verdict dès qu’il tombe', async () => {
    const { host, pousser } = await monterEnDirect()
    const juge = { step: 'judge', model: 'claude-opus-5-5' }
    const panneau = (): Element | null => host.querySelector('[data-testid="juges-panel"]')

    await pousser(run({ phase: juge, liveText: verdictFinal.slice(0, debutObjections) }))
    expect(panneau()?.getAttribute('data-verdict')).toBe('encours')
    expect(texte(host.querySelector('.jpan-verdict'))).toBe('EN COURS')
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('Le juge relit le travail')
    expect(texte(host.querySelector('.jpan-quorum'))).toBe('réparation 5')
    await deplier(host)
    expect(texte(host.querySelector('[data-testid="jpan-ligne"]'))).toBe('claude-opus-5-5écrit…')

    await pousser(run({ phase: juge, liveText: verdictFinal.slice(0, finPremiere) }))
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('1 objection à corriger')
    expect(texte(host.querySelector('.jpan-sous'))).toBe('le juge écrit encore')
    expect(texte(host.querySelector('.jpan-suivi'))).toBe('REPRISE · EN PARTIE')
    // Ce qu'il a déjà écrit se lit au clic sur son nom.
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="jpan-ligne"]')!.click()
    )
    expect(texte(host.querySelector('[data-testid="jpan-verdict"]'))).toContain('SCORE: 80')

    // Le verdict tombe : l'étape arrive, la phase du juge est finie.
    await pousser(run({ steps: steps.slice(0, 28) }))
    expect(panneau()?.getAttribute('data-verdict')).toBe('defaut')
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('3 objections à corriger')
    expect(texte(host.querySelector('.jpan-quorum'))).toBe('0/1 valide')

    // La réparation qui suit : le verdict reste, et le bloc dit qu'elle tourne.
    await pousser(run({ steps: steps.slice(0, 31), phase: { step: 'exec' } }))
    expect(texte(host.querySelector('.jpan-sous'))).toBe(
      '2 reprises · 1 nouvelle · 1 corrigée en partie · réparation 6 en cours'
    )
  })

  it('sans run reçu pour la conversation, rien n’est rendu', async () => {
    const { host, pousser } = await monterEnDirect()
    await pousser(undefined)
    expect(host.querySelector('[data-testid="juges-panel"]')).toBeNull()
  })
})

/**
 * L'INTERFACE A PERDU LE RUN (conv-1021) : rechargée en plein run, elle n'a pas vu son départ et
 * ignore ses événements. Le bloc relit alors `trace.json` — réécrit par le main à chaque étape —
 * puis suit le bus. Disque et bus sont simulés ; la trace est celle, réelle, de conv-253.
 */
describe('JugesPanelEnDirect — run perdu par l’interface, relu sur disque', () => {
  const steps = trace as StepDeRun[]
  const verdictFinal = steps[27].text ?? ''
  const debutObjections = verdictFinal.indexOf('OBJECTIONS:')
  const finPremiere = verdictFinal.indexOf('\n- MINEUR', debutObjections + 'OBJECTIONS:'.length + 2)
  const RUN = 'C:/runs/conv-253/juge-workspace/RUN.md'

  function lecteurSimule(statut = 'open'): {
    lecteur: LecteurDuRunPerdu
    disque: { steps: StepDeRun[] }
    emettre: (e: EvenementDuRun) => Promise<void>
    lectures: string[]
  } {
    const disque = { steps: steps.slice(0, 28) }
    const lectures: string[] = []
    let ecoute: ((e: EvenementDuRun) => void) | undefined
    const lecteur: LecteurDuRunPerdu = {
      runs: async () => [{ path: RUN, summary: { status: statut } }],
      trace: async (path) => {
        lectures.push(path)
        return [...disque.steps]
      },
      ecouter: (cb) => {
        ecoute = cb
        return () => {
          ecoute = undefined
        }
      }
    }
    const emettre = async (e: EvenementDuRun): Promise<void> => {
      await act(async () => {
        ecoute?.(e)
        await new Promise((r) => setTimeout(r, 0))
      })
    }
    return { lecteur, disque, emettre, lectures }
  }

  async function monterSansRunEnDirect(
    lecteur: LecteurDuRunPerdu,
    direct?: ScopedLiveRun<StepDeRun>
  ): Promise<HTMLElement> {
    const host = document.createElement('div')
    document.body.appendChild(host)
    await act(async () => {
      createRoot(host).render(
        createElement(
          RunsEnDirect.Provider,
          { value: direct ? { 'conv-253': direct } : {} },
          createElement(JugesPanelEnDirect, { conversationId: 'conv-253', lecteur })
        )
      )
      await new Promise((r) => setTimeout(r, 0))
    })
    return host
  }

  it('montre le verdict déjà rendu, puis suit la réparation, le juge suivant et la fin', async () => {
    const { lecteur, disque, emettre } = lecteurSimule()
    const host = await monterSansRunEnDirect(lecteur)
    const panneau = (): Element | null => host.querySelector('[data-testid="juges-panel"]')

    // Au montage : le verdict de la réparation 5, relu dans trace.json.
    expect(panneau()?.getAttribute('data-verdict')).toBe('defaut')
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('3 objections à corriger')

    // Une étape tombe : le main l'a écrite AVANT de la diffuser, le bloc relit le fichier.
    disque.steps = steps.slice(0, 31)
    await emettre({ type: 'orchestrate-step', convId: 'conv-253', runPath: RUN })
    expect(texte(host.querySelector('.jpan-sous'))).toBe(
      '2 reprises · 1 nouvelle · 1 corrigée en partie · réparation 6 en cours'
    )

    // Le juge suivant démarre et écrit : ses objections arrivent en direct.
    await emettre({
      type: 'orchestrate-phase',
      convId: 'conv-253',
      runPath: RUN,
      phase: { step: 'judge', model: 'claude-opus-5-5' }
    })
    await emettre({
      type: 'orchestrate-delta',
      convId: 'conv-253',
      runPath: RUN,
      delta: verdictFinal.slice(0, finPremiere)
    })
    expect(panneau()?.getAttribute('data-verdict')).toBe('encours')
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('1 objection à corriger')

    // Un autre run, une autre conversation : ignorés.
    await emettre({ type: 'orchestrate-end', convId: 'conv-999', status: 'green' })
    await emettre({ type: 'orchestrate-end', convId: 'conv-253', runPath: 'C:/autre/RUN.md' })
    expect(panneau()?.getAttribute('data-verdict')).toBe('encours')

    // Le run finit : plus rien « en cours », le dernier verdict reste.
    await emettre({ type: 'orchestrate-end', convId: 'conv-253', runPath: RUN, status: 'red' })
    expect(panneau()?.getAttribute('data-verdict')).toBe('defaut')
  })

  it('un run CLOS n’est pas repris comme s’il tournait encore', async () => {
    const { lecteur, lectures } = lecteurSimule('green')
    const host = await monterSansRunEnDirect(lecteur)
    expect(host.querySelector('[data-testid="juges-panel"]')).toBeNull()
    expect(lectures).toEqual([])
  })

  it('la première étape diffusée désigne le run quand aucun n’était ouvert au montage', async () => {
    const { lecteur, emettre, lectures } = lecteurSimule('green')
    const host = await monterSansRunEnDirect(lecteur)
    await emettre({ type: 'orchestrate-step', convId: 'conv-253', runPath: RUN })
    expect(lectures).toEqual([RUN])
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('3 objections à corriger')
  })

  it('l’interface a le run en direct : le disque n’est pas lu', async () => {
    const { lecteur, lectures } = lecteurSimule()
    let runsLus = 0
    const host = await monterSansRunEnDirect(
      {
        ...lecteur,
        runs: async (c) => {
          runsLus += 1
          return lecteur.runs(c)
        }
      },
      { convId: 'conv-253', task: 't', steps: steps.slice(0, 28), status: 'running' }
    )
    expect(texte(host.querySelector('.jpan-titre b'))).toBe('3 objections à corriger')
    expect(runsLus).toBe(0)
    expect(lectures).toEqual([])
  })
})
