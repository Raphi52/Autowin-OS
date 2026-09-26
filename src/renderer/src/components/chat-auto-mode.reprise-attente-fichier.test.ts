import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import {
  DUREE_MAX_SONDAGE_FICHIER,
  attenteFichierAReprendre,
  premierPassageLaisseSortirLeTour
} from './chat-auto-mode'

/*
 * conv-826, 2026-09-26 : la suite « Quand …/nuit-2026-09-26-iso/fin.txt existe, compare… » attendait
 * son fichier, ∞ allumé. L'app a redémarré à 10:48 (puis 10:59, 11:10, 11:35, 13:38, 14:13) : la
 * surveillance vivait dans un minuteur de l'écran, perdu au redémarrage, et le premier passage
 * marquait le dernier tour « déjà traité ». fin.txt est apparu à 12:38:36, rien n'est parti jusqu'à
 * 15:57 — ∞ affiché allumé. Demande de l'utilisateur : « après un redémarrage, ∞ reprend tout seul
 * l'attente d'un fichier encore attendu ».
 */
const H = 3_600_000
const maintenant = new Date(2026, 8, 26, 15, 57).getTime()
const agent = (t: string): Msg =>
  ({ role: 'assistant', content: t, parts: [{ kind: 'text', text: t }] }) as unknown as Msg
const humain = (t: string, ts?: number): Msg =>
  ({ role: 'user', content: t, ...(ts ? { ts } : {}) }) as Msg
const cloture = (prompt: string): string => `✅ Fait
- nuit lancée
📍 Maintenant
- m1 tourne
⏳ Reste à faire
- comparer à la fin
👉 Recommandé
- Laisser ∞ allumé : la comparaison partira seule à la fin.

AUTOWIN_PROMPT_V1: ${prompt}`
const ATTENTE =
  'Quand D:/AutoWinOS/.arena/arenagame/essais/nuit-2026-09-26-iso/fin.txt existe, compare notes et coûts réels de la nuit à bras isolés à ceux de la nuit du 26'
const base = { actif: true, occupe: false, brouillonPresent: false, maintenant }
const fil = (prompt: string, ts?: number): Msg[] => [
  humain('Lance la nuit', ts),
  agent(cloture(prompt))
]

describe('reprise d’une attente de fichier au premier passage (conv-826)', () => {
  it('la suite vécue est reprise : une attente de fichier, avec son chemin', () => {
    const d = attenteFichierAReprendre({ ...base, fil: fil(ATTENTE, maintenant - 6 * H) })
    expect(d).toMatchObject({ action: 'programmer', fichier: expect.stringContaining('fin.txt') })
  })
  it('une suite à envoyer TOUT DE SUITE n’est pas reprise : elle paierait un tour que personne n’a demandé', () => {
    expect(
      attenteFichierAReprendre({ ...base, fil: fil('Relis le statut de la nuit', maintenant - H) })
    ).toBeNull()
  })
  it('une suite différée SANS fichier (« demain matin ») n’est pas reprise : son échéance repaierait un tour', () => {
    expect(
      attenteFichierAReprendre({
        ...base,
        fil: fil('Demain matin, relis le statut de la nuit', maintenant - H)
      })
    ).toBeNull()
  })
  it('un tour plus vieux que la borne de sondage (48 h) n’est pas repris', () => {
    const vieux = maintenant - DUREE_MAX_SONDAGE_FICHIER - H
    expect(attenteFichierAReprendre({ ...base, fil: fil(ATTENTE, vieux) })).toBeNull()
  })
  it('âge du tour inconnu (aucune heure de saisie) : pas repris, faute de pouvoir le borner', () => {
    expect(attenteFichierAReprendre({ ...base, fil: fil(ATTENTE) })).toBeNull()
  })
  it('un message de l’utilisateur après la suite l’annule : rien à reprendre', () => {
    const f = [...fil(ATTENTE, maintenant - H), humain('autre chose', maintenant - 10_000)]
    expect(attenteFichierAReprendre({ ...base, fil: f })).toBeNull()
  })
  it('le premier passage laisse sortir le tour quand une attente de fichier est à reprendre', () => {
    expect(
      premierPassageLaisseSortirLeTour({
        allumageManuel: false,
        repriseApresRedemarrage: false,
        attenteFichier: true
      })
    ).toBe(true)
    expect(
      premierPassageLaisseSortirLeTour({
        allumageManuel: false,
        repriseApresRedemarrage: false,
        attenteFichier: false
      })
    ).toBe(false)
  })
})
