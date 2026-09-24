import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import {
  DELAI_SONDAGE_DIFFERE,
  MAX_RELANCES_DIFFEREES,
  deciderRelanceAuto,
  echeanceSuiteDifferee,
  suiteEstDifferee
} from './chat-auto-mode'

const agent = (t: string): Msg =>
  ({ role: 'assistant', content: t, parts: [{ kind: 'text', text: t }] }) as unknown as Msg
const humain = (t: string): Msg => ({ role: 'user', content: t }) as Msg
const base = { actif: true, occupe: false, dernierTourTraite: null, dernierPromptEnvoye: null, brouillonPresent: false }

/*
 * conv-767, 2026-09-21 de 20:59 à 21:04 : un tournoi programmé pour 01:05. La suite ci-dessous est
 * partie TROIS fois, chaque fois pour constater que rien n'avait démarré. L'échéance vivait dans
 * « 👉 Recommandé », pas dans le prompt.
 */
const PROMPT_T2C =
  'Relis debut.txt, statut.txt et fin.txt de essais/t2c-2026-09-22 : si les 4 bras ont fini sans « session limit », note-les avec check.mjs et compare A et X dans le RUN.md'
const RECO_T2C = 'Demain matin, relire `debut.txt`, `statut.txt` et `fin.txt` de t2c, puis noter les 4 bras.'
const PROMPT_T2B =
  'Quand essais/t2b-2026-09-21/fin.txt existe, vérifie que les out-*.json ne sont pas vides, note les 12 bras avec check.mjs et complète le RUN.md de t2b'

describe('suite qui ne peut avancer qu’à un moment donné (conv-767)', () => {
  it('reconnaît les suites vécues', () => {
    expect(suiteEstDifferee(PROMPT_T2C, RECO_T2C)).toBe(true)
    expect(suiteEstDifferee(PROMPT_T2B, null)).toBe(true)
    expect(suiteEstDifferee('Après 1h, relance t2b avec 4 bras', null)).toBe(true)
    expect(suiteEstDifferee('Relance le tournoi à 01:05', null)).toBe(true)
    expect(suiteEstDifferee('Relis le statut', 'Relancer cette même demande dans quelques heures.')).toBe(true)
  })
  it('laisse passer une suite d’action immédiate', () => {
    expect(suiteEstDifferee('Relis l’état des 4 bras de essais/t2v-2026-09-21', 'Relire l’état des 4 bras.')).toBe(false)
    expect(suiteEstDifferee('Après le build, lance clean sur src/main', null)).toBe(false)
    expect(suiteEstDifferee('Quand le test passe, lance le judge', null)).toBe(false)
    expect(suiteEstDifferee('Note les 12 bras avec check.mjs', 'Noter les 12 bras.')).toBe(false)
  })
  const filT2C = [
    humain('go'),
    agent(`✅ Fait
- relu
📍 Maintenant
- attente
⏳ Reste à faire
- noter t2c
👉 Recommandé
- ${RECO_T2C}

AUTOWIN_PROMPT_V1: ${PROMPT_T2C}`)
  ]
  // conv-826 : « faudrait que le mode auto gère ce cas au lieu de s'arrêter ».
  it('ne l’envoie pas maintenant : la PROGRAMME pour le moment venu', () => {
    const maintenant = new Date(2026, 8, 24, 11, 10).getTime()
    const d = deciderRelanceAuto({ ...base, fil: filT2C, maintenant })
    expect(d).toMatchObject({ action: 'programmer' })
    if (d.action !== 'programmer') return
    expect(d.texte).toContain(PROMPT_T2C)
    // « Demain matin » → demain 8 h.
    expect(d.echeance).toBe(new Date(2026, 8, 25, 8, 0).getTime())
  })
  it('une suite « quand X existe » est reprogrammée même identique, puis s’arrête après la borne', () => {
    const fil = [humain('go'), agent(`✅ Fait

AUTOWIN_PROMPT_V1: ${PROMPT_T2B}`)]
    const maintenant = 1_000_000
    const d = deciderRelanceAuto({ ...base, fil, maintenant, dernierPromptEnvoye: PROMPT_T2B })
    expect(d).toMatchObject({ action: 'programmer', echeance: maintenant + DELAI_SONDAGE_DIFFERE })
    const fin = deciderRelanceAuto({ ...base, fil, relancesDifferees: MAX_RELANCES_DIFFEREES })
    expect(fin).toMatchObject({ action: 'arreter', raison: 'suite-differee' })
    if (fin.action === 'arreter') expect(fin.message).toMatch(/moment venu/)
  })
  it('lit l’heure, la durée, « ce soir »', () => {
    const t = new Date(2026, 8, 24, 11, 10).getTime()
    expect(echeanceSuiteDifferee('Relance le tournoi à 01:05', null, t)).toBe(new Date(2026, 8, 25, 1, 5).getTime())
    expect(echeanceSuiteDifferee('Relance vers 14h30', null, t)).toBe(new Date(2026, 8, 24, 14, 30).getTime())
    expect(echeanceSuiteDifferee('Après 1h, relance t2b avec 4 bras', null, t)).toBe(t + 3_600_000)
    expect(echeanceSuiteDifferee('Relis dans 20 min', null, t)).toBe(t + 20 * 60_000)
    expect(echeanceSuiteDifferee('Relis le statut', 'Relancer dans quelques heures.', t)).toBe(t + 2 * 3_600_000)
    expect(echeanceSuiteDifferee('Relis ce soir', null, t)).toBe(new Date(2026, 8, 24, 19, 0).getTime())
  })
})
