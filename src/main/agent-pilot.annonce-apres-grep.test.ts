import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { PromptSnapshot } from './commands'

/*
 * ISOLATION : le pilote inscrit ses echecs dans un registre qui PERSISTE sur disque — racine
 * temporaire, comme agent-pilot.relance-remplace.test.ts.
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'annonce-apres-grep-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

/**
 * UN GREP SEUL N'EST PAS UNE ACTION — même quand sa ligne de FIN ou son BATTEMENT arrive (conv-341).
 *
 * Le fournisseur émet, pour UNE commande, trois sortes de lignes : son départ (`Bash · grep …`), ses
 * battements (`Bash en cours - 1 min - …`) et sa fin (`Bash terminé - 3 s`). Seul le départ porte la
 * commande. `statusEstUneAction` prenait pourtant toute ligne commençant par « Bash » pour un départ :
 * « terminé - 3 s » devenait la commande à juger, qui n'est pas une lecture, donc une ACTION. Un tour
 * qui n'avait fait que LIRE passait pour un tour qui avait AGI, et la garde « tu as annoncé sans
 * agir » se taisait sur une réponse qui ne faisait qu'annoncer.
 *
 * L'oracle est la consigne réellement renvoyée au modèle : c'est elle qui dit si la garde a mordu.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

type Etape = { status: string; statusTarget?: string } | { texte: string }

async function jouer(demande: string, appels: Etape[][]): Promise<string[]> {
  const consignes: string[] = []
  const send = vi.fn(
    async (
      _provider: string,
      messages: { content: string }[],
      _options: unknown,
      onChunk?: (chunk: { delta: string; status?: string; statusTarget?: string }) => void
    ) => {
      consignes.push(messages.map((m) => m.content).join('\n'))
      let text = ''
      for (const etape of appels.shift() ?? []) {
        if ('texte' in etape) {
          text += etape.texte
          onChunk?.({ delta: etape.texte })
        } else onChunk?.({ delta: '', ...etape })
      }
      return { text, provider: 'claude' }
    }
  )
  const registry = {
    send,
    describePrompt: () => ({
      provider: 'claude',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const roles = {
    getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
  }
  const bus = {
    catalog: () => [{ name: 'get_state', args: {}, description: 'etat' }],
    snapshotForPrompt,
    exec: vi.fn(async () => ({ ok: true, data: {} }))
  }
  await new AgentPilot(registry as never, roles as never, bus as never).chat(
    [{ role: 'user', content: demande }],
    () => {},
    undefined,
    4,
    'conv-annonce-apres-grep',
    undefined, // signal
    undefined, // drainDirectives
    undefined, // bindingOverride
    undefined, // turnId
    undefined, // runtimeBinding
    undefined, // recoveredProviderCall
    undefined, // onProviderJournal
    undefined, // sendLimits
    undefined, // routingUserMessageOverride
    undefined, // tourCoupePourCeMessage
    true // exigerExperienceSoignee : la politique que la surface de chat active en vrai
  )
  return consignes
}

const RELANCE_ANNONCE = 'tu as ANNONCÉ ce que tu allais faire, sans rien faire'
const ANNONCE = { texte: 'J’ai trouvé la fonction. Je vais corriger le classement maintenant.' }
const CLOTURE = {
  texte:
    'Corrigé.\n\n✅ Fait\n1. Corrigé le classement.\n\n📍 Maintenant : corrigé.\n' +
    '⏳ Reste à faire : aucune étape.\n👉 Recommandé : aucune suite.'
}

describe('annonce sans action après un grep seul (conv-341)', () => {
  it('départ, battement et fin d’un grep : la garde « annonce sans action » mord', async () => {
    const consignes = await jouer('corrige statusEstUneAction', [
      [
        { status: 'Bash · grep -rn statusEstUneAction src' },
        {
          status: 'Bash en cours - 1 min - grep -rn statusEstUneAction src',
          statusTarget: 'grep -rn statusEstUneAction src'
        },
        { status: 'Bash terminé - 3 s' },
        ANNONCE
      ],
      [CLOTURE]
    ])
    expect(consignes).toHaveLength(2)
    expect(consignes[1]).toContain(RELANCE_ANNONCE)
  })

  it('un grep qui échoue n’est pas non plus une action', async () => {
    const consignes = await jouer('corrige statusEstUneAction', [
      [{ status: 'Bash · grep -rn absent src' }, { status: 'Bash échoué - 2 s' }, ANNONCE],
      [CLOTURE]
    ])
    expect(consignes[1]).toContain(RELANCE_ANNONCE)
  })

  it('CONTRE-EXEMPLE — une commande qui agit, puis annonce : aucune relance d’annonce', async () => {
    const consignes = await jouer('corrige statusEstUneAction', [
      [
        { status: 'Bash · npx vitest run src/main/x.test.ts' },
        { status: 'Bash terminé - 12 s' },
        ANNONCE
      ],
      [CLOTURE]
    ])
    expect(consignes.slice(1).some((c) => c.includes(RELANCE_ANNONCE))).toBe(false)
  })
})
