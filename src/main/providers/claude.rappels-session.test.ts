import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { definirDossierModsAutowin, scriptDesGardesCourant } from './claude'

/*
 * Un rappel de règle part UNE fois par SESSION, pas une fois par appel du CLI. La transcription de
 * la session porte déjà le rappel remis au premier appel, et `--resume` la relit : le redonner à
 * chaque appel suivant ajoute le même texte une seconde fois dans le contexte du modèle. Mesure du
 * 2026-11-10 : 4 sessions sur 49 ont reçu la même règle dans deux appels distincts.
 */
const MOD_DU_DEPOT = join(__dirname, '..', '..', '..', 'mods', 'autowin')
const dossiers: string[] = []

afterEach(() => {
  definirDossierModsAutowin(undefined)
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true })
})

const COMMANDE_QUI_DECLENCHE_LA_REGLE = {
  tool_name: 'Bash',
  tool_input: { command: 'cat .autowin-data/autowin-os/conversations.json' }
}

/**
 * Un appel du CLI : son dossier de réglages est NEUF (comme dans `claude.ts`), avec son script et,
 * si un fil est donné, son `reservation.json` qui pointe le dossier persistant de l'application.
 */
const appelDuCli = (racineAppli: string, sessionId: string, fil?: string): string => {
  const reglages = mkdtempSync(join(tmpdir(), 'rappels-appel-'))
  dossiers.push(reglages)
  const script = join(reglages, 'garde-git-destructeur.mjs')
  writeFileSync(script, scriptDesGardesCourant(), 'utf8')
  if (fil) {
    writeFileSync(
      join(reglages, 'reservation.json'),
      JSON.stringify({ fil, registre: join(racineAppli, 'reservations.json'), depuis: 0 }),
      'utf8'
    )
  }
  const env = { ...process.env }
  delete env.AUTOWIN_CONVERSATION_ID
  delete env.AUTOWIN_HDESK_ID
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify({ ...COMMANDE_QUI_DECLENCHE_LA_REGLE, session_id: sessionId }),
    encoding: 'utf8',
    env
  }).stdout
}

const rappelRemis = (sortie: string): boolean =>
  sortie.includes('Rappel [conversations-json-direct]')

const racineAppliDeTest = (): string => {
  const racine = mkdtempSync(join(tmpdir(), 'rappels-appli-'))
  dossiers.push(racine)
  return racine
}

describe('rappels au bon moment : une fois par session', () => {
  it('même session, deuxième appel du CLI : la règle n’est pas redonnée', () => {
    definirDossierModsAutowin(MOD_DU_DEPOT)
    const racine = racineAppliDeTest()
    expect(rappelRemis(appelDuCli(racine, 'session-a', 'conv-test'))).toBe(true)
    expect(rappelRemis(appelDuCli(racine, 'session-a', 'conv-test'))).toBe(false)
  })

  it('autre session du même fil : la règle repart', () => {
    definirDossierModsAutowin(MOD_DU_DEPOT)
    const racine = racineAppliDeTest()
    expect(rappelRemis(appelDuCli(racine, 'session-a', 'conv-test'))).toBe(true)
    expect(rappelRemis(appelDuCli(racine, 'session-b', 'conv-test'))).toBe(true)
  })

  it('sans fil connu : une fois par appel du CLI, comme avant', () => {
    definirDossierModsAutowin(MOD_DU_DEPOT)
    const racine = racineAppliDeTest()
    expect(rappelRemis(appelDuCli(racine, 'session-a'))).toBe(true)
    expect(rappelRemis(appelDuCli(racine, 'session-a'))).toBe(true)
  })
})
