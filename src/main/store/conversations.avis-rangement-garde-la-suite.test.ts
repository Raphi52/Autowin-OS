import { describe, expect, it } from 'vitest'
import { ConversationStore, type Msg as StoredMsg } from './conversations'
import {
  deciderRelanceAuto,
  texteDernierAssistant
} from '../../renderer/src/components/chat-auto-mode'
import { hydrateStoredAssistant } from '../../renderer/src/components/chat-view-model'
import type { Msg } from '../../renderer/src/components/chat-view-types'

/**
 * DEFAUT MESURE — conv-23, tour 2fefb532-3b2c-489c-9bc4-ef90c6ee4eba (2026-09-27).
 *
 * La reponse du tour se terminait par
 * `AUTOWIN_PROMPT_V1: Crée la démo pour les architectes…`. 143 ms apres la fin du tour
 * (13:24:01.237 -> 13:24:01.380), le rangement differe a ecrit son avis « 📂 Ta demande parle
 * de… » via `append(…, { avantLaReponseEnCours: true })`. La reponse n'etait plus un brouillon
 * vierge : l'option n'a rien fait et l'avis est parti EN FIN de fil. Le champ pre-rempli
 * (`ghostDuFil`) et le mode auto (`texteDernierAssistant`) lisent tous deux le DERNIER message de
 * l'agent : ils ont lu l'avis, sans suite. Plus de « préprompt », chaine arretee sans un mot jusqu'a
 * la saisie ts 1790525003939 (« /kaizen le mode auto enchaine mal et j'ai pas de préprompt »).
 */
const TURN_ID = '2fefb532-3b2c-489c-9bc4-ef90c6ee4eba'
const SUITE =
  "Crée la démo pour les architectes (mise en forme des comptes-rendus de chantier et relance des points en attente) sur le modèle de demo-qualification-annonces.html, ajoute-la à la fiche d'appel et vérifie-la avec verifier-kit.js dans le bureau caché, sans rien envoyer."
const FIN_DE_REPONSE_REELLE = [
  '✅ Fait',
  '- `demo-qualification-annonces.html` créée ; fiche d’appel et `verifier-kit.js` complétés.',
  '',
  '👉 Recommandé',
  '- Faire sur le même modèle la démo des architectes, le plus gros groupe qui n’en a pas encore.',
  '',
  `AUTOWIN_PROMPT_V1: ${SUITE}`,
  '',
  '⚠️ Tâche de fond pas terminée à la fin de ce tour : `Search traces for the earlier checker launch`.'
].join('\n')
const AVIS_REEL =
  "📂 Ta demande parle de D:\\Offre-Automatisation-IA, et cette conversation n'était pas encore rangée : " +
  'cette première réponse a travaillé dans D:\\Autowin. Je la range dans D:\\Offre-Automatisation-IA pour la suite.'

/** Ce que l'ecran recoit : les messages du store, l'agent hydrate comme au rechargement. */
function filAffiche(messages: StoredMsg[]): Msg[] {
  return messages.map((m) =>
    m.role === 'user'
      ? ({ role: 'user', content: m.content } as Msg)
      : (hydrateStoredAssistant({
          content: m.content,
          turnId: m.turnId,
          parts: m.parts as never,
          status: m.status
        }) as Msg)
  )
}

function tourTermine(): { store: ConversationStore; id: string } {
  const store = new ConversationStore(() => 1000)
  const { id } = store.create({ title: 'conv-23', provider: 'claude' })
  store.beginTurn(
    id,
    { content: 'Crée une démo pour les agences immobilières…' },
    { turnId: TURN_ID }
  )
  store.applyTurnEvent(id, TURN_ID, { kind: 'delta', streamId: '0:0', text: FIN_DE_REPONSE_REELLE })
  store.applyTurnEvent(id, TURN_ID, { kind: 'done' })
  return { store, id }
}

describe('avis de rangement ecrit APRES la fin du tour (conv-23)', () => {
  it('passe au-dessus de la reponse : le dernier message reste la reponse et sa suite', () => {
    const { store, id } = tourTermine()
    const apres = store.append(id, {
      role: 'assistant',
      content: AVIS_REEL,
      avantLaReponseEnCours: true,
      auDessusDeLaReponseDuTour: true
    })
    expect(apres.messages.map((m) => m.turnId ?? m.content.slice(0, 2))).toEqual([
      'Cr',
      '📂',
      TURN_ID
    ])
  })

  it('le mode auto relit toujours la suite proposee par le tour', () => {
    const { store, id } = tourTermine()
    store.append(id, {
      role: 'assistant',
      content: AVIS_REEL,
      avantLaReponseEnCours: true,
      auDessusDeLaReponseDuTour: true
    })
    const fil = filAffiche(store.get(id)!.messages)
    expect(texteDernierAssistant(fil)).toContain(`AUTOWIN_PROMPT_V1: ${SUITE}`)
    const decision = deciderRelanceAuto({
      actif: true,
      occupe: false,
      fil,
      dernierTourTraite: null,
      dernierPromptEnvoye: null,
      brouillonPresent: false,
      depotPresent: false
    })
    expect(decision).toMatchObject({ action: 'envoyer' })
    expect(decision.action === 'envoyer' && decision.texte.startsWith(SUITE)).toBe(true)
  })

  it('pendant le tour, un brouillon DEJA ecrit garde aussi sa place sous l avis', () => {
    const store = new ConversationStore(() => 1000)
    const { id } = store.create({ title: 't', provider: 'claude' })
    store.beginTurn(id, { content: 'premier message' }, { turnId: 't1' })
    store.applyTurnEvent(id, 't1', { kind: 'delta', streamId: '0:0', text: 'Je lis…' })
    const apres = store.append(id, {
      role: 'assistant',
      content: '📂 rangée',
      avantLaReponseEnCours: true,
      auDessusDeLaReponseDuTour: true
    })
    expect(apres.messages.at(-1)).toMatchObject({ turnId: 't1', status: 'streaming' })
    expect(apres.messages.at(-2)?.content).toBe('📂 rangée')
  })

  it('une consigne de l utilisateur garde la regle conv-544 : sous un brouillon deja lu', () => {
    const store = new ConversationStore(() => 1000)
    const { id } = store.create({ title: 't', provider: 'claude' })
    store.beginTurn(id, { content: 'premier message' }, { turnId: 't1' })
    store.applyTurnEvent(id, 't1', { kind: 'delta', streamId: '0:0', text: 'Je lis…' })
    const apres = store.append(id, {
      role: 'user',
      content: 'et aussi X',
      orientation: true,
      avantLaReponseEnCours: true
    })
    expect(apres.messages.at(-1)).toMatchObject({ role: 'user', content: 'et aussi X' })
  })

  it('sans reponse de tour en fin de fil, l avis s ajoute simplement a la fin', () => {
    const store = new ConversationStore(() => 1000)
    const { id } = store.create({ title: 't', provider: 'claude' })
    store.append(id, { role: 'user', content: 'bonjour' })
    const apres = store.append(id, {
      role: 'assistant',
      content: '📂 rangée',
      auDessusDeLaReponseDuTour: true
    })
    expect(apres.messages.map((m) => m.content)).toEqual(['bonjour', '📂 rangée'])
  })
})
