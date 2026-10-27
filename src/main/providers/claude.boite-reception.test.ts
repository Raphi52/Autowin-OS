import { describe, expect, it } from 'vitest'
import { reglagesCliAutowin } from './claude'

/**
 * BOÎTE DE RÉCEPTION NATIVE DES AGENTS (conv-1139, 2026-10-24).
 *
 * MESURÉ sur le CLI 2.1.309 (banc D:/tmp/sonde-boite/experience.sh) : sans réglage, un agent lancé
 * comme un agent de run Autowin (`-p`, `bypassPermissions`, `--setting-sources ''`) a REÇU le
 * message d'une autre session du poste qui contourne aussi les permissions, et l'a recopié. La
 * sortie enregistrée n'en gardait qu'une trace vide : un canal invisible pour Autowin.
 *
 * Le CLI ne montre rien d'un refus dans le statut de la session (documentation), donc ce test ne
 * peut lire que le réglage passé ; la preuve de comportement est le banc rejoué avec ces réglages.
 */
describe('boîte de réception native des agents', () => {
  it('les réglages passés au CLI refusent les messages des autres sessions', () => {
    expect(reglagesCliAutowin('garde.mjs').crossSessionInbound).toBe('refuse')
  })

  it('le refus tient aussi quand le garde npm est branché', () => {
    expect(reglagesCliAutowin('garde.mjs', 'garde-npm.mjs').crossSessionInbound).toBe('refuse')
  })
})
