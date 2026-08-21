import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  lireMorsures,
  expliquerDebranchement,
  gardesAttendus,
  gardesDebranches,
  gatesSansScriptConnu
} from './cablage-garde'

/**
 * LE SYMPTOME, mesure le 2026-08-21 : quatre garde-fous du kit totalisant 480 morsures avaient
 * disparu de `~/.claude/settings.json` alors que leurs scripts etaient toujours sur le disque.
 * Personne ne l'a vu pendant une semaine, et l'agent a continue d'invoquer leur autorite.
 *
 * Ce fichier tient en DEUX parties, et la separation est deliberee :
 *  - la LOGIQUE, testee sur des donnees fabriquees : elle rend le meme verdict sur n'importe quelle
 *    machine, y compris une ou le kit n'existe pas. C'est elle qui porte les assertions dures.
 *  - le CABLAGE REEL de cette machine, verifie seulement s'il est la. Un poste sans kit ne doit pas
 *    faire echouer la suite du produit — mais l'inapplicabilite est DITE, jamais silencieuse : un
 *    test qui passe sans rien verifier est exactement la maladie qu'on soigne ici.
 */
describe('garde du cablage — logique pure', () => {
  /**
   * Fixture au format REELLEMENT ecrit sur disque, et non au format qu'on aurait aime.
   *
   * Le champ est `blocked`, pas `outcome` ; la premiere ligne porte un BOM ; il traine une ligne
   * illisible et une ligne vide. Chacun de ces details vient de la mesure du fichier reel — un
   * fixture propre aurait passe avec un lecteur strict, c'est-a-dire avec le lecteur qui rend
   * ZERO evenement sur les 522 lignes reelles. Le fixture doit ressembler au terrain, sinon il
   * garde une version idealisee du monde.
   */
  const telemetrie = [
    '﻿{"ts":"2026-06-10T10:30:01+02:00","gate":"stop","blocked":1}',
    '{"gate":"stop","blocked":1}',
    '{"gate":"anti-flaky","blocked":1}',
    '{"gate":"revert","blocked":0}',
    'ligne illisible qui ne doit pas faire tomber le lecteur',
    ''
  ].join('\n')

  it('attend les gates qui ont deja mordu, classes par nombre de morsures', () => {
    const attendus = gardesAttendus(lireMorsures(telemetrie))
    expect(attendus.map((g) => g.gate)).toEqual(['stop', 'anti-flaky', 'revert'])
    expect(attendus[0]).toMatchObject({ script: 'stop-gate.ps1', morsures: 2 })
  })

  it('signale un cablage incomplet, et NOMME ce qui manque', () => {
    const cablage = '{ "hooks": { "Stop": "kaizen-revert-log.ps1" } }'
    const manquants = gardesDebranches(cablage, lireMorsures(telemetrie))
    expect(manquants.map((g) => g.script)).toEqual(['stop-gate.ps1', 'anti-flaky.ps1'])
    const message = expliquerDebranchement(manquants)
    expect(message).toContain('stop-gate.ps1')
    expect(message).toContain('2 morsure(s)')
  })

  it('ne signale RIEN quand tout est cable — le contre-controle qui rend le test discriminant', () => {
    const cablage = 'stop-gate.ps1 anti-flaky.ps1 kaizen-revert-log.ps1'
    expect(gardesDebranches(cablage, lireMorsures(telemetrie))).toEqual([])
    expect(expliquerDebranchement([])).toBe('')
  })

  it('un gate inconnu de la table n est pas transforme en faux echec', () => {
    const evenements = lireMorsures('{"gate":"gate-inedit","blocked":1}')
    // Il ne devient PAS une exigence : on ne sait pas quel script le produit.
    expect(gardesDebranches('', evenements)).toEqual([])
    // Mais il reste VISIBLE, pour qu'on l'ajoute a la table plutot que de l'ignorer.
    expect(gatesSansScriptConnu(evenements)).toEqual(['gate-inedit'])
  })
})

describe('garde du cablage — cette machine', () => {
  const kit = join(homedir(), '.claude')
  const cablagePath = join(kit, 'settings.json')
  const telemetriePath = join(kit, 'gate-counters.jsonl')

  it('tout garde-fou qui a deja mordu est encore declare', () => {
    if (!existsSync(cablagePath) || !existsSync(telemetriePath)) {
      // DIT, pas tu : sans kit ni telemetrie il n'y a rien a exiger, et le pretendre serait
      // fabriquer une exigence sur du vide.
      console.log(
        `[garde-cablage] inapplicable ici : ${!existsSync(cablagePath) ? 'settings.json' : 'gate-counters.jsonl'} absent sous ${kit}`
      )
      return
    }
    const cablage = readFileSync(cablagePath, 'utf8')
    const evenements = lireMorsures(readFileSync(telemetriePath, 'utf8'))
    const attendus = gardesAttendus(evenements)
    const manquants = gardesDebranches(cablage, evenements)

    console.log(
      `[garde-cablage] ${attendus.length} garde-fou(x) ayant deja mordu, ${manquants.length} debranche(s)`
    )
    const inconnus = gatesSansScriptConnu(evenements)
    if (inconnus.length > 0) {
      // Non bloquant, mais visible : un gate qui mord sans etre dans la table echappe au garde.
      console.log(`[garde-cablage] gates sans script connu : ${inconnus.join(', ')}`)
    }

    expect(expliquerDebranchement(manquants)).toBe('')
  })
})
