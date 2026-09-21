import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto, suiteEstDifferee } from './chat-auto-mode'

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
  it('ne l’envoie pas : met en pause AVEC un message visible', () => {
    const fil = [
      humain('go'),
      agent(`✅ Fait\n- relu\n📍 Maintenant\n- attente\n⏳ Reste à faire\n- noter t2c\n👉 Recommandé\n- ${RECO_T2C}\n\nAUTOWIN_PROMPT_V1: ${PROMPT_T2C}`)
    ]
    const d = deciderRelanceAuto({ ...base, fil })
    expect(d).toMatchObject({ action: 'arreter', raison: 'suite-differee' })
    if (d.action === 'arreter') expect(d.message).toMatch(/moment venu/)
  })
})
