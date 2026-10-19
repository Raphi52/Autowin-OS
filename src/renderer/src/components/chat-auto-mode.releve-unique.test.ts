import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import {
  PROMPT_NOUVELLE_CIBLE,
  ancrerSurLaDemande,
  deciderRelanceAuto,
  derniereDemandeHumaine,
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

/*
 * LA RELÈVE NE PROMET PLUS D'ATTENDRE. conv-996 (2026-10-16) : elle disait « et attends mon
 * choix », alors que `reponseAutoAuDernierAsk` répond SEUL à la question qu'elle demande. L'agent a
 * pris l'option envoyée pour une dérive et a refusé de l'exécuter ; l'utilisateur a tranché :
 * « trust le pouvoir du mode auto ». Le texte change, donc les relèves DÉJÀ écrites dans les fils
 * (et dans `dernierPromptEnvoye`) doivent rester reconnues, sinon la relève repartirait en double.
 */
const RELEVE_AVANT_CONV_996 =
  'La chaîne de ce fil est terminée. Ne lance aucun chantier : propose-moi avec `ask` 2 à 10 ' +
  'nouvelles cibles concrètes issues de ce qui vient d’être fait, et attends mon choix.'

describe('texte de la relève — l’option recommandée part seule', () => {
  it('annonce que l’option recommandée partira seule, sans promettre d’attendre un choix', () => {
    expect(PROMPT_NOUVELLE_CIBLE).not.toMatch(/attends mon choix/i)
    expect(PROMPT_NOUVELLE_CIBLE).toMatch(/option recommandée/)
    expect(PROMPT_NOUVELLE_CIBLE).toMatch(/partira seule/)
  })

  it('une relève à l’ANCIEN texte, déjà dans le fil, compte encore : pas de deuxième relève', () => {
    const fil = [
      humain(DEMANDE),
      agent(RIEN),
      humain(RELEVE_AVANT_CONV_996),
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

  it('une relève à l’ANCIEN texte gardée en mémoire (dernierPromptEnvoye) compte encore', () => {
    const fil = [humain(DEMANDE), agent(RIEN)]
    expect(
      deciderRelanceAuto({ ...base, fil, dernierPromptEnvoye: RELEVE_AVANT_CONV_996 })
    ).toMatchObject({ action: 'attendre', raison: 'chaine-finie' })
  })

  it('une relève à l’ANCIEN texte n’est jamais prise pour la demande de l’utilisateur', () => {
    const fil = [humain(DEMANDE), agent(RIEN), humain(RELEVE_AVANT_CONV_996)]
    expect(derniereDemandeHumaine(fil)).toBe(DEMANDE)
  })
})
