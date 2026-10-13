import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendTurnEvent, flushAllTurnJournals, resumerGestesDesTours } from './turn-journal'

/**
 * Le fil des demandes affiche les gestes propres de l'agent sur CHAQUE ligne : l'app les résume pour
 * toute la conversation en un appel, et ne relit que les journaux qui ont changé.
 */
let root = mkdtempSync(join(tmpdir(), 'turnjournal-gestes-'))
afterEach(() => {
  flushAllTurnJournals()
  rmSync(root, { recursive: true, force: true })
  root = mkdtempSync(join(tmpdir(), 'turnjournal-gestes-'))
})

const ligne = (kind: string, text: string): string => JSON.stringify({ kind, text })

function journal(conversationId: string, turnId: string, lignes: string[]): string {
  const dossier = join(root, conversationId)
  mkdirSync(dossier, { recursive: true })
  const chemin = join(dossier, `${turnId}.jsonl`)
  writeFileSync(chemin, `${lignes.join('\n')}\n`)
  return chemin
}

describe('resumerGestesDesTours', () => {
  it('compte les gestes finis de chaque demande, sans débuts, pensée ni commandes d’Autowin', async () => {
    journal('conv-a', 'turn-1', [
      ligne('provider-status', 'Read · D:\\depot\\x.ts'),
      ligne('provider-status', 'Read terminé - 3 s'),
      ligne('provider-status', 'Read terminé - 0,5 s'),
      ligne('provider-status', 'Bash échoué - 12 s'),
      ligne('provider-status', 'mcp__autowin__verify terminé - 5 s'),
      ligne('reasoning-step', 'Edit terminé - 9 s'),
      '{"kind":"provider-status","text":"Edit ter', // ligne tronquée par un crash
      ligne('provider-status', 'Edit terminé - 1 s')
    ])
    journal('conv-a', 'turn-2', [ligne('delta', 'rien que du texte')])

    expect(await resumerGestesDesTours(root, 'conv-a')).toEqual({
      'turn-1': {
        Read: { nombre: 2, echecs: 0, dureeMs: 3500 },
        Bash: { nombre: 1, echecs: 1, dureeMs: 12000 },
        Edit: { nombre: 1, echecs: 0, dureeMs: 1000 }
      }
    })
  })

  it('ne relit pas un journal inchangé, relit celui qui a bougé', async () => {
    const chemin = journal('conv-b', 'turn-1', [ligne('provider-status', 'Read terminé - 1 s')])
    const avant = new Date('2026-10-12T08:00:00.000Z')
    utimesSync(chemin, avant, avant)
    expect((await resumerGestesDesTours(root, 'conv-b'))['turn-1'].Read.nombre).toBe(1)

    // Même date et même taille : le cache répond, même si le contenu a été remplacé en douce.
    writeFileSync(chemin, `${ligne('provider-status', 'Grep terminé - 1 s')}\n`)
    utimesSync(chemin, avant, avant)
    expect(Object.keys((await resumerGestesDesTours(root, 'conv-b'))['turn-1'])).toEqual(['Read'])

    // Le fichier a grossi : il est relu.
    journal('conv-b', 'turn-1', [
      ligne('provider-status', 'Read terminé - 1 s'),
      ligne('provider-status', 'Write terminé - 2 s')
    ])
    expect((await resumerGestesDesTours(root, 'conv-b'))['turn-1']).toEqual({
      Read: { nombre: 1, echecs: 0, dureeMs: 1000 },
      Write: { nombre: 1, echecs: 0, dureeMs: 2000 }
    })
  })

  it('compte la demande en cours, dont les lignes sont encore en mémoire', async () => {
    appendTurnEvent(root, 'conv-c', 'turn-vivant', {
      kind: 'provider-status',
      text: 'Bash terminé - 4 s'
    })
    appendTurnEvent(root, 'conv-c', 'turn-vivant', {
      kind: 'provider-status',
      text: 'Read terminé - 1 s'
    })

    expect(await resumerGestesDesTours(root, 'conv-c')).toEqual({
      'turn-vivant': {
        Bash: { nombre: 1, echecs: 0, dureeMs: 4000 },
        Read: { nombre: 1, echecs: 0, dureeMs: 1000 }
      }
    })
  })

  it('une conversation sans journal rend un résumé vide, pas une erreur', async () => {
    expect(await resumerGestesDesTours(root, 'conv-inconnue')).toEqual({})
  })
})
