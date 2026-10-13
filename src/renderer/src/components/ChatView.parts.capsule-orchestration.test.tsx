// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'
import { decouperBattement } from './chat-parts-helpers'

/**
 * CAPSULE D'ORCHESTRATION — choix de l'utilisateur sur maquettes (conv-194, 2026-10-10, /draft
 * « des jolis panel orchestration dans mon theme nebuleuse », puis « Capsule », puis « Go sur la
 * capsule 2 · Phase dans la capsule »).
 *
 * SYMPTOME de depart : « j'arrive pas a me rendre compte de comment voir le detail ». Le prompt
 * envoye vivait a DEUX clics (pastille « ▸ …iorations… » puis un ▶ par phase), et l'en-tete ne
 * disait que « 1 action en cours · Orchestration ».
 *
 * La capsule 2 : le meme bloc que « Actions » (rond degrade, pastille de duree, chevron, signe de
 * vie a droite, barre de temps dessous), la PHASE ecrite dans la capsule, et le corps qui montre
 * DIRECTEMENT le prompt envoye a chaque phase — un seul clic.
 *
 * conv-909 (2026-10-12) : « ce bloc orchestration doit etre comme celui de Actions », redessine en
 * cadre « grand, deux lignes » par conv-904. Le rond de verre teinte et la legende des phases
 * remplacent la barre de temps, comme dans Actions.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

type Props = Parameters<typeof AssistantActivityGroup>[0]
type Action = Props['actions'][number]

const orchestration = (over: Partial<Action> = {}): Action =>
  ({ kind: 'action', name: 'orchestrate', args: { task: 'ma tache' }, ...over }) as Action

function rendre(props: Props): void {
  act(() => root.render(createElement(AssistantActivityGroup, props)))
}

const bloc = (): HTMLElement | null => container.querySelector('.thinking-block--orchestration')
// La premiere ligne du cadre (conv-909) : « Orchestration · phase » et la duree.
const capsule = (): HTMLElement =>
  container.querySelector('[data-testid="activity-capsule"]') as HTMLElement
// Le rond de verre : l'icone de l'orchestration, teintee par le verdict (remplace la barre de temps).
const verdictDuRond = (): string | null =>
  container.querySelector('[data-testid="activity-rond"]')?.getAttribute('data-verdict') ?? null
const legende = (): Array<[string, string | null]> =>
  [...container.querySelectorAll('[data-testid="legende-outil"]')].map((l) => [
    l.textContent ?? '',
    l.getAttribute('data-etat')
  ])
const entete = (): HTMLElement => container.querySelector('summary') as HTMLElement

describe('decouperBattement — le battement d une orchestration', () => {
  it('separe la duree, la phase annoncee et le dernier fait', () => {
    expect(decouperBattement('4 min 12 s · scout · Bash · node x', 'scout')).toEqual({
      duree: '4 min 12 s',
      fait: 'Bash · node x'
    })
  })

  it('ne retire PAS un segment qui n est pas la phase connue', () => {
    expect(decouperBattement('45 s · Bash · node x', 'scout')).toEqual({
      duree: '45 s',
      fait: 'Bash · node x'
    })
    expect(decouperBattement('3 min · build · Read · a.ts')).toEqual({
      duree: '3 min',
      fait: 'build · Read · a.ts'
    })
  })

  it('rend le texte tel quel quand il ne commence pas par une duree', () => {
    expect(decouperBattement('verification en cours', 'scout')).toEqual({
      fait: 'verification en cours'
    })
  })
})

describe('AssistantActivityGroup — capsule d une orchestration', () => {
  it('ecrit la PHASE et la DUREE dans la capsule, le dernier fait a droite', () => {
    rendre({
      actions: [
        orchestration({
          progress: '4 min 12 s · scout · Bash · node scripts/ui-capture.mjs',
          pipeline: [{ phase: 'scout', provider: 'claude', model: 'claude-opus-5-5' }]
        })
      ]
    })
    expect(bloc()).not.toBeNull()
    expect(bloc()!.className).toContain('is-live')
    expect(capsule().textContent).toContain('Orchestration')
    expect(capsule().querySelector('.orch-phase')?.textContent).toBe('scout')
    expect(capsule().querySelector('.thinking-duree')?.textContent).toBe('4 min 12 s')
    const vie = container.querySelector('[data-testid="activity-progress"]')!
    expect(vie.textContent).toBe('Bash · node scripts/ui-capture.mjs')
    // L'ancien libelle disparait de l'ecran : l'etat se lit au reflet et au rond.
    expect(container.textContent).not.toContain('1 action en cours')
    expect(verdictDuRond()).toBe('encours')
    // Une seule phase : deja ecrite en premiere ligne, la legende ne la redit pas.
    expect(legende()).toEqual([])
  })

  it('prend le cadre du bloc Actions : rond a gauche, deux lignes, boutons et chevron dedans', () => {
    rendre({
      actions: [orchestration({ ok: false, data: { error: 'tests rouges' } })],
      onResume: vi.fn()
    })
    // Les MEMES classes que BlocRepliable (ThinkingBlock.tsx) : le cadre est dessine par
    // anneau-activite.css, pas par une copie de son style.
    expect(bloc()!.className).toContain('thinking-block--deux-lignes')
    expect(bloc()!.className).toContain('cadre-anneau')
    const tete = entete().querySelector(':scope > .anneau-tete')!
    expect([...tete.children].map((e) => e.getAttribute('data-testid') ?? e.className)).toEqual([
      'activity-rond',
      'anneau-col',
      'activity-open-run',
      'activity-resume',
      'anneau-chevron'
    ])
    expect(tete.querySelector('.anneau-l1')!.textContent).toContain('Orchestration')
    expect(tete.querySelector('.anneau-l2 [data-testid="activity-outcome"]')).not.toBeNull()
    // L'ancienne capsule et sa barre de temps ont quitte l'ecran.
    expect(container.querySelector('.thinking-capsule')).toBeNull()
    expect(container.querySelector('.thinking-frise-barre')).toBeNull()
  })

  it('montre le prompt de la phase en UN clic, avec « pas encore » pour son rendu', () => {
    rendre({
      actions: [
        orchestration({
          pipeline: [
            {
              phase: 'scout',
              provider: 'claude',
              model: 'claude-opus-5-5',
              prompt: '[system]\nSYSTEME SCOUT\n\n[user]\nregarde le graphe'
            }
          ]
        })
      ]
    })
    expect(bloc()!.hasAttribute('open')).toBe(false)
    act(() => entete().click())
    expect(bloc()!.hasAttribute('open')).toBe(true)
    const prompt = container.querySelector('[data-testid="activity-pipeline-prompt"]')!
    expect(prompt.textContent).toContain('SYSTEME SCOUT')
    const titres = [...container.querySelectorAll('.orch-titre')].map((t) => t.textContent)
    expect(titres[0]).toContain('scout')
    expect(titres[0]).toContain('claude-opus-5-5')
    expect(container.querySelector('.orch-attente')?.textContent).toContain('pas encore')
    act(() => entete().click())
    expect(bloc()!.hasAttribute('open')).toBe(false)
  })

  it('avant la premiere phase, dit « en cours » et la ligne de lancement', () => {
    rendre({ actions: [orchestration()] })
    expect(capsule().querySelector('.orch-phase')?.textContent).toBe('en cours')
    expect(container.querySelector('[data-testid="activity-progress"]')!.textContent).toContain(
      'Travail lancé : « ma tache »'
    )
    // Sans choix recu, le corps montre la tache demandee — rien d'invente.
    act(() => entete().click())
    expect(container.querySelector('.orch-corps')!.textContent).toContain('ma tache')
    expect(container.querySelector('[data-testid="activity-pipeline-prompt"]')).toBeNull()
  })

  it('↗ ouvre Workflows sans deplier la capsule', () => {
    const ouvrir = vi.fn()
    rendre({ actions: [orchestration()], onOpenLiveAction: ouvrir })
    const bouton = container.querySelector('[data-testid="activity-open-run"]') as HTMLElement
    expect(bouton.textContent).toBe('↗')
    act(() => bouton.click())
    expect(ouvrir).toHaveBeenCalledWith('live', undefined)
    expect(bloc()!.hasAttribute('open')).toBe(false)
  })

  it('un echec reste plie mais se lit : issue rouge, segment rouge, Relancer, pourquoi en 1 clic', () => {
    rendre({
      actions: [orchestration({ ok: false, data: { error: 'tests rouges' } })],
      onResume: vi.fn()
    })
    expect(bloc()!.className).toContain('is-done')
    expect(bloc()!.getAttribute('data-state')).toBe('failed')
    // « replié par défaut : le fil reste lisible » (ChatView.parts.pourquoi.test.tsx).
    expect(bloc()!.hasAttribute('open')).toBe(false)
    expect(container.querySelector('[data-testid="activity-why"]')).toBeNull()
    expect(container.querySelector('[data-testid="activity-outcome"]')!.textContent).toContain(
      'échec : tests rouges'
    )
    act(() => entete().click())
    expect(container.querySelector('[data-testid="activity-why"]')!.textContent).toContain(
      'tests rouges'
    )
    expect(verdictDuRond()).toBe('ko')
    expect(container.querySelector('[data-testid="activity-resume"]')!.textContent).toContain(
      'Relancer'
    )
  })

  it('le controle final rend sa decision motivee, marquee en echec', () => {
    rendre({
      actions: [
        orchestration({
          pipeline: [
            { phase: 'build', model: 'm1', outcome: 'livrable' },
            { phase: 'gate', outcome: 'BLOQUE: tests rouges', ok: false }
          ]
        })
      ]
    })
    act(() => entete().click())
    const rendus = container.querySelectorAll('[data-testid="activity-pipeline-outcome"]')
    expect(rendus).toHaveLength(2)
    expect(rendus[1].className).toContain('failed')
    expect(container.textContent).toContain('décision et motif')
    // Chaque phase garde son verdict dans la legende, « couleur sur l'exception ».
    expect(legende()).toEqual([
      ['build', 'ok'],
      ['gate', 'ko']
    ])
    expect(verdictDuRond()).toBe('ko')
  })

  it('une orchestration reussie teinte le rond en vert', () => {
    rendre({
      actions: [
        orchestration({
          ok: true,
          data: { status: 'succeeded' },
          pipeline: [{ phase: 'scout' }, { phase: 'build' }]
        })
      ]
    })
    expect(verdictDuRond()).toBe('ok')
    expect(legende()).toEqual([
      ['scout', 'ok'],
      ['build', 'ok']
    ])
  })

  it('un echec SANS resume chiffre dit quand meme « avec erreur »', () => {
    rendre({ actions: [orchestration({ ok: false })] })
    expect(entete().textContent).toContain('1 action avec erreur')
  })

  it('pliee, la capsule ne porte AUCUN prompt dans le DOM', () => {
    rendre({ actions: [orchestration({ pipeline: [{ phase: 'scout', prompt: 'PROMPT LOURD' }] })] })
    expect(container.textContent).not.toContain('PROMPT LOURD')
  })

  it('nomme la phase SEULE, le role a part : jamais « scout subagent »', () => {
    rendre({
      actions: [
        orchestration({
          pipeline: [{ phase: 'scout', role: 'subagent', model: 'claude-opus-5-5', prompt: 'P' }]
        })
      ]
    })
    act(() => entete().click())
    const titre = container.querySelector('.orch-titre')!.textContent
    expect(titre).toBe('prompt envoyé à scout · subagent · claude-opus-5-5')
    expect(container.querySelector('.orch-attente')!.textContent).toContain('quand scout finit')
  })

  it('avec des phases, le corps ne redit ni la tache ni le statut du run', () => {
    rendre({
      actions: [
        orchestration({
          ok: true,
          data: { status: 'succeeded' },
          pipeline: [{ phase: 'scout', prompt: 'PROMPT', outcome: 'rendu du scout' }]
        })
      ]
    })
    act(() => entete().click())
    expect(container.querySelector('[data-testid="activity-step-detail"]')).toBeNull()
    expect(container.querySelector('.orch-corps')!.textContent).not.toContain('ma tache')
    // Le statut reste lisible, une seule fois, a droite de la capsule.
    expect(container.querySelector('[data-testid="activity-outcome"]')!.textContent).toBe(
      'succeeded'
    )
  })

  /*
   * conv-918 (2026-10-13) : « dans le bloc orchestration ya du texte qui defile en dessous mais quand
   * je depplie ce bloc je vois nulle part ce qui s'ecrit dans la 2e ligne du mode reduit ». La 2e
   * ligne montrait des fragments du raisonnement du sous-agent, gardes nulle part.
   */
  it('deplie, montre le RAISONNEMENT entier de la phase, cale sur la fin tant qu elle tourne', () => {
    const raisonnement = 'Je lis le fichier.\nand now 1/2 could be the cause, let me check.'
    rendre({
      actions: [
        orchestration({
          progress: '1 min 5 s · think · réfléchit…',
          pipeline: [{ phase: 'think', model: 'claude-opus-5-5', prompt: 'P', raisonnement }]
        })
      ]
    })
    // Repliee : la ligne de vie dit ce que l agent fait, jamais des bouts de sa reflexion.
    expect(container.querySelector('[data-testid="activity-progress"]')!.textContent).toBe(
      'réfléchit…'
    )
    expect(container.textContent).not.toContain('and now 1/2 could')
    act(() => entete().click())
    const zone = container.querySelector('[data-testid="activity-pipeline-reasoning"]')!
    expect(zone.textContent).toBe(raisonnement)
    expect(zone.className).toContain('is-direct')
    const titres = [...container.querySelectorAll('.orch-titre')].map((t) => t.textContent)
    expect(titres).toContain('raisonnement · en direct')
  })

  it('une phase finie garde son raisonnement, sans la mention « en direct »', () => {
    rendre({
      actions: [
        orchestration({
          ok: true,
          data: { status: 'succeeded' },
          pipeline: [{ phase: 'think', raisonnement: 'pense', outcome: 'rendu', ok: true }]
        })
      ]
    })
    act(() => entete().click())
    const zone = container.querySelector('[data-testid="activity-pipeline-reasoning"]')!
    expect(zone.textContent).toBe('pense')
    expect(zone.className).not.toContain('is-direct')
    const titres = [...container.querySelectorAll('.orch-titre')].map((t) => t.textContent)
    expect(titres).toContain('raisonnement')
  })

  it('un groupe MIXTE garde la barre d actions habituelle', () => {
    rendre({
      actions: [orchestration({ ok: true }), { kind: 'action', name: 'verify', ok: true } as Action]
    })
    expect(bloc()).toBeNull()
    expect(container.querySelector('.activity-anneau')).not.toBeNull()
  })
})
