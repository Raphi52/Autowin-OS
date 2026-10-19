// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AskDecisionBlock } from './AskDecision'
import { parseAskDecision } from './ask-choices'
import { askReponseDuFil } from './chat-message-keys'
import { groupAssistantActivity, type ChatPart } from './chat-view-model'
import { deciderRelanceAuto, reponseAutoAuDernierAsk } from './chat-auto-mode'

/**
 * LE RUN PARLE LUI-MEME A LA FIN (conv-1008, 2026-10-16) — « claude.exe sait faire ça c pas mal
 * je veux pareil », capture d'une carte « Message from subagent › » : resume, question, reponses,
 * croix. Ici, la question vit dans l'issue de l'action `orchestrate` (`messageDuRun`) et passe par
 * le MEME bloc que `ask` : memes reponses empilees, meme verrou, meme mode auto.
 */
let hote: HTMLDivElement
let racine: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
})
afterEach(() => {
  act(() => racine.unmount())
  hote.remove()
})

const issueLivree = {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  runPath: 'C:/runs/conv-1008/tests-orchestrator-workspace/RUN.md',
  result: 'Travail fait.',
  messageDuRun: {
    resume: 'Tests ajoutés pour orchestrator (19). Rien n’est commité.',
    question: 'Je publie sur une branche dédiée ?',
    reponses: [{ libelle: 'Oui, branche + PR', recommande: true }, { libelle: 'Pas maintenant' }]
  }
}

const actionRun = (data: unknown): ChatPart => ({
  kind: 'action',
  actionId: 'act-7',
  name: 'orchestrate',
  ok: true,
  data
})

describe('parseAskDecision lit la question du run', () => {
  it('une orchestration livrée qui porte une question devient une décision, avec sa provenance', () => {
    const decision = parseAskDecision(actionRun(issueLivree))
    expect(decision).toEqual({
      question: 'Je publie sur une branche dédiée ?',
      options: [{ libelle: 'Oui, branche + PR', recommande: true }, { libelle: 'Pas maintenant' }],
      provenance: {
        source: 'run',
        run: 'tests-orchestrator',
        resume: 'Tests ajoutés pour orchestrator (19). Rien n’est commité.'
      }
    })
  })

  it('refus du juge ou du contrôle final : aucune question ne sort', () => {
    expect(parseAskDecision(actionRun({ ...issueLivree, valid: false }))).toBeNull()
    expect(parseAskDecision(actionRun({ ...issueLivree, gateBlocked: true }))).toBeNull()
  })

  it('une orchestration sans question reste une simple action', () => {
    expect(parseAskDecision(actionRun({ ...issueLivree, messageDuRun: undefined }))).toBeNull()
  })
})

describe('le fil garde le run ET ajoute sa carte', () => {
  it('l’action orchestrate reste dans le bloc d’activité, la carte passe après le compte rendu', () => {
    const blocs = groupAssistantActivity([
      actionRun(issueLivree),
      { kind: 'text', text: 'Le run est vert.' }
    ])
    expect(blocs.map((bloc) => bloc.kind)).toEqual(['activity', 'text', 'ask-decision'])
    const activite = blocs[0]
    expect(activite.kind === 'activity' && activite.actions[0]?.name).toBe('orchestrate')
    const carte = blocs[2]
    expect(carte.kind === 'ask-decision' && carte.askId).toBe('run:act-7')
  })

  it('le verrou « déjà répondu » et le mode auto la voient comme une question ask', () => {
    const fil = [
      { role: 'user' as const, content: 'ajoute les tests' },
      { role: 'assistant' as const, content: '', parts: [actionRun(issueLivree)] }
    ]
    // Mode auto : la recommandée part seule.
    expect(reponseAutoAuDernierAsk(fil as never)).toBe('Oui, branche + PR')
    // Une réponse cliquée ferme la question.
    const repondu = [...fil, { role: 'user' as const, content: 'Pas maintenant' }]
    expect(askReponseDuFil(repondu as never, 1)).toBe('Pas maintenant')
  })
})

describe('AskDecisionBlock — la carte du run', () => {
  const decision = parseAskDecision(actionRun(issueLivree))!

  function rendre(onPick?: (prompt: string) => void, idDurable = 'tour-1:run:act-7'): void {
    act(() =>
      racine.render(<AskDecisionBlock decision={decision} onPick={onPick} idDurable={idDurable} />)
    )
  }

  it('annonce qui parle, son résumé, puis la question et ses réponses empilées', () => {
    rendre()
    const provenance = hote.querySelector('[data-testid="ask-decision-provenance"]')
    expect(provenance?.textContent).toContain('Message du run')
    expect(provenance?.textContent).toContain('tests-orchestrator')
    expect(hote.querySelector('[data-testid="ask-decision-resume"]')?.textContent).toBe(
      'Tests ajoutés pour orchestrator (19). Rien n’est commité.'
    )
    expect(hote.querySelector('.askd-badge')?.textContent).toBe('run')
    expect(hote.querySelector('.askd-question')?.textContent).toBe(
      'Je publie sur une branche dédiée ?'
    )
    expect(hote.querySelectorAll('[data-testid="ask-decision-option"]')).toHaveLength(2)
  })

  it('un clic envoie la réponse, comme une question ask', () => {
    const onPick = vi.fn()
    rendre(onPick)
    const premiere = hote.querySelector<HTMLButtonElement>('.askd-choix')
    act(() => premiere?.click())
    expect(onPick).toHaveBeenCalledWith('Oui, branche + PR')
  })

  it('la croix ferme la carte SANS rien envoyer, et la fermeture survit au remontage', () => {
    const onPick = vi.fn()
    rendre(onPick)
    act(() => hote.querySelector<HTMLButtonElement>('[data-testid="ask-decision-fermer"]')?.click())
    expect(hote.querySelector('[data-testid="ask-decision"]')).toBeNull()
    expect(onPick).not.toHaveBeenCalled()
    // Remontage : la carte reste fermée.
    act(() => racine.unmount())
    racine = createRoot(hote)
    rendre(onPick)
    expect(hote.querySelector('[data-testid="ask-decision"]')).toBeNull()
    // Une autre question du run, elle, s'affiche.
    act(() => racine.unmount())
    racine = createRoot(hote)
    rendre(onPick, 'tour-2:run:act-1')
    expect(hote.querySelector('[data-testid="ask-decision"]')).not.toBeNull()
  })

  it('une question ask ordinaire n’a ni en-tête de run, ni croix', () => {
    const ordinaire = { question: 'Laquelle ?', options: [{ libelle: 'A' }, { libelle: 'B' }] }
    act(() => racine.render(<AskDecisionBlock decision={ordinaire} idDurable="x" />))
    expect(hote.querySelector('[data-testid="ask-decision-provenance"]')).toBeNull()
    expect(hote.querySelector('[data-testid="ask-decision-fermer"]')).toBeNull()
    expect(hote.querySelector('.askd-badge')?.textContent).toBe('ask')
  })
})

/*
 * « en mode auto ca répond tout seul » (conv-1008) : la question du run passe par la MEME porte
 * que `ask` (`deciderRelanceAuto`), donc le mode auto y repond seul — la recommandee — et une
 * reponse destructrice attend toujours l'humain.
 */
describe('mode auto — répond seul à la question du run', () => {
  const base = {
    actif: true,
    occupe: false,
    dernierTourTraite: null,
    dernierPromptEnvoye: null,
    brouillonPresent: false
  }
  const filAvec = (data: unknown): never =>
    [
      { role: 'user', content: 'ajoute les tests' },
      {
        role: 'assistant',
        content: '',
        parts: [actionRun(data), { kind: 'text', text: 'Le run est vert.' }]
      }
    ] as never

  it('envoie la réponse recommandée du run', () => {
    const d = deciderRelanceAuto({ ...base, fil: filAvec(issueLivree) })
    expect(d).toMatchObject({ action: 'envoyer' })
    expect(d.action === 'envoyer' && d.texte).toContain('Oui, branche + PR')
  })

  it('ne répond jamais seul une réponse destructrice', () => {
    const destructrice = {
      ...issueLivree,
      messageDuRun: {
        question: 'Je nettoie ?',
        reponses: [{ libelle: 'Supprimer la branche', recommande: true }, { libelle: 'Garder' }]
      }
    }
    expect(deciderRelanceAuto({ ...base, fil: filAvec(destructrice) }).action).not.toBe('envoyer')
  })

  it('reste inerte quand le mode est éteint', () => {
    expect(deciderRelanceAuto({ ...base, actif: false, fil: filAvec(issueLivree) }).action).toBe(
      'attendre'
    )
  })
})
