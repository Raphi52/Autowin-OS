import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lireMemoireScout, noterChoixScout, noterPistesScout } from '../../../main/scout-memoire'
import { parseScoutTable } from '../../../shared/scout-table'
import {
  candidatsDepuisScoutTable,
  redigerPromptWorkflowSelection
} from './veille-candidats-message'

/*
 * Piste 7 de conv-890 : les choix de pistes sont notés dans le processus principal en LISANT le
 * message que le panneau de sélection envoie (`noterChoixScout`). Le test de `scout-memoire` en
 * recopie le gabarit à la main : un changement du VRAI gabarit le laisserait vert, et les choix
 * cesseraient d'être notés sans bruit. Ici, la chaîne réelle du chat : tableau du scout → panneau
 * (`candidatsDepuisScoutTable`) → message envoyé (`redigerPromptWorkflowSelection`) → choix notés.
 */
const SORTIE_SCOUT = [
  '| # | Score | Type | What | Why | How |',
  '|---|---|---|---|---|---|',
  '| 1 | 82 | 🔧 fix | **Le cache du prompt est réécrit à chaque tour** | conv-616 | `orchestrator.ts:1290` |',
  '| 2 | 64 | ✨ new | Tri des conversations par dernière activité | conv-624 | `conversations.ts:40` |',
  '| 3 | 41 | 🔧 fix | Préfixe du juge recopié deux fois | conv-616 | `judge.ts:12` |'
].join('\n')

describe('le message du panneau de sélection est bien celui que lit l’enregistrement des choix', () => {
  const chemin = (): string =>
    join(mkdtempSync(join(tmpdir(), 'autowin-choix-panneau-')), 'scout-pistes.json')

  const choixApres = (indices: number[]): Array<string | undefined> => {
    const fichier = chemin()
    noterPistesScout({
      depot: 'D:/AutoWinOS',
      texte: SORTIE_SCOUT,
      run: 'run-scout',
      maintenant: '2026-10-01T09:00:00Z',
      chemin: fichier
    })
    const candidats = candidatsDepuisScoutTable(parseScoutTable(SORTIE_SCOUT)!)
    noterChoixScout({
      depot: 'D:/AutoWinOS',
      demande: redigerPromptWorkflowSelection(indices.map((i) => candidats[i]!)),
      maintenant: '2026-10-01T09:05:00Z',
      chemin: fichier
    })
    return lireMemoireScout(fichier).entrees.map((entree) => entree.choix)
  }

  it('plusieurs pistes cochées : prises et laissées notées sur ce scout', () => {
    expect(choixApres([0, 2])).toEqual(['prise', 'laissee', 'prise'])
  })

  it('une seule piste cochée : la variante « Traite ce candidat » est lue aussi', () => {
    expect(choixApres([1])).toEqual(['laissee', 'prise', 'laissee'])
  })
})
