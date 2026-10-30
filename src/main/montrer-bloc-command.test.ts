import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import type { CommandSpec } from './commands'
import {
  blocDuContenu,
  estUnFluxDeBloc,
  nombreDeBoutons,
  preparerBlocAMontrer,
  PREFIXE_FLUX_BLOC
} from './montrer-bloc-command'
import type { Message, SendOptions, SendResult } from './providers/types'

/**
 * `montrer_bloc` (conv-1306, 2026-10-30) : un bloc lu dans un fichier arrive dans le TEXTE du fil,
 * sur son propre flux, et jamais dans ce que reçoit le modèle IA.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER une mauvaise correction :
 *  - renvoyer le bloc dans `data` (le modèle le recevrait : c'est le coût qu'on supprime) ;
 *  - poser le bloc sur le flux du modèle (une relance de l'itération l'effacerait avec lui) ;
 *  - accepter un bloc non refermé (la suite du fil sortirait en texte brut).
 */

const CARROUSEL =
  '```html-render\n<div class="dkc"><p>Proposition 1</p>' +
  '<a href="#autowin-prompt">Affiner la 1 · Nacre</a>' +
  '<a href="#autowin-prompt">Implémenter la 1 · Nacre</a></div>\n```\n'

describe('montrer_bloc — lecture du fichier', () => {
  it('un .md de draft-carrousel est posé tel quel', () => {
    const lu = blocDuContenu(CARROUSEL)
    expect(lu).toEqual({ ok: true, langage: 'html-render', bloc: CARROUSEL.trim() })
  })

  it('une page HTML brute est enveloppée, en html-render par défaut', () => {
    expect(blocDuContenu('<p>bonjour</p>')).toEqual({
      ok: true,
      langage: 'html-render',
      bloc: '```html-render\n<p>bonjour</p>\n```'
    })
    expect(blocDuContenu('<p>x</p>', 'html-interactif')).toMatchObject({
      ok: true,
      bloc: '```html-interactif\n<p>x</p>\n```'
    })
  })

  it('refuse un bloc jamais refermé, suivi de texte, ou d un autre langage', () => {
    expect(blocDuContenu('```html-render\n<p>x</p>\n')).toMatchObject({ ok: false })
    expect(blocDuContenu('```html-render\n<p>x</p>\n```\nSuite')).toMatchObject({
      ok: false,
      raison: expect.stringContaining('que ce bloc')
    })
    expect(blocDuContenu('```js\nalert(1)\n```')).toMatchObject({ ok: false })
    expect(blocDuContenu(CARROUSEL, 'html-interactif')).toMatchObject({ ok: false })
  })

  it('refuse une page brute dont une ligne fermerait le bloc', () => {
    expect(blocDuContenu('<p>x</p>\n```\n<p>y</p>')).toMatchObject({
      ok: false,
      raison: expect.stringContaining('ligne 2')
    })
  })

  it('compte les boutons de choix', () => {
    expect(nombreDeBoutons(CARROUSEL)).toBe(2)
  })

  it('préparation : chemin relatif au dossier de travail, résumé SANS le bloc', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'aos-bloc-'))
    writeFileSync(join(dossier, 'tour.md'), CARROUSEL)
    const pret = preparerBlocAMontrer({ path: 'tour.md' }, dossier)
    expect(pret.ok).toBe(true)
    if (!pret.ok) return
    expect(pret.bloc).toBe(CARROUSEL.trim())
    expect(pret.resume).toMatchObject({ montre: true, langage: 'html-render', boutons: 2 })
    expect(JSON.stringify(pret.resume)).not.toContain('Affiner la 1')
  })

  it('préparation : refus nommés (extension, absent, trop gros)', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'aos-bloc-'))
    writeFileSync(join(dossier, 'secret.env'), 'A=1')
    writeFileSync(join(dossier, 'gros.md'), CARROUSEL)
    expect(preparerBlocAMontrer({ path: 'secret.env' }, dossier)).toMatchObject({ ok: false })
    expect(preparerBlocAMontrer({ path: 'absent.md' }, dossier)).toMatchObject({
      ok: false,
      raison: expect.stringContaining('introuvable')
    })
    expect(preparerBlocAMontrer({ path: 'gros.md' }, dossier, 10)).toMatchObject({
      ok: false,
      raison: expect.stringContaining('artefact')
    })
    expect(preparerBlocAMontrer({}, dossier)).toMatchObject({ ok: false })
  })
})

const CATALOGUE: CommandSpec[] = [
  { name: 'montrer_bloc', description: 'poser un bloc', args: { path: 'chemin' } }
]
const resultatDuBus = {
  ok: true,
  data: { montre: true, langage: 'html-render', boutons: 2 },
  blocs: [CARROUSEL.trim()]
}

function pilote(
  textes: string[],
  pendant?: (o: SendOptions) => Promise<void>,
  outilsNatifs = false
): { jouer: () => Promise<void>; evenements: PilotEvent[]; envois: Message[][] } {
  const envois: Message[][] = []
  const restants = [...textes]
  let premier = true
  const registry = {
    send: vi.fn(async (_p: string, messages: Message[], o: SendOptions): Promise<SendResult> => {
      envois.push(messages)
      if (premier && pendant) await pendant(o)
      premier = false
      return { text: restants.shift() ?? 'fin.' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    honoursSessionResume: vi.fn(() => false)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => CATALOGUE),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => resultatDuBus)
  }
  const p = new AgentPilot(
    registry as never,
    roles as never,
    bus as never,
    undefined,
    () => '',
    () => '',
    outilsNatifs
  )
  const evenements: PilotEvent[] = []
  return {
    evenements,
    envois,
    jouer: () =>
      p.chat(
        [{ role: 'user', content: 'montre le carrousel' } as Message],
        (e) => evenements.push(e),
        undefined,
        4
      )
  }
}

/** Le delta du bloc, et sa position après le résultat de sa commande. */
function blocPoseApresResultat(evenements: PilotEvent[]): PilotEvent | undefined {
  const iResultat = evenements.findIndex((e) => e.kind === 'result' && e.name === 'montrer_bloc')
  const iBloc = evenements.findIndex((e) => e.kind === 'delta' && estUnFluxDeBloc(e.streamId))
  expect(iResultat).toBeGreaterThanOrEqual(0)
  expect(iBloc).toBeGreaterThan(iResultat)
  return evenements[iBloc]
}

describe('montrer_bloc — pose dans le fil', () => {
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-bloc-pilote-'))))
  afterEach(() => configureAutowinAppDataBase(undefined))

  it('<cmd> : le bloc entre dans le fil sur son flux, jamais dans la suite envoyée au modèle', async () => {
    const t = pilote([
      'Voici les variantes. <cmd>{"name":"montrer_bloc","args":{"path":"tour.md"}}</cmd>',
      'Choisis dans le carrousel.'
    ])
    await t.jouer()
    const bloc = blocPoseApresResultat(t.evenements)
    expect(bloc).toMatchObject({ kind: 'delta' })
    expect(String((bloc as { streamId?: string }).streamId)).toMatch(
      new RegExp(`^${PREFIXE_FLUX_BLOC}`)
    )
    expect(String((bloc as { text?: string }).text)).toContain('Affiner la 1 · Nacre')
    const suite = JSON.stringify(t.envois.slice(1))
    expect(t.envois.length).toBeGreaterThanOrEqual(2)
    expect(suite).not.toContain('Affiner la 1')
  })

  it('outil direct : même pose, et le modèle ne reçoit que le résumé', async () => {
    let recu = ''
    const t = pilote(
      ['Choisis dans le carrousel.'],
      async (o) => {
        const cfg = JSON.parse(o.skillNodeTools!.mcpConfig) as {
          mcpServers: { autowin: { url: string; headers: Record<string, string> } }
        }
        const r = await fetch(cfg.mcpServers.autowin.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...cfg.mcpServers.autowin.headers },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'montrer_bloc', arguments: { path: 'tour.md' } }
          })
        })
        recu = JSON.stringify(await r.json())
      },
      true
    )
    await t.jouer()
    const bloc = blocPoseApresResultat(t.evenements)
    expect(String((bloc as { text?: string }).text)).toContain('Implémenter la 1 · Nacre')
    expect(recu).toContain('boutons')
    expect(recu).not.toContain('Affiner la 1')
  })
})
