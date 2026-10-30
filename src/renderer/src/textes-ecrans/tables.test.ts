import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as accueil from './accueil'
import * as agentStudio from './agent-studio'
import * as artefactsEtBandeaux from './artefacts-et-bandeaux'
import * as boardEtMaintenance from './board-et-maintenance'
import * as boardProjets from './board-projets'
import * as chatDecisions from './chat-decisions'
import * as chatExecution from './chat-execution'
import * as chatFil from './chat-fil'
import * as chatFilsEtLots from './chat-fils-et-lots'
import * as chatPanneaux from './chat-panneaux'
import * as horsElectron from './hors-electron'
import * as knowledge from './knowledge'
import * as observatory from './observatory'
import * as reglagesEtDecor from './reglages-et-decor'
import * as settings from './settings'
import * as taskManager from './task-manager'
import * as tickets from './tickets'
import * as worktreesEtBureaux from './worktrees-et-bureaux'

/**
 * LES TABLES DE TEXTES DES ÉCRANS (traduction anglaise, conv-1170). Entrée qui doit faire échouer ce
 * fichier : une clé dont l'anglais est vide (l'écran retomberait en silence sur le français), un
 * anglais recopié du français sans raison déclarée, une `{valeur}` présente d'un seul côté (elle
 * s'afficherait brute, ou disparaîtrait), une raison d'identité devenue fausse, ou une table ajoutée
 * dans ce dossier sans être vérifiée ici.
 */
interface TableDEcran {
  readonly TEXTES_FR: Readonly<Record<string, string>>
  readonly TEXTES_EN: Readonly<Record<string, string>>
  /** Clé → raison pour laquelle l'anglais reste identique au français (tenue dans chaque table). */
  readonly IDENTIQUES_AU_FRANCAIS: Readonly<Record<string, string | undefined>>
}

const TABLES: Readonly<Record<string, TableDEcran>> = {
  'chat-fil': chatFil,
  'chat-execution': chatExecution,
  'chat-decisions': chatDecisions,
  'chat-panneaux': chatPanneaux,
  'artefacts-et-bandeaux': artefactsEtBandeaux,
  accueil,
  'agent-studio': agentStudio,
  knowledge,
  observatory,
  'task-manager': taskManager,
  'worktrees-et-bureaux': worktreesEtBureaux,
  tickets,
  'board-et-maintenance': boardEtMaintenance,
  'board-projets': boardProjets,
  settings,
  'chat-fils-et-lots': chatFilsEtLots,
  'reglages-et-decor': reglagesEtDecor,
  'hors-electron': horsElectron
}

const valeursDe = (texte: string): string[] =>
  [...new Set([...texte.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()

/** Les défauts d'une table, un par ligne lisible ; vide = table conforme. */
function defautsDeTable(table: TableDEcran): string[] {
  const defauts: string[] = []
  const { TEXTES_FR: fr, TEXTES_EN: en, IDENTIQUES_AU_FRANCAIS: identiques } = table
  for (const cle of Object.keys(en)) {
    if (!(cle in fr)) defauts.push(`${cle} : clé anglaise sans français`)
  }
  for (const [cle, francais] of Object.entries(fr)) {
    const anglais = en[cle]
    if (typeof anglais !== 'string' || anglais.trim() === '') {
      defauts.push(`${cle} : anglais vide ou absent`)
      continue
    }
    const raison = identiques[cle]
    if (anglais === francais && !raison?.trim()) {
      defauts.push(`${cle} : anglais identique au français, sans raison déclarée`)
    }
    if (anglais !== francais && raison !== undefined) {
      defauts.push(`${cle} : déclaré identique au français, mais l'anglais diffère`)
    }
    const deFr = valeursDe(francais).join(', ')
    const deEn = valeursDe(anglais).join(', ')
    if (deFr !== deEn) defauts.push(`${cle} : valeurs {${deFr}} en français, {${deEn}} en anglais`)
  }
  for (const cle of Object.keys(identiques)) {
    if (!(cle in fr))
      defauts.push(`${cle} : déclaré identique au français, mais la clé n'existe pas`)
  }
  return defauts
}

describe('tables de textes des écrans', () => {
  it('chaque table du dossier est vérifiée ici', () => {
    const fichiers = readdirSync(fileURLToPath(new URL('.', import.meta.url)))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => f.slice(0, -'.ts'.length))
      .sort()
    expect(fichiers).toEqual(Object.keys(TABLES).sort())
  })

  for (const [nom, table] of Object.entries(TABLES)) {
    it(`${nom} : anglais non vide, différent du français, mêmes {valeurs}`, () => {
      expect(defautsDeTable(table)).toEqual([])
    })
  }

  it('JUMEAU refusé : la vérification attrape chaque défaut d’une table fautive', () => {
    const fautive: TableDEcran = {
      TEXTES_FR: {
        vide: 'Bonjour',
        recopie: 'Agent Studio',
        valeur: '{n} fils',
        identiqueFaux: 'Titre',
        identiqueVoulu: 'Observatory'
      },
      TEXTES_EN: {
        vide: ' ',
        recopie: 'Agent Studio',
        valeur: '{count} threads',
        identiqueFaux: 'Title',
        identiqueVoulu: 'Observatory',
        orpheline: 'Orphan'
      },
      IDENTIQUES_AU_FRANCAIS: {
        identiqueFaux: 'nom propre',
        identiqueVoulu: 'nom de l’écran, gardé tel quel dans les deux langues',
        disparue: 'nom propre'
      }
    }
    expect(defautsDeTable(fautive)).toEqual([
      'orpheline : clé anglaise sans français',
      'vide : anglais vide ou absent',
      'recopie : anglais identique au français, sans raison déclarée',
      'valeur : valeurs {n} en français, {count} en anglais',
      "identiqueFaux : déclaré identique au français, mais l'anglais diffère",
      "disparue : déclaré identique au français, mais la clé n'existe pas"
    ])
  })
})
