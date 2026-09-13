import { describe, it, expect } from 'vitest'
import { buildRunBilan, bilanDepuisResume, bilanEnSvg, formatDuree } from './run-bilan'
import type { OrchStep } from './chat-view-model'

const etape = (p: Partial<OrchStep>): OrchStep => ({ step: 'exec', ...p })

describe('bilan de run', () => {
  it('compte les étapes, additionne le coût et conclut vert sans échec', () => {
    const b = buildRunBilan({
      sujet: 'ajouter la jauge',
      steps: [
        etape({ status: 'completed', costUsd: 1.5 }),
        etape({ status: 'completed', costUsd: 0.25 })
      ]
    })
    expect(b.verdict).toBe('vert')
    expect(b.titre).toBe('ajouter la jauge')
    expect(b.lignes).toContainEqual({ label: 'Étapes', valeur: '2 faites' })
    expect(b.lignes).toContainEqual({ label: 'Coût', valeur: '1.75 $' })
  })

  it('passe au rouge dès une étape en échec', () => {
    const b = buildRunBilan({
      steps: [etape({ status: 'completed' }), etape({ status: 'failed' })]
    })
    expect(b.verdict).toBe('rouge')
    expect(b.lignes[0]).toEqual({ label: 'Étapes', valeur: '1 faites · 1 en échec' })
  })

  it('ne conclut rien tant que le run tourne', () => {
    expect(buildRunBilan({ steps: [], enCours: true }).verdict).toBe('en cours')
  })

  it("n'invente pas une durée absente", () => {
    const b = buildRunBilan({ steps: [etape({ status: 'completed' })] })
    expect(b.lignes.some((l) => l.label === 'Durée')).toBe(false)
    expect(buildRunBilan({ steps: [], dureeMs: 185_000 }).lignes).toContainEqual({
      label: 'Durée',
      valeur: '3 min 05 s'
    })
  })

  it('formate les durées courtes en secondes', () => {
    expect(formatDuree(4_000)).toBe('4 s')
  })

  it('rend un SVG autonome, sans URL externe, et échappe le sujet', () => {
    const svg = bilanEnSvg(buildRunBilan({ sujet: 'a & <b>', steps: [] }))
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('a &amp; &lt;b&gt;')
    // Le seul `http:` toléré est la DÉCLARATION de l'espace de noms SVG : ce n'est pas une
    // ressource chargée. Tout le reste (image, police, import) ferait sortir la carte du poste.
    const sansNamespace = svg.replace('xmlns="http://www.w3.org/2000/svg"', '')
    expect(sansNamespace).not.toMatch(/https?:|@import|xlink:href|<image/)
  })
})

describe('bilan depuis le résumé d’un RUN.md', () => {
  const base = { status: 'succeeded', dodChecked: 3, dodTotal: 4, journalEvents: 12, defauts: 0 }

  it('rend les 3 repères du RUN.md et conclut vert', () => {
    const b = bilanDepuisResume(base, 'mon run')
    expect(b.verdict).toBe('vert')
    expect(b.lignes).toContainEqual({ label: 'Définition of done', valeur: '3/4 cochés' })
    expect(b.lignes).toContainEqual({ label: 'Journal', valeur: '12 évènements' })
  })

  it('ne peint jamais en vert un run porteur d’un défaut', () => {
    expect(bilanDepuisResume({ ...base, defauts: 2 }).verdict).toBe('rouge')
    expect(bilanDepuisResume({ ...base, status: 'failed' }).verdict).toBe('rouge')
  })

  it('reste « en cours » tant que le statut le dit', () => {
    expect(bilanDepuisResume({ ...base, status: 'running' }).verdict).toBe('en cours')
  })
})
