// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScoutTable } from './ScoutTable'
import type { ScoutRow } from './scout-table'

let container: HTMLDivElement
let root: Root
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})
function render(props: Parameters<typeof ScoutTable>[0]): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(ScoutTable, props)))
}

const ROWS: ScoutRow[] = [
  { num: '1', impact: 'g', effort: 'y', type: 'fix', what: 'Reprise run', why: 'crash', how: 'commands.ts:598' },
  { num: '2', impact: 'y', effort: 'g', type: 'new', what: 'Findings', why: 'aveugle', how: 'orch.ts:241' }
]

describe('ScoutTable', () => {
  it('rend une ligne par candidat avec les pastilles impact/effort', () => {
    render({ rows: ROWS })
    expect(container.querySelectorAll('[data-testid="st-row"]')).toHaveLength(2)
    expect(container.querySelector('.st-dot.st-g')).not.toBeNull()
    expect(container.querySelector('.st-dot.st-y')).not.toBeNull()
    expect(container.textContent).toContain('Reprise run')
  })

  it('un clic sur une ligne envoie « frame le candidat #N »', () => {
    const onPick = vi.fn()
    render({ rows: ROWS, onPick })
    const row = container.querySelector('[data-testid="st-row"]') as HTMLTableRowElement
    act(() => row.click())
    expect(onPick).toHaveBeenCalledWith('frame le candidat #1')
  })
})
