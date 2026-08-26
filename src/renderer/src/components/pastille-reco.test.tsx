// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ModelEffortMatrix, type ModelEffortRow } from './ModelEffortMatrix'
import { buildOrchestratorModelGroups } from './chat-view-model'
import { recommendedEffort } from './model-effort-recommendations'

/** Catalogue LIVE relevé dans .autowin-data/autowin-os/model-catalog.json (2026-08-25) + alias CLI. */
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh']
const catalogue = [
  ...['opus', 'sonnet', 'haiku', 'fable'].map((m) => ({
    id: `claude/${m}`,
    provider: 'claude',
    model: m,
    label: `Claude ${m} (dernier) · CLI`,
    reasoningEfforts: CLAUDE_EFFORTS,
    defaultReasoningEffort: 'high'
  })),
  ...[
    'claude-fable-5',
    'claude-haiku-4',
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    'claude-opus-4',
    'claude-opus-4-0',
    'claude-opus-4-1',
    'claude-opus-4-1-20250805',
    'claude-opus-4-20250514',
    'claude-opus-4-5',
    'claude-opus-4-5-20251101',
    'claude-opus-4-6',
    'claude-opus-4-6-20251101',
    'claude-opus-4-7',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-sonnet-4',
    'claude-sonnet-4-0',
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-4-6',
    'claude-sonnet-4-6-20251114',
    'claude-sonnet-5'
  ].map((m) => ({
    id: `claude/${m}`,
    provider: 'claude',
    model: m,
    label: `${m} · CLI`,
    reasoningEfforts: CLAUDE_EFFORTS,
    defaultReasoningEffort: 'high'
  })),
  ...['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-mini'].map((m) => ({
    id: `codex/${m}`,
    provider: 'codex',
    model: m,
    label: `${m} · ChatGPT`,
    reasoningEfforts: CODEX_EFFORTS,
    defaultReasoningEffort: 'medium'
  }))
]

function rowsDuPopup(): ModelEffortRow[] {
  const grouped = buildOrchestratorModelGroups(catalogue as never, undefined)
  return grouped.groups.flatMap((g) =>
    g.options.map((option) => ({
      key: `${option.provider}:${option.model}`,
      label: option.label,
      model: option.model,
      option,
      efforts: option.reasoningEfforts.filter((e) => e !== 'none')
    }))
  )
}

describe('pastille verte — Sol côté ChatGPT, Opus 5 côté Anthropic', () => {
  it('recommande xhigh sur Sol, et PLUS sur terra', () => {
    expect(recommendedEffort('codex', 'gpt-5.6-sol')).toBe('xhigh')
    expect(recommendedEffort('codex', 'gpt-5.6-terra')).toBeUndefined()
  })

  it('pose une pastille sur une ligne claude du popup réel', () => {
    const rows = rowsDuPopup()
    const claude = rows.filter((r) => r.option.provider === 'claude')
    expect(claude.length).toBeGreaterThan(0)
    const avecReco = claude.filter((r) => recommendedEffort('claude', r.model) !== undefined)
    expect(avecReco.map((r) => r.model)).not.toEqual([])
  })

  it('rend un cran .is-recommended dans la section claude', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(ModelEffortMatrix, {
          rows: rowsDuPopup(),
          activeKey: null,
          onSelect: () => {},
          onClose: () => {}
        })
      )
    })
    const section = host.querySelector('[data-provider="claude"]')
    expect(section).not.toBeNull()
    expect(section?.querySelectorAll('.effort-cran.is-recommended').length).toBe(1)
    const codex = host.querySelector('[data-provider="codex"]')
    const pastilleCodex = codex?.querySelector('.effort-cran.is-recommended')
    expect(pastilleCodex?.closest('.effort-matrix-row')?.getAttribute('data-row')).toBe(
      'codex:gpt-5.6-sol'
    )
    act(() => root.unmount())
    host.remove()
  })
})

const VERT = '#35d07f'

describe('la pastille verte reste VERTE meme sur un cran rempli/actif', () => {
  /**
   * Cause du symptome « pastille visible cote ChatGPT, pas cote Anthropic » : la reco codex
   * (`xhigh`) tombe sur le DERNIER cran, jamais rempli ; la reco claude (`low`) tombe sur le
   * PREMIER cran, toujours `is-filled` — et les regles `.is-filled i` / `.is-active .is-filled i`
   * sont declarees APRES `.is-recommended i`, donc le rose ecrase le vert.
   *
   * Entree qui ferait echouer ce test si la correction etait fausse : la ligne ACTIVE
   * (`.effort-matrix-row.is-active`) dont le cran recommande est aussi `is-filled` — c'est la
   * regle rose la plus specifique du fichier.
   */
  const cranVert = (classesRow: string, classesCran: string): string => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/renderer/src/components/ChatView.css'),
      'utf8'
    )
    const style = document.createElement('style')
    style.textContent = css
    document.head.append(style)
    const host = document.createElement('div')
    host.innerHTML = `<div class="effort-matrix"><div class="effort-matrix-row ${classesRow}"><span class="effort-matrix-track"><button class="effort-cran ${classesCran}"><i></i></button></span></div></div>`
    document.body.append(host)
    const point = host.querySelector('i') as HTMLElement
    const fond = getComputedStyle(point).backgroundColor
    host.remove()
    style.remove()
    // happy-dom rend la valeur brute de la feuille : on normalise avant de comparer.
    return fond.replace(/\s/g, '').toLowerCase()
  }

  it('cran recommande + rempli (ligne inactive) : vert', () => {
    expect(cranVert('', 'is-recommended is-filled is-memorized')).toBe(VERT)
  })

  it('cran recommande + rempli + LIGNE ACTIVE : vert', () => {
    expect(cranVert('is-active', 'is-recommended is-filled is-live')).toBe(VERT)
  })

  it('cran recommande + selectionne (memorise) : vert', () => {
    expect(cranVert('', 'is-recommended is-filled is-memorized is-selected')).toBe(VERT)
  })

  it('un cran NON recommande garde le rose', () => {
    expect(cranVert('', 'is-filled is-memorized')).not.toBe(VERT)
  })
})
