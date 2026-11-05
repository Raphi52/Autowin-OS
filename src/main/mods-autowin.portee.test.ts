import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { register } from '../../mods/autowin/hooks/register.js'
import { REGLE_BUREAU_CACHE } from '../../mods/autowin/hooks/regles.js'
import {
  CHEMIN_REGLAGES_ADMIN,
  ID_MOD_AUTOWIN,
  reglagesAdminAvecModAutowin,
  reglagesAdminSansModAutowin
} from '../../scripts/mod-autowin-admin.mjs'

/**
 * PORTÉE DU MOD AUTOWIN QUAND UN RÉGLAGE ADMINISTRATEUR L'ACTIVE (conv-1582, 2026-11-05).
 *
 * Le garde intégré du CLI (`cc-plugin-sec-default`) saute le mod 2 (`prompt.attachment`) d'un mod
 * « installé par l'utilisateur ». Seul un mod « de l'organisation » le passe : activé par le réglage
 * administrateur `C:\Program Files\ClaudeCode\managed-settings.json` (`enabledPlugins` +
 * `prependPlugins`), depuis un catalogue local chargé sur place
 * (https://code.claude.com/docs/en/plugins/mods/admin.md, « Install your organization's mods »).
 * Ce réglage vaut pour TOUTES les sessions Claude Code du poste : hors d'Autowin, le mod ne doit rien
 * changer. Et le nom du catalogue doit être celui du manifeste, sinon le `--plugin-dir` d'Autowin
 * chargerait une seconde copie (https://code.claude.com/docs/en/plugins/loading.md, « Name conflicts »).
 */

type Handler = (
  $: {
    env: { get: (k: string) => Promise<string | undefined> }
    plugin: { root?: string }
    ui: { log: () => void }
  },
  e: Record<string, unknown>,
  next: (e: Record<string, unknown>) => Promise<unknown>
) => Promise<unknown>

function handlers(): Map<string, Handler> {
  const m = new Map<string, Handler>()
  register((evenement: string, a: unknown, b?: unknown) => {
    m.set(evenement, (typeof a === 'function' ? a : b) as Handler)
  })
  return m
}

function contexte(env: Record<string, string>) {
  return {
    env: { get: async (k: string) => env[k] },
    plugin: { root: 'D:\\AutoWinOS\\mods\\autowin' },
    ui: { log: () => undefined }
  }
}

const DANS_AUTOWIN = { AUTOWIN_APP_DATA_ROOT: 'D:\\AutoWinOS\\.autowin-data\\autowin-os' }
const passe = async (e: Record<string, unknown>) => ({ ...e, passe: true })

describe('mod Autowin — rien ne change hors d’une session lancée par Autowin', () => {
  it('mod 2 : le compte à rebours est retiré dans Autowin, laissé ailleurs', async () => {
    const h = handlers().get('prompt.attachment')!
    const e = { type: 'total_tokens_reminder', text: '<total_tokens>9 tokens left</total_tokens>' }
    expect(await h(contexte(DANS_AUTOWIN), e, passe)).toEqual({ text: null })
    expect(await h(contexte({}), e, passe)).toEqual({ ...e, passe: true })
  })

  it('mod 3 : la règle du bureau caché est ajoutée dans Autowin, absente ailleurs', async () => {
    const h = handlers().get('tool.describe')!
    const suite = async () => ({ description: 'Runs a shell command.' })
    const dedans = (await h(contexte(DANS_AUTOWIN), { tool: 'PowerShell' }, suite)) as {
      description: string
    }
    const dehors = (await h(contexte({}), { tool: 'PowerShell' }, suite)) as { description: string }
    expect(dedans.description).toBe('Runs a shell command.' + REGLE_BUREAU_CACHE)
    expect(dehors.description).toBe('Runs a shell command.')
  })

  it('mod 1 : hors d’un run (sans bureau caché), une app graphique part telle quelle', async () => {
    const h = handlers().get('tool.call')!
    const e = { tool: 'PowerShell', command: 'Start-Process notepad' }
    expect(await h(contexte({}), e, passe)).toEqual({ ...e, passe: true })
  })
})

describe('catalogue local du mod Autowin', () => {
  const racine = join(__dirname, '..', '..', 'mods', 'autowin')
  const lire = (f: string) => JSON.parse(readFileSync(join(racine, '.claude-plugin', f), 'utf8'))

  it('liste le mod sur place, sous le nom de son manifeste', () => {
    expect(existsSync(join(racine, '.claude-plugin', 'marketplace.json'))).toBe(true)
    const catalogue = lire('marketplace.json')
    const manifeste = lire('plugin.json')
    expect(catalogue.plugins).toHaveLength(1)
    expect(catalogue.plugins[0].name).toBe(manifeste.name)
    expect(catalogue.plugins[0].source).toBe('./')
    expect(`${manifeste.name}@${catalogue.name}`).toBe(ID_MOD_AUTOWIN)
  })
})

describe('réglage administrateur du mod Autowin', () => {
  const dossier = 'D:\\AutoWinOS\\mods\\autowin'

  it('vise le fichier que lit le CLI sous Windows', () => {
    expect(CHEMIN_REGLAGES_ADMIN).toBe('C:\\Program Files\\ClaudeCode\\managed-settings.json')
  })

  it('ajoute le catalogue, active le mod et le place avant le garde intégré, sans perdre le reste', () => {
    const r = reglagesAdminAvecModAutowin(
      { model: 'x', enabledPlugins: { 'autre@m': false } },
      dossier
    )
    expect(r.model).toBe('x')
    expect(r.enabledPlugins).toEqual({ 'autre@m': false, [ID_MOD_AUTOWIN]: true })
    expect(r.extraKnownMarketplaces.autowin).toEqual({
      source: { source: 'directory', path: dossier }
    })
    expect(r.prependPlugins).toEqual([ID_MOD_AUTOWIN, 'sec-default@builtin'])
  })

  it('garde le garde intégré et l’ordre déjà posé, et rejouer ne change rien', () => {
    const avant = { prependPlugins: ['cc-plugin-sec-default@builtin', 'audit@org'] }
    const une = reglagesAdminAvecModAutowin(avant, dossier)
    expect(une.prependPlugins).toEqual([
      ID_MOD_AUTOWIN,
      'cc-plugin-sec-default@builtin',
      'audit@org'
    ])
    expect(reglagesAdminAvecModAutowin(une, dossier)).toEqual(une)
  })

  it('le retrait rend le fichier d’avant', () => {
    const avant = { model: 'x' }
    expect(reglagesAdminSansModAutowin(reglagesAdminAvecModAutowin(avant, dossier))).toEqual(avant)
  })
})
