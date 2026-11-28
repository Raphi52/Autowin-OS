import { useState, useEffect } from 'react'
import type { AppNotice } from './chat-view-outils'
import { messageTravailNonPublie } from './travail-non-publie'

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type SurcouchesDuFilCtx = {
  appNotice: AppNotice | null
}

/** Les surcouches du fil : image agrandie, dépôt de fichiers, recherche dans le fil, avis passager. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSurcouchesDuFil(ctx: SurcouchesDuFilCtx) {
  const { appNotice } = ctx
  const [openImage, setOpenImage] = useState<{ src: string; name: string } | null>(null)
  const [dragActive, setDragActive] = useState(false)

  /**
   * CTRL+F DANS LA CONVERSATION.
   *
   * On intercepte le raccourci du navigateur : sa recherche native n'existe pas dans une fenêtre
   * Electron sans chrome, et l'utilisateur n'avait donc AUCUN moyen de retrouver un mot dans un
   * fil long. Seul l'état ouvert/fermé vit ici — le terme cherché reste dans `ChatFindBar`, pour
   * que la frappe ne re-rende pas le fil.
   */
  const [rechercheFilOuverte, setRechercheFilOuverte] = useState(false)
  useEffect(() => {
    const surTouche = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key !== 'f' && event.key !== 'F') return
      event.preventDefault()
      setRechercheFilOuverte(true)
      // Barre deja ouverte : le raccourci REPREND la main dessus (et selectionne le terme, pour
      // le remplacer d'une frappe) au lieu de ne rien faire.
      document.querySelector<HTMLInputElement>('.chat-find-input')?.select()
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [])

  useEffect(() => {
    if (!openImage) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenImage(null)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openImage])
  useEffect(() => {
    if (appNotice?.noticeId === undefined) return
    const noticeId = appNotice.noticeId
    // Acquitter APRÈS un frame rendu. Si React démonte la vue avant, le cleanup annule l'ack et le
    // prochain montage relira la notice au lieu de la perdre entre main et renderer.
    const frame = window.requestAnimationFrame(() => {
      void Promise.resolve(window.api.workflowProfileAcknowledgeNotice?.(noticeId)).catch(
        () => undefined
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [appNotice])
  return {
    openImage,
    setOpenImage,
    dragActive,
    setDragActive,
    rechercheFilOuverte,
    setRechercheFilOuverte
  }
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type TravailNonPublieCtx = {
  isActive: boolean
}

/** Le travail non publié du dépôt : relu quand la vue redevient active, et son bandeau masqué. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useTravailNonPublie(ctx: TravailNonPublieCtx) {
  const { isActive } = ctx
  /**
   * TRAVAIL FINI, JAMAIS PUBLIE. Mesure du 2026-08-23 : trois travaux termines et prouves ont ete
   * perdus de vue le meme jour, chacun sur une branche que personne n'a fusionnee -- pendant que
   * l'utilisateur ecrivait « T'as toujours pas fais le fond d'ecran de l'accueuil ». Pire : un run
   * bloque a la PUBLICATION s'affiche en rouge, donc comme un echec, alors que son travail est fait.
   * Ce bandeau vit dans le chat parce que c'est la que l'utilisateur regarde, pas dans une vue
   * qu'il faut penser a ouvrir.
   */
  const [travailNonPublie, setTravailNonPublie] = useState<string | null>(null)
  /**
   * LE MESSAGE QU'ON A REFERME, et non un simple « ferme ». Le releve repasse toutes les 30 s et
   * reecrit `travailNonPublie` : un booleen laisserait le bandeau revenir au tick suivant, donc une
   * croix qui ne promet rien. En retenant le TEXTE, la fermeture tient tant que la situation ne
   * bouge pas -- et un travail de plus, qui change le message, rouvre l'alerte. Ce bandeau existe
   * parce que trois travaux finis ont ete perdus de vue le 2026-08-23 : le masquer pour toujours
   * etoufferait le prochain.
   */
  const [messageNonPublieMasque, setMessageNonPublieMasque] = useState<string | null>(null)
  /**
   * La LISTE des travaux non publies. Deux versions de ce bouton ont echoue avant : la premiere
   * ouvrait la vue Worktrees, la seconde la vue Workspace -- toutes deux ne montrent que les bureaux
   * VIVANTS, et affichaient donc « 0 bureau » pendant que 14 travaux attendaient. Il fallait une vue
   * qui montre les BRANCHES, pas les copies.
   */
  const [listeNonPubliee, setListeNonPubliee] = useState(false)
  useEffect(() => {
    // La vue Chat reste MONTÉE quand un autre onglet est à l'écran (App.tsx : isActive={tab==='chat'}).
    // Sonder les worktrees toutes les 30 s pour une vue invisible, c'est un IPC + une énumération git
    // payés pour un bandeau que personne ne regarde. La sonde suit donc la visibilité.
    if (!isActive) return
    let vivant = true
    const relever = async (): Promise<void> => {
      try {
        const agents = (await window.api.getWorktreeActivity?.()) ?? []
        if (vivant) setTravailNonPublie(messageTravailNonPublie(agents))
      } catch {
        // Une activite indisponible ne prouve AUCUNE perte : on se tait plutot que d'alarmer.
      }
    }
    void relever()
    const minuterie = setInterval(() => void relever(), 30_000)
    return () => {
      vivant = false
      clearInterval(minuterie)
    }
  }, [isActive])
  return {
    travailNonPublie,
    messageNonPublieMasque,
    setMessageNonPublieMasque,
    listeNonPubliee,
    setListeNonPubliee
  }
}
