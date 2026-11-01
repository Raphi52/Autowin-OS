/**
 * QUESTION À CÔTÉ — ce que le panneau partage sans être un composant (conv-1362, lot 1/3).
 *
 * Les échanges vivent dans une `Map` en mémoire : ils survivent à la fermeture du panneau et au
 * changement de fil, et sont perdus à la fermeture de l'app. C'est voulu : rien n'est écrit nulle part.
 */
import { useEffect, useRef } from 'react'
import type { ApiQuestionACote, IssueQuestionACote } from '../../../shared/question-a-cote'

export interface EchangeQuestionACote {
  id: number
  question: string
  issue: IssueQuestionACote
}

/** Les 5 questions précédentes, plus celle affichée. */
const ECHANGES_GARDES = 6

const echangesParFil = new Map<string, EchangeQuestionACote[]>()
let prochainId = 1

export function echangesDuFil(conversationId: string): EchangeQuestionACote[] {
  return echangesParFil.get(conversationId) ?? []
}

/** Ajoute l'échange en tête et rend la liste du fil, bornée. */
export function ajouterEchange(
  conversationId: string,
  question: string,
  issue: IssueQuestionACote
): EchangeQuestionACote[] {
  const suite = [{ id: prochainId++, question, issue }, ...echangesDuFil(conversationId)].slice(
    0,
    ECHANGES_GARDES
  )
  echangesParFil.set(conversationId, suite)
  return suite
}

/** Pour les tests : repart d'une mémoire vide. */
export function oublierQuestionsACote(): void {
  echangesParFil.clear()
}

export function apiQuestionACote(): ApiQuestionACote | undefined {
  return (window.api as { questionACote?: ApiQuestionACote } | undefined)?.questionACote
}

/** Ctrl+; ouvre et ferme. `key` et non `code` : sur un clavier AZERTY, le `;` n'est pas à sa place. */
export function useRaccourciQuestionACote(actif: boolean, basculer: () => void): void {
  const rappel = useRef(basculer)
  useEffect(() => {
    rappel.current = basculer
  })
  useEffect(() => {
    if (!actif) return
    const surTouche = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key !== ';') return
      event.preventDefault()
      rappel.current()
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [actif])
}
