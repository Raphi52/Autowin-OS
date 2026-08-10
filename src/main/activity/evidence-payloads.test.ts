import { describe, expect, it } from 'vitest'
import { evidencePayloads } from './evidence-payloads'

/**
 * MANQUE CONSTATE LE 2026-08-07 : la trace causale d'une action de sous-agent ne portait que
 * `item.summary || item.type` (`orchestration-observability.ts`, l. ~210) alors que le CHAT affiche
 * la commande, le code de sortie, la sortie brute et le diff complets (`ChatView.parts.tsx:149-192`).
 *
 * Deux consequences, la seconde plus grave que la premiere :
 *  1. Observatory montrait une version appauvrie de ce que l'utilisateur avait deja sous les yeux —
 *     inutilisable pour comprendre ce qu'une action a REELLEMENT fait.
 *  2. L'evenement se declarait `fidelity: 'exact'` en ne transportant qu'un resume : un libelle
 *     MENTEUR. Une trace qui affirme l'exactitude tout en tronquant est pire qu'une trace absente,
 *     parce qu'on la croit.
 *
 * Ce module construit les charges a partir de la preuve reelle. La fidelite `exact` n'est declaree
 * que lorsque le contenu integral est effectivement transporte.
 */

describe('evidencePayloads', () => {
  it('transporte la COMMANDE et le code de sortie, pas seulement le resume', () => {
    const { payloads } = evidencePayloads({
      type: 'command_execution',
      summary: 'npm test',
      command: 'npm test -- --run',
      exitCode: 1,
      stdout: 'FAIL 3 tests',
      ok: false
    })
    const joined = payloads.map((p) => p.content).join('\n')
    expect(joined).toContain('npm test -- --run')
    expect(joined).toContain('1')
    expect(joined).toContain('FAIL 3 tests')
  })

  it('transporte le DIFF integral d’un changement de fichier', () => {
    const diff = '--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-avant\n+apres'
    const { payloads } = evidencePayloads({
      type: 'file_change',
      summary: 'x.ts modifié',
      diff,
      ok: true
    })
    expect(payloads.some((p) => p.content.includes('+apres'))).toBe(true)
  })

  it('declare `exact` quand le contenu integral est transporte', () => {
    const { fidelity } = evidencePayloads({
      type: 'command_execution',
      summary: 'ls',
      command: 'ls',
      stdout: 'a\nb',
      exitCode: 0,
      ok: true
    })
    expect(fidelity).toBe('exact')
  })

  it('ne declare PAS `exact` quand seul un resume existe — le libelle doit cesser de mentir', () => {
    // Cas central : c'est exactement l'etat de TOUTES les traces avant ce correctif.
    const { fidelity, payloads } = evidencePayloads({
      type: 'command_execution',
      summary: 'quelque chose s’est passé',
      ok: true
    })
    expect(fidelity).toBe('derived')
    expect(payloads[0].content).toContain('quelque chose')
  })

  it('separe l’APPEL du RESULTAT en deux charges distinctes', () => {
    const { payloads } = evidencePayloads({
      type: 'command_execution',
      summary: 'npm test',
      command: 'npm test',
      stdout: 'ok',
      exitCode: 0,
      ok: true
    })
    expect(payloads.map((p) => p.kind)).toContain('tool-call')
    expect(payloads.map((p) => p.kind)).toContain('tool-result')
  })

  it('marque la charge de resultat en `error` quand l’action a echoue', () => {
    const { payloads } = evidencePayloads({
      type: 'command_execution',
      summary: 'npm test',
      command: 'npm test',
      stdout: 'boom',
      exitCode: 2,
      ok: false
    })
    expect(payloads.some((p) => p.kind === 'error')).toBe(true)
  })

  it('survit a une preuve VIDE sans jeter — une trace ne casse jamais un tour', () => {
    const { payloads, fidelity } = evidencePayloads({ type: 'inconnu', summary: '', ok: true })
    expect(payloads).toHaveLength(1)
    expect(payloads[0].content.length).toBeGreaterThan(0)
    expect(fidelity).not.toBe('exact')
  })

  it('borne une sortie enorme et le DIT dans la charge plutot que de la couper en silence', () => {
    const enorme = 'x'.repeat(500_000)
    const { payloads, fidelity } = evidencePayloads({
      type: 'command_execution',
      summary: 'gros',
      command: 'gen',
      stdout: enorme,
      exitCode: 0,
      ok: true
    })
    const joined = payloads.map((p) => p.content).join('\n')
    expect(joined.length).toBeLessThan(enorme.length)
    // Une troncature SILENCIEUSE se lirait comme un contenu complet — donc on l'annonce, et la
    // fidelite cesse d'etre `exact`.
    expect(joined).toMatch(/tronqu/i)
    expect(fidelity).toBe('derived')
  })
})
