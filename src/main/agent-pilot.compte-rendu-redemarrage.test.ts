import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { Message, SendOptions, SendResult } from './providers/types'
import { forgetChatSession } from './runs/chat-session-store'
import { oublierCompteRenduNonVu } from './runs/compte-rendu-non-vu-store'

/**
 * LE RUN LANCE PAR L'APP SURVIT A UN REDEMARRAGE ENTRE DEUX TOURS (conv-989, 2026-10-16).
 *
 * Suite de `agent-pilot.trou-de-session.test.ts` : un `/frame` est execute par l'app SANS le modele,
 * son compte-rendu est garde pour le tour suivant. Cette note ne vivait qu'en memoire ; la session du
 * modele, elle, est relue depuis le disque. Une app relancee entre les deux tours reprenait donc la
 * session sans la note : le modele ignorait que le run avait eu lieu.
 *
 * Le redemarrage est simule par une NOUVELLE instance d'`AgentPilot` : elle ne partage rien en
 * memoire avec la premiere, seulement le disque — exactement ce qu'un redemarrage laisse.
 */
const CONV = `conv-redemarrage-${process.pid}`

function pilote(
  envoyes: string[],
  resultats: string[] = ['Cadrage rendu : PISTE-UNIQUE à traiter.']
): AgentPilot {
  let rang = 0
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], _o: SendOptions): Promise<SendResult> => {
      envoyes.push(messages.at(-1)?.content ?? '')
      return { text: 'réponse du modèle', sessionId: 'sess-redemarrage' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => [{ name: 'get_state', args: {}, description: 'état' }]),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async (name: string) =>
      name === 'orchestrate'
        ? {
            ok: true,
            data: {
              status: 'succeeded',
              valid: true,
              runPath: 'C:/runs/sess/ouvrir-workspace-workspace/RUN.md',
              result: resultats[Math.min(rang++, resultats.length - 1)]
            }
          }
        : { ok: true, data: { ok: true } }
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AgentPilot(registry as any, roles as any, bus as any)
}

/*
 * ISOLATION : la session et la note vivent sur DISQUE. Dans le dossier de donnees commun des tests,
 * `agent-pilot.trou-de-session.test.ts` reecrit le meme `chat-sessions.json` en parallele, et l'un
 * effacait la session de l'autre (prémisse « session reprise » rouge une fois sur deux, verte seul).
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'compte-rendu-redemarrage-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  forgetChatSession(CONV)
  oublierCompteRenduNonVu(CONV)
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

describe('le compte-rendu d’un tour exécuté sans le modèle survit au redémarrage', () => {
  it('une app relancée entre les deux tours remet quand même le run au modèle', async () => {
    const envoyes: string[] = []
    const avant = pilote(envoyes)
    // Tour 1 — normal : ouvre la session, écrite sur le disque.
    await avant.chat([{ role: 'user', content: 'bonjour' }], () => {}, undefined, 12, CONV)
    // Tour 2 — `/frame` : l'app orchestre sans le modèle.
    const appels = envoyes.length
    await avant.chat(
      [{ role: 'user', content: '/frame ouvrir un workspace' }],
      () => {},
      undefined,
      12,
      CONV
    )
    expect(envoyes.length).toBe(appels)

    // REDÉMARRAGE : nouvelle instance, mémoire vide, même disque.
    const apres = pilote(envoyes)
    await apres.chat(
      [{ role: 'user', content: 'on a bien fait tout le processus ?' }],
      () => {},
      undefined,
      12,
      CONV
    )

    const dernier = envoyes.at(-1) ?? ''
    // Prémisse : la session a bien été REPRISE (sinon le fil entier part et le test ne prouve rien).
    expect(dernier).toContain('Suite de NOTRE conversation')
    expect(dernier).toContain('PISTE-UNIQUE')
    expect(dernier).toContain('hors de ta session')
  })

  it('la note n’est remise qu’une fois, même après redémarrage', async () => {
    const envoyes: string[] = []
    const avant = pilote(envoyes)
    await avant.chat([{ role: 'user', content: 'bonjour' }], () => {}, undefined, 12, CONV)
    await avant.chat([{ role: 'user', content: '/frame ouvrir' }], () => {}, undefined, 12, CONV)
    await pilote(envoyes).chat(
      [{ role: 'user', content: 'et alors ?' }],
      () => {},
      undefined,
      12,
      CONV
    )
    await pilote(envoyes).chat(
      [{ role: 'user', content: 'ensuite ?' }],
      () => {},
      undefined,
      12,
      CONV
    )
    expect(envoyes.at(-2)).toContain('PISTE-UNIQUE')
    expect(envoyes.at(-1)).not.toContain('PISTE-UNIQUE')
  })
})

/**
 * DEUX TOURS SANS LE MODELE D'AFFILEE : le second n'efface plus le premier (conv-989).
 *
 * La note etait un `set` par conversation : un `/scout` suivi d'un `/frame`, sans message entre les
 * deux, ne laissait au modele que le `/frame`. Le run du `/scout`, paye, n'existait plus pour lui.
 */
describe('deux tours exécutés sans le modèle d’affilée arrivent tous les deux', () => {
  it('un /scout puis un /frame : le tour suivant reçoit les deux résultats, dans l’ordre', async () => {
    const envoyes: string[] = []
    const p = pilote(envoyes, [
      'Scout rendu : PISTE-DU-SCOUT.',
      'Cadrage rendu : PISTE-DU-CADRAGE.'
    ])
    await p.chat([{ role: 'user', content: 'bonjour' }], () => {}, undefined, 12, CONV)
    await p.chat([{ role: 'user', content: '/scout cherche' }], () => {}, undefined, 12, CONV)
    await p.chat([{ role: 'user', content: '/frame cadre' }], () => {}, undefined, 12, CONV)
    await p.chat([{ role: 'user', content: 'résume' }], () => {}, undefined, 12, CONV)

    const dernier = envoyes.at(-1) ?? ''
    expect(dernier).toContain('PISTE-DU-SCOUT')
    expect(dernier).toContain('PISTE-DU-CADRAGE')
    expect(dernier.indexOf('PISTE-DU-SCOUT')).toBeLessThan(dernier.indexOf('PISTE-DU-CADRAGE'))
  })

  it('même chose à travers un redémarrage entre les deux tours', async () => {
    const envoyes: string[] = []
    const avant = pilote(envoyes, ['Scout rendu : PISTE-DU-SCOUT.'])
    await avant.chat([{ role: 'user', content: 'bonjour' }], () => {}, undefined, 12, CONV)
    await avant.chat([{ role: 'user', content: '/scout cherche' }], () => {}, undefined, 12, CONV)
    const apres = pilote(envoyes, ['Cadrage rendu : PISTE-DU-CADRAGE.'])
    await apres.chat([{ role: 'user', content: '/frame cadre' }], () => {}, undefined, 12, CONV)
    await apres.chat([{ role: 'user', content: 'résume' }], () => {}, undefined, 12, CONV)

    const dernier = envoyes.at(-1) ?? ''
    expect(dernier).toContain('PISTE-DU-SCOUT')
    expect(dernier).toContain('PISTE-DU-CADRAGE')
  })
})

/**
 * conv-1074 (2026-10-22) : le compte-rendu d'un tour execute SANS le modele lui est remis au tour
 * suivant, puis reste dans sa session pour tous les tours d'apres. Il portait le code ENTIER des
 * pages `html-render` du run. Entree qui ferait echouer une mauvaise correction : `#d4a94f`, la
 * couleur du `<style>` de la page, et le texte place APRES une page plus longue que la borne de tout
 * resultat injecte (un filtre applique apres la coupe ne le verrait jamais).
 */
describe('le compte-rendu remis au modèle porte le texte des pages, pas leur code', () => {
  it('une page html-render du run arrive en texte visible au tour suivant', async () => {
    const envoyes: string[] = []
    const page =
      '```html-render\n<style>.c{color:#d4a94f}</style>\n' +
      '<p class="c">PAGE-VUE</p>\n'.repeat(6_000) +
      '```\nAPRES-LA-PAGE'
    expect(page.length).toBeGreaterThan(120_000)
    const p = pilote(envoyes, [page])
    await p.chat([{ role: 'user', content: 'bonjour' }], () => {}, undefined, 12, CONV)
    await p.chat([{ role: 'user', content: '/scout cherche' }], () => {}, undefined, 12, CONV)
    await p.chat([{ role: 'user', content: 'résume' }], () => {}, undefined, 12, CONV)

    const dernier = envoyes.at(-1) ?? ''
    expect(dernier).toContain('hors de ta session')
    expect(dernier).toContain('PAGE-VUE')
    expect(dernier).toContain('APRES-LA-PAGE')
    expect(dernier).not.toContain('#d4a94f')
    expect(dernier).not.toMatch(/<\/?(p|style)\b/i)
  })
})
