import { describe, expect, it } from 'vitest'
import {
  applyToolSelectionPlan,
  guardParsed,
  hermesBin,
  parsePlugins,
  parseTools,
  planToolSelection
} from './hermes-controls'

describe('Hermes prompt-load controls', () => {
  it('parses every plugin row including disabled bundled plugins', () => {
    const parsed = parsePlugins(
      JSON.stringify([
        {
          name: 'deepinfra',
          status: 'not enabled',
          version: '1.0.0',
          description: 'DeepInfra image generation',
          source: 'bundled'
        },
        {
          name: 'deepinfra',
          status: 'not enabled',
          version: '1.0.0',
          description: 'DeepInfra video generation',
          source: 'bundled'
        },
        {
          name: 'hermes-amitel-brain',
          status: 'enabled',
          version: '0.1.0',
          description: 'Amitel Brain context injection',
          source: 'user'
        }
      ])
    )
    expect(parsed).toEqual([
      {
        id: 'deepinfra',
        label: 'deepinfra',
        description: 'DeepInfra image generation',
        enabled: false,
        mutable: false,
        source: 'bundled · v1.0.0'
      },
      {
        id: 'deepinfra',
        label: 'deepinfra',
        description: 'DeepInfra video generation',
        enabled: false,
        mutable: false,
        source: 'bundled · v1.0.0'
      },
      {
        id: 'hermes-amitel-brain',
        label: 'hermes-amitel-brain',
        description: 'Amitel Brain context injection',
        enabled: true,
        mutable: true,
        source: 'user · v0.1.0'
      }
    ])
    expect(parsed).toHaveLength(3)
  })

  it('plans one bounded transition from current state to an exact preset', () => {
    expect(
      planToolSelection(
        ['file', 'web', 'vision', 'terminal'],
        ['file', 'web', 'vision'],
        ['file', 'terminal']
      )
    ).toEqual({
      enable: ['terminal'],
      disable: ['web', 'vision']
    })
  })

  it('rejects target toolsets outside the authoritative catalogue', () => {
    expect(() => planToolSelection(['file'], ['file'], ['file', 'invented'])).toThrow(
      'Toolset Hermes inconnu: invented'
    )
  })

  it('applies a batch plan in disable-then-enable order', async () => {
    const calls: string[][] = []
    await applyToolSelectionPlan({ enable: ['terminal'], disable: ['web'] }, async (args) => {
      calls.push(args)
      return ''
    })
    expect(calls).toEqual([
      ['tools', 'disable', 'web', '--platform', 'cli'],
      ['tools', 'enable', 'terminal', '--platform', 'cli']
    ])
  })

  it('rolls the first batch back if the second batch fails', async () => {
    const calls: string[][] = []
    await expect(
      applyToolSelectionPlan({ enable: ['terminal'], disable: ['web'] }, async (args) => {
        calls.push(args)
        if (calls.length === 2) throw new Error('enable failed')
        return ''
      })
    ).rejects.toThrow('enable failed')
    expect(calls.slice(2)).toEqual([
      ['tools', 'disable', 'terminal', '--platform', 'cli'],
      ['tools', 'enable', 'web', '--platform', 'cli']
    ])
  })
})

describe('F2 — guardParsed (anti-échec silencieux)', () => {
  it('lève une erreur si la sortie a des entrées mais que 0 est parsé (format changé)', () => {
    const drifted = 'Tool  status\nfoo   enabled\nbar   disabled' // format inconnu → parseTools rend []
    expect(() => guardParsed(parseTools(drifted), drifted, 'tools')).toThrow(/non reconnu/i)
  })
  it('rend la liste vide sans erreur si la sortie est réellement vide', () => {
    expect(guardParsed([], 'Aucun outil.\n', 'tools')).toEqual([])
  })
})

describe('F5 — hermesBin (chemin configurable)', () => {
  it('honore HERMES_BIN puis HERMES_HOME, sinon défaut', () => {
    expect(hermesBin({ HERMES_BIN: '/opt/hermes/bin/hermes' } as NodeJS.ProcessEnv)).toBe(
      '/opt/hermes/bin/hermes'
    )
    expect(hermesBin({ HERMES_HOME: '/opt/hermes' } as NodeJS.ProcessEnv)).toContain('hermes-agent')
    expect(hermesBin({} as NodeJS.ProcessEnv)).toMatch(/hermes/)
  })
})
