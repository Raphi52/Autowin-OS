import { describe, expect, it } from 'vitest'
import { extraireGraphiques } from './graphiques-svg-extraire.mjs'

// Fixture réduite d'un graphique d'une page modèle Anthropic (relevée le 2026-11-05, conv-1594) :
// chaque point accessible porte « <série> · <niveau>: <score> $<coût> » dans son aria-label.
const html = `
<p>texte</p>
<svg class="x_svg" viewBox="0 0 960 538" role="img" aria-label="Terminal-Bench 4.0">
  <text>Score (%)</text>
  <g class="x_focusTarget" tabindex="0" role="img" aria-label="Sonnet 5.5 · Low: 20.0% $0.76"><circle/></g>
  <g class="x_focusTarget" tabindex="0" role="img" aria-label="Opus 5.5 � Max: 64.8% $11.24"><circle/></g>
</svg>
<svg role="img" aria-label="AA-Briefcase v1.1">
  <g class="x_focusTarget" role="img" aria-label="Haiku 5.5 · Xhigh: 1578 $0.31"><circle/></g>
</svg>
<svg role="img" aria-label="Icône"><path d="M0 0"/></svg>`

describe('extraireGraphiques', () => {
  it('rend chaque graphique avec ses points (série, niveau, score, unité, coût)', () => {
    expect(extraireGraphiques(html)).toEqual([
      {
        titre: 'Terminal-Bench 4.0',
        points: [
          { serie: 'Sonnet 5.5', niveau: 'Low', score: 20, unite: '%', cout: 0.76 },
          { serie: 'Opus 5.5', niveau: 'Max', score: 64.8, unite: '%', cout: 11.24 }
        ]
      },
      {
        titre: 'AA-Briefcase v1.1',
        points: [{ serie: 'Haiku 5.5', niveau: 'Xhigh', score: 1578, unite: '', cout: 0.31 }]
      }
    ])
  })

  it('ignore un svg sans point de donnée', () => {
    expect(extraireGraphiques('<svg role="img" aria-label="Logo"><path/></svg>')).toEqual([])
  })
})
