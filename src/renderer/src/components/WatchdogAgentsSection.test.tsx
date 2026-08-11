import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WatchdogAgentsSection } from './WatchdogAgentsSection'

describe('WatchdogAgentsSection', () => {
  it('affiche le statut de chaque occurrence séparément de son issue', () => {
    const html = renderToStaticMarkup(
      createElement(WatchdogAgentsSection, {
        tasks: [
          {
            id: 'auto-kaizen',
            title: 'Auto-kaizen',
            enabled: true,
            watchdog: {
              source: { kind: 'app-event', events: ['orchestration-red'] },
              guards: {
                dedupWindowMs: 1_800_000,
                maxTriggersPerHour: 1,
                maxChainDepth: 0,
                maxPerRoot: 1
              }
            }
          }
        ],
        occurrences: [
          {
            id: 'failed-run',
            taskId: 'auto-kaizen',
            scheduledFor: 10,
            status: 'failed',
            trigger: 'watchdog'
          },
          {
            id: 'cancelled-run',
            taskId: 'auto-kaizen',
            scheduledFor: 9,
            status: 'cancelled',
            trigger: 'watchdog'
          }
        ],
        formatDateTime: (value) => String(value),
        onCreate: vi.fn(),
        onSelect: vi.fn()
      })
    )

    expect(html).toContain('<strong>2</strong> sans issue')
    expect(html).toContain('<strong>1</strong> échec')
    expect(html).toContain('<strong>1</strong> annulation')
    expect(html).toMatch(/watchdog-status[^>]*>Échec<\/span>/)
    expect(html).toMatch(/watchdog-status[^>]*>Annulé<\/span>/)
    expect(html.match(/watchdog-outcome[^>]*>Issue non renseignée<\/span>/g)).toHaveLength(2)
  })
})
