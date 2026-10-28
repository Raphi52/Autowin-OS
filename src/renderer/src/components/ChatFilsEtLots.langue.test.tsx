// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  LIBELLE_STATUT,
  bilanDuPlan,
  creerPlan,
  libelleEtat,
  lirePlanDeLots,
  type EtatDuLot,
  type PlanDeLots,
  type StatutDuPlan
} from '../../../shared/plan-de-lots'
import { TableauDesLots } from './TableauDesLots'
import { PropositionDeFils } from './PropositionDeFils'
import { buildRefineDraft } from './chat-resume-refine'
import { RequestThread } from './RequestThread'
import { appliquerLangue } from '../langue'
import { texteDuBilan, traduireChatFilsEtLots } from '../textes-ecrans/chat-fils-et-lots'

/**
 * LE PLAN DE LOTS ET LA CARTE DES FILS PROPOSÉS SUIVENT LA LANGUE (traduction anglaise, conv-1170,
 * lot 16). Entrée qui doit faire échouer ce test : un libellé du tableau ou de la carte laissé en dur,
 * un composant qui ne se redessine pas au changement de langue, ou un libellé d'état du plan dont le
 * français diverge de celui du moteur (`shared/plan-de-lots.ts`, que l'agent lit aussi).
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

function plan(): PlanDeLots {
  const lu = lirePlanDeLots({
    titre: 'Traduction anglaise',
    parallele: 2,
    lots: [1, 2, 3].map((n) => ({ titre: `Écrans ${n}`, demande: `/build groupe ${n}` }))
  })
  if (!lu.ok) throw new Error(lu.erreur)
  return creerPlan(lu.plan, { id: 'plan-a', chef: 'conv-1', maintenant: 1 })
}

let root: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(element: React.JSX.Element): Promise<HTMLDivElement> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => root!.render(element))
  return hote
}

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  appliquerLangue('fr')
})

describe('plan de lots et fils proposés — langue', () => {
  it('le tableau du plan passe en anglais sans être remonté, puis revient au français', async () => {
    const vue = { plan: plan(), role: 'chef' as const }
    ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
      plansDeLots: () => Promise.resolve({ ok: true, vue }),
      onAppEvent: () => () => {}
    }
    const tableau = await monter(<TableauDesLots conversationId="conv-1" />)
    const kicker = () => tableau.querySelector('.tdl-kicker')?.textContent
    const lancer = () => tableau.querySelector('.tdl-bouton--principal')?.textContent
    expect(kicker()).toBe('Plan de lots')
    expect(lancer()).toBe('Lancer le plan — 3 lots, 2 en parallèle, plafond 6 tours')

    await act(async () => appliquerLangue('en'))
    expect(kicker()).toBe('Batch plan')
    expect(
      tableau.querySelector('[data-testid="tableau-des-lots"]')?.getAttribute('aria-label')
    ).toBe('Batch plan')
    expect(lancer()).toBe('Launch the plan — 3 batches, 2 in parallel, cap of 6 turns')
    expect(tableau.querySelector('.tdl-statut')?.textContent).toBe('waiting for your approval')
    expect(tableau.querySelector('.tdl-pastille')?.textContent).toBe('to do')
    expect(tableau.querySelector('.tdl-bilan')?.textContent).toContain(
      '0 done, 0 failed, 0 running, 3 to do out of 3 — 0 turns of 6 · 2 threads in parallel'
    )
    const boutons = [...tableau.querySelectorAll('.tdl-bouton')].map((b) => b.textContent)
    expect(boutons).toContain('Decline')
    expect(tableau.querySelector('.tdl-note')?.textContent).toBe(
      'Each batch opens a thread and costs at least one AI model turn. Nothing starts without this click.'
    )

    await act(async () => appliquerLangue('fr'))
    expect(kicker()).toBe('Plan de lots')
    expect(tableau.querySelector('.tdl-bilan')?.textContent).toContain(
      '0 fait, 0 en échec, 0 en cours, 3 à faire sur 3 — 0 tour sur 6 · 2 fils en parallèle'
    )
  })

  it('la carte des fils proposés passe en anglais, puis revient au français', async () => {
    const taches = [
      { titre: 'Titre des fiches', demande: 'Corrige le titre', fichiers: ['a.tsx'] },
      { titre: 'Tri par date', demande: 'Ajoute un tri', fichiers: ['b.tsx'] },
      { titre: 'Libellé du tri', demande: 'Renomme le tri', fichiers: ['b.tsx'] }
    ]
    const carte = await monter(<PropositionDeFils taches={taches} source="essai-langue" />)
    const titre = () => carte.querySelector('.md-donnees__titre')?.textContent
    const boutons = () => [...carte.querySelectorAll('button')].map((b) => b.textContent)
    expect(titre()).toBe('3 tâches dans ton message')
    expect(boutons()).toEqual(['Lancer en 2 fils', 'Tout ici, l’une après l’autre'])

    await act(async () => appliquerLangue('en'))
    expect(titre()).toBe('3 tasks in your message')
    expect(boutons()).toEqual(['Launch in 2 threads', 'All here, one after the other'])
    expect(carte.querySelector('.md-fils__rang')?.textContent).toBe('thread 1')
    expect(carte.textContent).toContain(' — next in line')
    expect(carte.querySelector('.md-fils__actions .md-donnees__note')?.textContent).toBe(
      'Cost: 3 turns, 2 of them at the same time.'
    )

    await act(async () => appliquerLangue('fr'))
    expect(titre()).toBe('3 tâches dans ton message')
    expect(carte.querySelector('.md-fils__actions .md-donnees__note')?.textContent).toBe(
      'Coût : 3 tours, dont 2 en même temps.'
    )
  })

  it('le fil des demandes réécrit son récit en anglais SANS relire la trace', async () => {
    let lectures = 0
    const ev = (
      id: string,
      at: string,
      over: Record<string, unknown>
    ): Record<string, unknown> => ({
      id,
      conversationId: 'conv-a',
      turnId: 'turn-1',
      timestamp: at,
      sequence: id.length,
      type: 'message',
      status: 'completed',
      channel: 'internal',
      actor: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
      payloads: [],
      observation: { boundary: 'orchestration', fidelity: 'exact' },
      ...over
    })
    ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
      causalTrace: () => {
        lectures += 1
        return Promise.resolve([
          ev('p', '2026-10-12T07:00:00.000Z', {
            provider: { id: 'claude', model: 'claude-opus-5-5' },
            payloads: [{ kind: 'user-message', content: 'UTILISATEUR: ajoute un module' }]
          }),
          ev('rp', '2026-10-12T07:00:30.000Z', {
            type: 'model-response',
            parentId: 'p',
            metrics: { durationMs: 30000 }
          })
        ])
      }
    }
    const fil = await monter(<RequestThread conversationId="conv-a" />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    const lectureAvant = lectures
    const tete = () => fil.querySelector('.request-thread-head')?.textContent
    const chapitres = () =>
      [...fil.querySelectorAll('.request-story-chapter dt')].map((d) => d.textContent)
    expect(tete()).toBe('Demandes1 demande')
    expect(chapitres()).toContain('Décision')
    const decisionFr = fil.querySelector('[data-chapter="Décision"] dd')?.textContent

    await act(async () => appliquerLangue('en'))
    expect(tete()).toBe('Requests1 request')
    expect(chapitres()).toEqual(['Request', 'Decision', 'What it did', 'Result', 'Summary'])
    // Le repère `data-chapter` reste français : stable quelle que soit la langue.
    const decisionEn = fil.querySelector('[data-chapter="Décision"] dd')?.textContent
    expect(decisionFr).toContain('Chat direct')
    expect(decisionEn).toContain('Direct chat')
    expect(lectures).toBe(lectureAvant)
  })

  it('le brouillon de reprise passe en anglais et garde son repère relu `[reprise] `', () => {
    appliquerLangue('en')
    const brouillon = buildRefineDraft('fais X', 'failed', 'quota')
    expect(brouillon).toContain(
      '[reprise] the previous turn failed: quota. Say below what must change:'
    )
    // Le repère reste français : un second clic, même dans l'autre langue, n'empile rien.
    appliquerLangue('fr')
    expect(buildRefineDraft(brouillon, 'failed')).toBe(brouillon.trim())
  })

  it('le français des états et du bilan reste MOT POUR MOT celui du moteur', () => {
    for (const statut of Object.keys(LIBELLE_STATUT) as StatutDuPlan[])
      expect(traduireChatFilsEtLots(`lots.statut.${statut}`, 'fr')).toBe(LIBELLE_STATUT[statut])
    const etats: EtatDuLot[] = ['a-faire', 'en-cours', 'fait', 'echec', 'interrompu']
    for (const etat of etats)
      expect(traduireChatFilsEtLots(`lots.etat.${etat}`, 'fr')).toBe(libelleEtat(etat))
    // Le bilan recomposé par l'écran = celui du moteur, au singulier comme au pluriel.
    const base = plan()
    const varies: PlanDeLots[] = [
      base,
      {
        ...base,
        toursLances: 1,
        lots: base.lots.map((l, i) => ({
          ...l,
          etat: (['fait', 'interrompu', 'echec'] as const)[i]
        }))
      },
      {
        ...base,
        toursLances: 4,
        lots: base.lots.map((l, i) => ({
          ...l,
          etat: (['fait', 'fait', 'interrompu'] as const)[i]
        }))
      }
    ]
    for (const p of varies) expect(texteDuBilan(p, 'fr')).toBe(bilanDuPlan(p).texte)
  })
})
