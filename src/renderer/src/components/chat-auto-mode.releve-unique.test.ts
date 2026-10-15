import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import {
  PROMPT_NOUVELLE_CIBLE,
  ancrerSurLaDemande,
  deciderRelanceAuto,
  relevesDepuisHumain,
  type EntreeDecisionAuto
} from './chat-auto-mode'

/*
 * LA RELÈVE PART UNE FOIS PAR SÉRIE AUTOMATIQUE. Défaut : le seul frein comparait la relève au
 * DERNIER message envoyé. Depuis 4399faa7 (21/09), la réponse automatique à la question `ask`
 * s'intercale entre deux relèves : relève → ask → réponse auto → travail → « rien » → relève…
 * Seul le plafond de tours d'affilée (6 par défaut, réglable jusqu'à 1000) l'arrêtait.
 */
const agent = (t: string): Msg =>
  ({ role: 'assistant', content: t, parts: [{ kind: 'text', text: t }] }) as unknown as Msg
const humain = (t: string): Msg => ({ role: 'user', content: t }) as Msg
const askMsg = (options: string[]): Msg =>
  ({
    role: 'assistant',
    content: 'Quelle cible ?',
    parts: [
      { kind: 'text', text: 'Voici des cibles.' },
      { kind: 'action', name: 'ask', ok: true, data: { question: 'Quelle cible ?', options } }
    ]
  }) as unknown as Msg

const DEMANDE = 'Répare le module de paiement'
const RIEN = '✅ Fait\n1. Module réparé, test vert.\n\n👉 Recommandé — rien'
const base: Omit<EntreeDecisionAuto, 'fil'> = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false,
  proposerNouvelleCible: true
}

/** Joue la boucle de la vue : décide, envoie, l'agent répond — et compte les relèves envoyées. */
function jouerSerie(reponses: Msg[]): { releves: number; fil: Msg[]; derniere: string } {
  const fil: Msg[] = [humain(DEMANDE), agent(RIEN)]
  let dernierPromptEnvoye: string | null = null
  let releves = 0
  for (const reponse of reponses) {
    const d = deciderRelanceAuto({ ...base, fil, dernierPromptEnvoye })
    if (d.action !== 'envoyer') return { releves, fil, derniere: d.action }
    if (d.texte.startsWith(PROMPT_NOUVELLE_CIBLE)) releves++
    dernierPromptEnvoye = d.texte
    fil.push(humain(d.texte), reponse)
  }
  const fin = deciderRelanceAuto({ ...base, fil, dernierPromptEnvoye })
  if (fin.action === 'envoyer' && fin.texte.startsWith(PROMPT_NOUVELLE_CIBLE)) releves++
  return { releves, fil, derniere: fin.action === 'attendre' ? fin.raison : fin.action }
}

describe('relève du mode auto — une seule par série automatique', () => {
  it('cycle relève → ask répondu seul → travail → « rien » : PAS de deuxième relève', () => {
    const serie = jouerSerie([
      askMsg(['Ajoute les tests du module', 'Documente le module']),
      agent(RIEN)
    ])
    expect(serie.releves).toBe(1)
    expect(serie.derniere).toBe('chaine-finie')
  })

  it('le fil suffit : après un redémarrage (mémoire vide), la relève déjà dans le fil compte', () => {
    const fil = [
      humain(DEMANDE),
      agent(RIEN),
      humain(PROMPT_NOUVELLE_CIBLE),
      askMsg(['Ajoute les tests']),
      humain(ancrerSurLaDemande('Ajoute les tests', DEMANDE)),
      agent(RIEN)
    ]
    expect(relevesDepuisHumain(fil)).toBe(1)
    expect(deciderRelanceAuto({ ...base, fil })).toMatchObject({
      action: 'attendre',
      raison: 'chaine-finie'
    })
  })

  it('un message de l’utilisateur ouvre une nouvelle série : la relève repart', () => {
    const fil = [
      humain(DEMANDE),
      agent(RIEN),
      humain(PROMPT_NOUVELLE_CIBLE),
      askMsg(['Ajoute les tests', 'Documente']),
      humain('Documente le module'),
      agent(RIEN)
    ]
    expect(relevesDepuisHumain(fil)).toBe(0)
    expect(deciderRelanceAuto({ ...base, fil })).toMatchObject({
      action: 'envoyer',
      texte: PROMPT_NOUVELLE_CIBLE
    })
  })

  it('une orientation tapée pendant un tour ne remet pas le compte à zéro', () => {
    const orientation = {
      role: 'user',
      content: 'pense aux logs',
      orientation: true
    } as unknown as Msg
    const fil = [
      humain(DEMANDE),
      agent(RIEN),
      humain(PROMPT_NOUVELLE_CIBLE),
      orientation,
      agent(RIEN)
    ]
    expect(relevesDepuisHumain(fil)).toBe(1)
  })
})
