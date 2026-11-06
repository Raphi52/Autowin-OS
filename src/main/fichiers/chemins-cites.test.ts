import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CONSIGNE_LIGNE_BESOIN,
  blocsSystemeEcran,
  buildChatPilotagePrompt
} from '../consignes/chat-pilotage-prompt'
import { cheminsCites, citationsCassees, existeAvecMotif } from './chemins-cites'
import { CATALOG } from '../commands/commands'
import { consigneBureauCache } from '../consignes/consigne-bureau-cache'
import { CONSTITUTION } from '../consignes/constitution'
import {
  CONSIGNE_RELECTURE_FROIDE,
  PHASE_BRIEFS,
  consigneFusionScout,
  phaseBrief
} from '../consignes/phase-briefs'
import type { PipelinePhase } from '../skills/skill-pipeline'

/**
 * Les textes ENVOYÉS AUX AGENTS ne citent que des chemins et des scripts qui existent.
 *
 * POURQUOI (scout du 05/11, piste ancien n° 9, conv-1602) : `agents-md-faits.test.ts` ne vérifiait
 * qu'AGENTS.md. La constitution, la consigne du chat, les consignes d'étape et les SKILL.md partent
 * eux aussi à chaque agent, et un chemin périmé y passait sans bruit.
 *
 * Entrée qui DOIT faire rougir : un de ces textes qui cite `src/main/n-existe-pas.ts` (ou
 * `npm run n-existe-pas`). Le premier bloc le rejoue sur un texte fabriqué, avec son jumeau accepté.
 *
 * fix-ok: premier passage du 05/11 sur les vrais textes, 6 rouges mesurés et AUCUN chemin réellement
 * cassé — 3 suffixes de ligne (`objections-juge.ts:30`, `claude.ts:821`, `verify-command.ts:75`),
 * 1 span désapparié par une clôture ``` (consigne du chat), 2 absents voulus (ABSENTS_VOULUS) ; et la
 * skill ignorée `skills/arenagame/` du poste citait les chemins de son propre projet (conv-1602).
 */

// La racine se lit depuis CE fichier, pas depuis le dossier où vitest a été lancé.
const RACINE = fileURLToPath(new URL('../../..', import.meta.url))
const SCRIPTS_NPM: Record<string, string> = JSON.parse(
  readFileSync(join(RACINE, 'package.json'), 'utf8')
).scripts

describe('citationsCassees : un chemin ou un script cité qui n’existe pas', () => {
  it('refuse un chemin du dépôt inexistant ; accepte le même texte sur un chemin réel', () => {
    expect(citationsCassees('voir `src/main/n-existe-pas.ts`', RACINE, SCRIPTS_NPM)).toEqual([
      'chemin absent : src/main/n-existe-pas.ts'
    ])
    expect(citationsCassees('voir `src/main/fichiers/chemins-cites.ts`', RACINE, SCRIPTS_NPM)).toEqual([])
  })

  it('refuse un chemin cité dans une commande ; accepte la même commande sur un vrai script', () => {
    expect(
      citationsCassees('`node scripts/n-existe-pas.mjs --code-dev`', RACINE, SCRIPTS_NPM)
    ).toEqual(['chemin absent : scripts/n-existe-pas.mjs'])
    expect(
      citationsCassees('`node scripts/ui-capture.mjs --code-dev`', RACINE, SCRIPTS_NPM)
    ).toEqual([])
  })

  it('refuse un `npm run` inconnu ; accepte un script de package.json', () => {
    expect(citationsCassees('lance `npm run n-existe-pas`', RACINE, SCRIPTS_NPM)).toEqual([
      'script npm absent : npm run n-existe-pas'
    ])
    expect(citationsCassees('lance `npm run typecheck`', RACINE, SCRIPTS_NPM)).toEqual([])
  })
})

describe('extraction des chemins cités', () => {
  it('prend les chemins des commandes et ignore les données du poste', () => {
    const texte =
      '`node scripts/ui-capture.mjs --code-dev` · `src/main/` · `turn-journals/<conv>/x.jsonl` · `x.ts` · `.gitignore`'
    expect(cheminsCites(texte)).toEqual(['scripts/ui-capture.mjs', 'src/main/', '.gitignore'])
  })

  it('un placeholder vaut n’importe quelle entrée, mais une entrée doit exister', () => {
    expect(existeAvecMotif('skills/<nom>/SKILL.md'.split('/'), RACINE)).toBe(true)
    expect(existeAvecMotif('skills/*/SKILL-absent.md'.split('/'), RACINE)).toBe(false)
  })

  it('un suffixe de ligne et la ponctuation collée tombent ; le fichier doit encore exister', () => {
    expect(cheminsCites('`src/main/fichiers/chemins-cites.ts:30` · `(scripts/ui-capture.mjs),`')).toEqual([
      'src/main/fichiers/chemins-cites.ts',
      'scripts/ui-capture.mjs'
    ])
    expect(citationsCassees('`src/main/fichiers/chemins-cites.ts:30-42`', RACINE, SCRIPTS_NPM)).toEqual([])
    expect(citationsCassees('`src/main/n-existe-pas.ts:30`', RACINE, SCRIPTS_NPM)).toEqual([
      'chemin absent : src/main/n-existe-pas.ts'
    ])
  })

  it('une clôture ``` ne désapparie pas les spans qui suivent', () => {
    // Forme réelle (description de commande du chat) : sans le retrait des clôtures, le span lu
    // allait de « ```html-interactif » jusqu'au span suivant et prenait la prose entre les deux.
    const texte = 'un bloc ```html-render lu dans (scripts/n-existe-pas.mjs) puis `src/main/`'
    expect(cheminsCites(texte)).toEqual(['src/main/'])
  })
})

/**
 * Les SKILL.md du dépôt, tels que les agents les reçoivent : suivis par git, ou nouveaux et non
 * ignorés. Une skill IGNORÉE (`.gitignore`, ex. `skills/arenagame/`) vit sur le poste seulement et
 * cite les chemins de SON projet, pas de celui-ci : hors de portée, comme `.autowin-data/`.
 */
function skillsDuDepot(): Array<[string, string]> {
  const sortie = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'skills'],
    { cwd: RACINE, encoding: 'utf8', windowsHide: true }
  )
  return sortie
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter((chemin) => /^skills\/[^/]+\/SKILL\.md$/.test(chemin))
    .filter((chemin) => existsSync(join(RACINE, chemin)))
    .map((chemin): [string, string] => [chemin, readFileSync(join(RACINE, chemin), 'utf8')])
}

/**
 * Chemins absents cités EXPRÈS, par texte. Chaque entrée doit rester VRAIE : si la citation
 * disparaît ou si le fichier vient à exister, le test rougit — retire alors l'entrée.
 */
const ABSENTS_VOULUS: Record<string, { chemins: string[]; raison: string }> = {
  'skills/arena/SKILL.md': {
    chemins: ['scripts/fingerprint.py'],
    raison:
      'le texte raconte la preuve INVENTÉE par deux bras d’arena : le fichier est absent, c’est le fait'
  },
  'consigne d’étape clean': {
    chemins: ['src/main/a.test.ts', 'src/main/b'],
    raison: 'exemple de la FORME d’une commande de rejeu, pas un fichier à lancer'
  }
}

/**
 * Chaque texte, sous toutes ses formes envoyées : la consigne du chat change selon que les outils
 * directs sont servis ou non (`fichiersParOutils`, chat-pilotage-prompt.ts) ; on rejoue les deux.
 */
const TEXTES: Array<[string, string]> = [
  ['constitution', CONSTITUTION],
  ['consigne du chat (sans outils directs)', buildChatPilotagePrompt(CATALOG)],
  [
    'consigne du chat (outils directs servis)',
    buildChatPilotagePrompt(CATALOG, { outilsDirects: CATALOG.map((c) => c.name) })
  ],
  // Les blocs écran tels qu'`agent-pilot.ts` les envoie (`blocsSystemeEcran`), image jointe pour
  // servir le bloc visuel EN ENTIER, bureau caché du fil compris (conv-1602).
  ...blocsSystemeEcran('', true, 'conv-test').map((b): [string, string] => [
    `consigne du chat : bloc ${b.name}`,
    b.text
  ]),
  ['consigne du chat : ligne de besoin', CONSIGNE_LIGNE_BESOIN],
  // Injectée au système de chaque étape d'un run (orchestrator-parcours-*.ts) ; elle cite
  // `scripts/hdesk-lancer.ps1`, `scripts/hdesk-observe.ps1` et `scripts/ui-capture.mjs` (conv-1602).
  ['consigne du bureau caché des étapes', consigneBureauCache('run-test')],
  ...(Object.keys(PHASE_BRIEFS) as PipelinePhase[]).map((phase): [string, string] => [
    `consigne d’étape ${phase}`,
    phaseBrief(phase)
  ]),
  ['consigne de fusion du scout', consigneFusionScout(2, '')],
  ['consigne de relecture à froid', CONSIGNE_RELECTURE_FROIDE],
  ...skillsDuDepot()
]

describe('textes envoyés aux agents — leurs chemins et scripts cités existent', () => {
  it('l’extraction trouve des citations (sinon elle est cassée, pas les textes)', () => {
    expect(TEXTES.length).toBeGreaterThan(20)
    const chemins = new Set(TEXTES.flatMap(([, texte]) => cheminsCites(texte)))
    expect(chemins.size).toBeGreaterThan(10)
  })

  // Le bloc visuel part en ENTIER, `REGLES_VISUELLES + consigneBureauCacheChat(...)`
  // (`blocsSystemeEcran`) : n'en vérifier que le début laissait sans contrôle tout chemin écrit un
  // jour dans sa fin (mesuré le 05/11 : `consigneBureauCacheChat` n'en cite encore aucun). Les scripts
  // hdesk sont cités par le bloc `ecranUtilisateur` et par `consigneBureauCache` des étapes
  // (objection du juge, conv-1602).
  // fix-ok: mesuré le 05/11 — ce test rougissait avec 2 textes envoyés non vérifiés : le bloc visuel
  // complet (REGLES_VISUELLES seul était dans TEXTES) et `consigneBureauCache` des étapes (conv-1602).
  it('les blocs écran du chat sont vérifiés tels qu’ils partent, bureau caché compris', () => {
    const verifies = new Set(TEXTES.map(([, texte]) => texte))
    const envoyes = [
      ...blocsSystemeEcran('', true, 'conv-test').map((b) => b.text),
      consigneBureauCache('run-test')
    ].filter((texte) => texte.trim())
    expect(envoyes.length).toBe(3)
    expect(envoyes.filter((texte) => !verifies.has(texte))).toEqual([])
  })

  it('chaque exception vise un texte qui existe encore', () => {
    const noms = new Set(TEXTES.map(([nom]) => nom))
    expect(Object.keys(ABSENTS_VOULUS).filter((nom) => !noms.has(nom))).toEqual([])
  })

  it.for(TEXTES)('%s', ([nom, texte]) => {
    const voulus = (ABSENTS_VOULUS[nom]?.chemins ?? []).map((c) => `chemin absent : ${c}`)
    expect(citationsCassees(texte, RACINE, SCRIPTS_NPM)).toEqual(voulus)
  })
})
