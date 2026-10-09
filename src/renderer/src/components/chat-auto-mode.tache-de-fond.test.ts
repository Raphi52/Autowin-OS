import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto } from './chat-auto-mode'

const agent = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const base = { actif: true, occupe: false, dernierTourTraite: null, dernierPromptEnvoye: null, brouillonPresent: false }

// Réponse réelle de conv-42, tour 8268dddb-dfcc-4415-92d8-764b812603eb (aucune ligne AUTOWIN_PROMPT_V1).
const REPONSE_CONV42 = [
  "Je relance l'essai sur une copie du banc (`bench/risques-rejeu/`), pour ne pas écraser les preuves de la mesure publiée.",
  '',
  'Six essais tournent en parallèle, trois avec la règle et trois sans.',
  '',
  '⚠️ Tâche de fond pas terminée à la fin de ce tour : `Run the 6 bench replicas on reconstructed data`. Son résultat ne reviendra pas tout seul — relance la demande pour la refaire.'
].join('\n')

describe('mode auto — tour coupé pendant une tâche de fond (conv-42)', () => {
  it("s'arrête avec un message au lieu d'attendre en silence", () => {
    const d = deciderRelanceAuto({ ...base, fil: [agent(REPONSE_CONV42)] })
    expect(d).toMatchObject({ action: 'arreter', raison: 'tache-de-fond-coupee' })
    expect((d as { message?: string }).message).toMatch(/tâche de fond/)
  })
  it('jumeau : une suite proposée part quand même malgré l’avis', () => {
    const texte = REPONSE_CONV42 + '\nAUTOWIN_PROMPT_V1: relance les 6 essais du banc risques-rejeu au premier plan'
    expect(deciderRelanceAuto({ ...base, fil: [agent(texte)] })).toMatchObject({ action: 'envoyer' })
  })
  /*
   * conv-113, tour 27bdd9f2-d301-468f-9204-8b943e7e3c54 (fin réelle ci-dessous) : cette décision a
   * ÉTEINT ∞ à 20:18:54 (`desarmerAuto` au premier plan), mais disait « en pause ». Neuf minutes plus
   * tard, l'utilisateur a vu ∞ décoché et a conclu « ça a enchaîné alors qu'il était pas coché ».
   */
  it('dit que ∞ était allumé et vient de s’éteindre, pas « en pause »', () => {
    const finConv113 =
      'Les quatre contrôles avec le modèle tournent en arrière-plan.\n\n' +
      '⚠️ Tâche de fond pas terminée à la fin de ce tour : `Run the four model coverage checks sequentially`. ' +
      'Son résultat ne reviendra pas tout seul — relance la demande pour la refaire.'
    const d = deciderRelanceAuto({ ...base, fil: [agent(finConv113)] })
    expect(d).toMatchObject({ action: 'arreter', raison: 'tache-de-fond-coupee' })
    const message = (d as { message?: string }).message ?? ''
    expect(message).toContain('∞ était allumé sur ce fil et vient de s’éteindre')
    expect(message).not.toContain('en pause')
    })
  it('commande shell reprise par Autowin : PAS de pause — le tour de reprise arrive tout seul', () => {
    // Texte exact émis par providers/claude.ts quand le tour de chat relance la commande.
    const texte = [
      'Les tests tournent en fond.',
      '',
      '🔁 Tâche de fond reprise par Autowin hors de ce tour : `npx vitest run`. Son résultat reviendra dans ce fil, dans un tour de reprise automatique.'
    ].join('\n')
    expect(deciderRelanceAuto({ ...base, fil: [agent(texte)] })).toMatchObject({
      action: 'attendre',
      raison: 'aucun-prompt'
    })
  })
  it('sans avis ni suite : attente inchangée', () => {
    expect(deciderRelanceAuto({ ...base, fil: [agent('Je regarde.')] })).toMatchObject({ raison: 'aucun-prompt' })
  })
})
