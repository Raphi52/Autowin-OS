import { describe, expect, it } from 'vitest'
import { decideRemember } from './brain-remember'

/**
 * UN REFUS QUI NE DIT PAS CE QU'IL A REÇU SE REPRODUIT, et c'est mesuré : deux fois.
 *
 * Le 2026-08-20 (conv-1086) puis le 2026-08-26, `remember` a rendu « type invalide — attendu l'un
 * de : lesson, decision, preference, domain ». La première fois, l'agent avait passé `cause-racine`.
 * La seconde, personne ne sait — le message ne le dit pas.
 *
 * Deux manques, tous deux réparables sans toucher au contrat du Brain :
 *   - la valeur REÇUE n'apparaît jamais, alors qu'elle est la seule information dont le modèle a
 *     besoin pour se corriger du premier coup (et il LIT ce motif : il repart en résultat d'outil) ;
 *   - un champ ABSENT produit exactement le même libellé qu'un champ FAUX, parce que
 *     `text(undefined)` rend `''` qui tombe hors de l'énumération. Deux causes, un seul message.
 *
 * On ne touche PAS à `REMEMBER_TYPES` : le vocabulaire est un contrat externe, l'élargir déplacerait
 * le refus côté serveur au lieu de le supprimer. C'est le compte-rendu qu'on répare, pas la règle.
 */

/** Le motif d'un refus, ou l'echec du test si la decision a etonnamment ete acceptee. */
const motifDuRefus = (decision: ReturnType<typeof decideRemember>): string => {
  expect(decision.allowed).toBe(false)
  return decision.allowed ? '' : decision.reason
}

const FAIT = {
  title: 'Un titre retrouvable',
  fact: 'Un fait autoporté, compréhensible dans trois mois sans cette conversation.',
  scope: 'autowin-os',
  source: 'git:src/main/brain-remember.ts@9218eaf'
}

describe('le refus de `remember` dit ce qu’il a reçu', () => {
  it('NOMME la valeur inventée', () => {
    const decision = decideRemember({ ...FAIT, type: 'cause-racine' })

    expect(motifDuRefus(decision)).toContain('cause-racine')
  })

  it('distingue un champ ABSENT d’un champ FAUX', () => {
    const absent = decideRemember({ ...FAIT })
    const faux = decideRemember({ ...FAIT, type: 'cause-racine' })

    expect(motifDuRefus(absent)).not.toBe(motifDuRefus(faux))
    expect(motifDuRefus(absent)).toMatch(/manquant|absent/iu)
  })

  it('rappelle toujours les valeurs attendues', () => {
    for (const type of ['cause-racine', undefined]) {
      const decision = decideRemember({ ...FAIT, ...(type ? { type } : {}) })
      expect(motifDuRefus(decision)).toContain('lesson')
      expect(motifDuRefus(decision)).toContain('domain')
    }
  })

  it('accepte toujours les quatre valeurs légitimes', () => {
    // L'autre bord : un motif plus bavard ne doit pas resserrer ce qui passe.
    for (const type of ['lesson', 'decision', 'preference', 'domain']) {
      expect(decideRemember({ ...FAIT, type }).allowed).toBe(true)
    }
  })
})
