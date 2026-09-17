import { useCallback, useEffect, useState } from 'react'
import { ProdPassphraseGate } from './ProdPassphraseGate'

/*
 * L'HÔTE DE L'ÉCRAN D'AUTORISATION — ce qui relie un REFUS à une QUESTION posée à l'utilisateur.
 *
 * Sans lui, la chaîne était coupée en son milieu : le processus principal refusait un geste de
 * production, l'écran de saisie existait, et rien ne l'ouvrait. L'utilisateur lisait un refus sans
 * aucun moyen d'autoriser.
 *
 * CE QU'IL FAIT : il écoute les demandes publiées par le guichet (`prod-guichet.ts`), affiche l'écran
 * par-dessus l'application, et renvoie le jeton obtenu. L'outil bloqué, lui, ATTEND ce jeton et
 * rejoue son geste tout seul — l'utilisateur n'a rien à retaper.
 *
 * DEUX PRÉCAUTIONS :
 *   - au montage, on relit les demandes déjà ouvertes : une fenêtre rechargée pendant l'attente
 *     laisserait sinon un outil suspendu devant un écran disparu ;
 *   - le processus principal peut refermer une demande (délai expiré) ; on retire alors l'écran, pour
 *     ne pas faire saisir une phrase dont le jeton n'ouvrirait plus rien.
 *
 * UNE DEMANDE À LA FOIS : c'est une décision de sécurité, pas d'esthétique. Empiler deux écrans
 * ferait autoriser à l'aveugle le second, qui porte une autre cible.
 */
interface DemandeHote {
  id: string
  cible: string
  operation: string
  raison: string
  niveau: 'confirmation' | 'phrase'
  /** Le fil qui a déclenché le geste. Absent d'une demande ancienne ou non tracée. */
  conversationId?: string
}

export interface ProdAutorisationHoteProps {
  /**
   * LE FIL ACTUELLEMENT AFFICHÉ. Une demande qui nomme une AUTRE conversation n'est pas montrée ici :
   * l'écran vit dans le fil, et une question posée ailleurs n'a pas à s'afficher sous une discussion
   * qui n'a rien demandé (conv-626, 2026-09-16). Une demande SANS origine reste montrée partout —
   * un geste de production bloqué ne doit pas devenir invisible faute d'étiquette.
   */
  conversationId?: string | null
}

export function ProdAutorisationHote({
  conversationId
}: ProdAutorisationHoteProps = {}): React.JSX.Element | null {
  const [file, setFile] = useState<DemandeHote[]>([])

  useEffect(() => {
    let vivant = true
    void Promise.resolve(window.api?.prodAutorisationEnAttente?.())
      .then((ouvertes) => {
        if (vivant && Array.isArray(ouvertes) && ouvertes.length > 0) setFile(ouvertes)
      })
      .catch(() => {
        // Un shell plus ancien n'expose pas ce canal : l'absence d'écran ne bloque rien, la porte
        // refuse simplement comme avant.
      })
    const offDemande = window.api?.onProdAutorisationDemandee?.((demande) => {
      setFile((precedentes) =>
        precedentes.some((d) => d.id === demande.id) ? precedentes : [...precedentes, demande]
      )
    })
    const offClose = window.api?.onProdAutorisationClose?.((id) => {
      setFile((precedentes) => precedentes.filter((d) => d.id !== id))
    })
    return () => {
      vivant = false
      offDemande?.()
      offClose?.()
    }
  }, [])

  /*
   * LE FILTRE — une demande ne s'affiche que dans SON fil. Il porte sur la file entière et non sur la
   * seule première demande : sinon, une demande venue d'ailleurs masquerait celle du fil courant en
   * restant en tête de file sans jamais s'afficher, et l'utilisateur ne verrait plus rien du tout.
   * Une demande sans origine connue reste visible partout (repli le plus sûr).
   */
  const courante = file.find(
    (demande) => !demande.conversationId || !conversationId || demande.conversationId === conversationId
  )

  const autoriser = useCallback(
    (jeton: string) => {
      if (!courante) return
      setFile((precedentes) => precedentes.filter((d) => d.id !== courante.id))
      void window.api?.prodAutorisationDeposer?.(courante.id, jeton)
    },
    [courante]
  )

  const confirmer = useCallback(() => {
    if (!courante) return
    setFile((precedentes) => precedentes.filter((d) => d.id !== courante.id))
    void window.api?.prodAutorisationConfirmer?.(courante.id)
  }, [courante])

  const annuler = useCallback(() => {
    if (!courante) return
    setFile((precedentes) => precedentes.filter((d) => d.id !== courante.id))
    void window.api?.prodAutorisationAnnuler?.(courante.id)
  }, [courante])

  if (!courante) return null
  return (
    <div className="ppg-hote" role="presentation">
      <ProdPassphraseGate
        demande={{
          cible: courante.cible,
          operation: courante.operation,
          raison: courante.raison,
          niveau: courante.niveau
        }}
        onAutorise={autoriser}
        onConfirme={confirmer}
        onAnnule={annuler}
      />
    </div>
  )
}
