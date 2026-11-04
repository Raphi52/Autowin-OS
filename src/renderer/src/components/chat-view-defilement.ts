import { useEffect } from 'react'
import { restaurerPositionLecture } from './position-lecture'
import { mesurerMessagesRendus } from './chat-mesure-messages'
import { scrollChatToBottom } from './chat-view-model'

// Extrait de ChatView.tsx tel quel, sans changement de comportement (conv-1508).
export type RepriseDeLectureCtx = {
  activeDirectiveReceipts: import('./chat-view-types').DirectiveReceipt[]
  atterrissageDemande: number
  basculeConvRef: React.RefObject<boolean>
  dernierScrollTopRef: React.RefObject<number>
  descenteEnVolRef: React.RefObject<boolean>
  followTailRef: React.RefObject<boolean>
  gesteLecteurRef: React.RefObject<boolean>
  messages: import('./chat-view-types').Msg[]
  positionARestaurerRef: React.RefObject<import('./position-lecture').PositionLecture | null>
  scrollRef: React.RefObject<HTMLDivElement | null>
  setHasNewActivity: React.Dispatch<React.SetStateAction<boolean>>
  setRepriseEnCours: React.Dispatch<React.SetStateAction<boolean>>
  setScrolledAwayFromTail: React.Dispatch<React.SetStateAction<boolean>>
}

export function useRepriseDeLecture(ctx: RepriseDeLectureCtx): void {
  const {
    activeDirectiveReceipts,
    atterrissageDemande,
    basculeConvRef,
    dernierScrollTopRef,
    descenteEnVolRef,
    followTailRef,
    gesteLecteurRef,
    messages,
    positionARestaurerRef,
    scrollRef,
    setHasNewActivity,
    setRepriseEnCours,
    setScrolledAwayFromTail
  } = ctx
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    // REPRISE DE LECTURE : la conversation a ete quittee au milieu du fil. On restaure l'endroit
    // exact AVANT toute descente, sinon l'ouverture viserait le bas comme avant (defaut du 2026-08-30).
    const aRestaurer = positionARestaurerRef.current
    if (aRestaurer) {
      positionARestaurerRef.current = null
      // La reprise bouge le fil sur ~20 frames : ces `scroll` sont les NOTRES, pas une lecture.
      gesteLecteurRef.current = false
      followTailRef.current = false
      setScrolledAwayFromTail(true)
      setRepriseEnCours(true)
      // Filet : si la boucle ne rend jamais la main (fil demonte en pleine reprise), le fil ne doit
      // PAS rester invisible. Le masque tombe de toute facon.
      const filet = window.setTimeout(() => {
        basculeConvRef.current = false
        setRepriseEnCours(false)
      }, 800)
      requestAnimationFrame(() =>
        restaurerPositionLecture(
          scroll,
          aRestaurer,
          requestAnimationFrame,
          20,
          () => {
            window.clearTimeout(filet)
            basculeConvRef.current = false
            setRepriseEnCours(false)
          },
          () => mesurerMessagesRendus(scroll)
        )
      )
      return
    }
    if (!followTailRef.current) {
      basculeConvRef.current = false
      setHasNewActivity(true)
      return
    }
    let annulerDescente: (() => void) | undefined
    const frame = requestAnimationFrame(() => {
      // L'utilisateur a pu remonter le fil ENTRE la décision et la frame : on relit son intention au
      // lieu de la présumer. Sans cette relecture, un message qui arrive juste avant un scroll vers
      // le haut le ramène de force en bas et efface le bouton de retour.
      if (!followTailRef.current) return
      // Le troisième argument est le défaut de `scrollChatToBottom` ; on ne le passe que pour atteindre
      // le filet. Si la descente n'atterrit PAS (re-rendu qui repose le fil en haut, contenu qui grandit
      // plus vite qu'on ne descend), le texte tardif — typiquement le bloc de clôture — reste hors
      // champ : le bouton « ↓ Dernière réponse » doit alors le dire, au lieu d'un silence.
      gesteLecteurRef.current = false
      descenteEnVolRef.current = true
      dernierScrollTopRef.current = scroll.scrollTop
      annulerDescente = scrollChatToBottom(
        scroll,
        requestAnimationFrame,
        40,
        (landed) => {
          descenteEnVolRef.current = false
          basculeConvRef.current = false
          if (!landed) setHasNewActivity(true)
        },
        // Un recul SANS geste vient d'un re-rendu, pas du lecteur : la descente ne doit pas
        // abandonner (defaut du 2026-09-12 en mode auto, bouton « derniere reponse » allume).
        () => gesteLecteurRef.current
      )
      setHasNewActivity(false)
      setScrolledAwayFromTail(false)
    })
    // UNE SEULE descente vivante. Chaque delta de streaming re-déclenche cet effet ; sans cette
    // annulation, les boucles s'empilaient sur le même conteneur et se contredisaient frame par
    // frame — le fil VIBRAIT juste après l'envoi (rapporté le 2026-08-30).
    return () => {
      cancelAnimationFrame(frame)
      annulerDescente?.()
    }
  }, [messages, activeDirectiveReceipts, atterrissageDemande])
}
