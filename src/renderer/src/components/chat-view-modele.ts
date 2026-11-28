import { type OrchestratorModelOption } from './chat-view-model'
import { texteFil, type ModeleDuFil } from './chat-view-outils'
import type { Conv } from './chat-view-types'
import { useEffect } from 'react'

// Fonctions extraites de ChatView.tsx telles quelles : chacune reçoit en premier argument les valeurs
// du rendu qui l'appelle, que lui passe son relais (même nom) dans ChatView.
/** Ce que le choix du modèle et du compte d'un fil lit de ChatView. */
export type ModeleCtx = {
  activeId: string | null
  busy: boolean
  compteNouveauFilRef: React.RefObject<string | null>
  modelChangePending: boolean
  modeleNouveauFilRef: React.RefObject<ModeleDuFil | null>
  poserOrchestrateurDuStudio: (option: OrchestratorModelOption) => Promise<void>
  setCompteError: React.Dispatch<React.SetStateAction<string | null>>
  setCompteNouveauFil: React.Dispatch<React.SetStateAction<string | null>>
  setConvs: React.Dispatch<React.SetStateAction<Conv[]>>
  setModelChangeError: React.Dispatch<React.SetStateAction<string | null>>
  setModelChangePending: React.Dispatch<React.SetStateAction<boolean>>
  setModeleNouveauFil: React.Dispatch<React.SetStateAction<ModeleDuFil | null>>
}

/**
 * LE MODÈLE, À L'ÉCHELLE DE LA CONVERSATION (2026-10-11).
 *
 * Avant, ce choix réécrivait le rôle orchestrateur GLOBAL (`setRole`) : changer de modèle dans
 * un fil le changeait dans tous. Il est désormais mémorisé sur la conversation ouverte, que le
 * main relit au départ de chacun de ses tours. Sans conversation ouverte, il est ARMÉ pour le
 * fil qui va naître. Le défaut de l'application se règle toujours dans Routage.
 * `option === null` : revenir au modèle par défaut.
 *
 * ET L'ORCHESTRATEUR D'AGENTS STUDIO SUIT (2026-11-04 : « quand je change de model et
 * d'effort depuis un chat ca doit changer l'orchestrator de agents studio »). Le fil garde son
 * choix propre : un fil qui a choisi son modèle ne bouge pas quand un autre change ;
 * seuls les fils sans choix propre suivent le nouveau défaut. Revenir au défaut ne touche pas
 * Agents Studio.
 */
export async function poserOrchestrateurDuStudio(
  ctx: ModeleCtx,
  option: OrchestratorModelOption
): Promise<void> {
  const { setModelChangeError } = ctx
  try {
    // `setRole` réécrit la topologie puis prévient les écrans (`scope: 'roles'`) : Agents Studio
    // et l'en-tête de ce fil se relisent seuls.
    await window.api.setRole('orchestrator', option.provider, option.model, option.reasoningEffort)
  } catch (error) {
    setModelChangeError(
      texteFil('modele.studioNonMisAJour', {
        raison: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

export async function changerModeleDuFil(
  ctx: ModeleCtx,
  option: OrchestratorModelOption | null
): Promise<void> {
  const {
    activeId,
    busy,
    modelChangePending,
    poserOrchestrateurDuStudio,
    setConvs,
    setModelChangeError,
    setModelChangePending,
    setModeleNouveauFil
  } = ctx
  if (busy || modelChangePending) return
  setModelChangeError(null)
  if (!activeId) {
    setModeleNouveauFil(
      option
        ? {
            provider: option.provider,
            model: option.model,
            ...(option.reasoningEffort ? { reasoningEffort: option.reasoningEffort } : {})
          }
        : null
    )
    if (option) await poserOrchestrateurDuStudio(option)
    return
  }
  const cible = activeId
  setModelChangePending(true)
  try {
    if (!window.api.conversationSetModel)
      // Le pont (preload) n'est relu qu'au démarrage : une app lancée avant ce changement ne le
      // connaît pas. On le DIT au lieu d'écrire le défaut global à la place.
      throw new Error(texteFil('modele.redemarrer'))
    const retenu = await window.api.conversationSetModel(
      cible,
      option ? option.provider : null,
      option?.model,
      option?.reasoningEffort
    )
    setConvs((courant) =>
      courant.map((conv) => {
        if (conv.id !== cible) return conv
        if (retenu) return { ...conv, modeleChoisi: retenu }
        const { modeleChoisi: _retire, ...reste } = conv
        return reste
      })
    )
    if (option) await poserOrchestrateurDuStudio(option)
  } catch (error) {
    setModelChangeError(
      texteFil('modele.changementNonEnregistre', {
        raison: error instanceof Error ? error.message : String(error)
      })
    )
  } finally {
    setModelChangePending(false)
  }
}

/** Pose le compte armé sur le fil qui vient de naître, puis le vide. Un échec se dit, sans bloquer. */
export async function poserCompteArme(ctx: ModeleCtx, conversationId: string): Promise<void> {
  const { compteNouveauFilRef, setCompteError, setCompteNouveauFil } = ctx
  const arme = compteNouveauFilRef.current
  if (!arme) return
  compteNouveauFilRef.current = null
  setCompteNouveauFil(null)
  try {
    await window.api.conversationSetClaudeAccount?.(conversationId, arme)
  } catch (error) {
    setCompteError(error instanceof Error ? error.message : String(error))
  }
}

/** Pose le modèle armé sur le fil qui vient de naître, puis le vide. Best-effort : jamais bloquant. */
export async function poserModeleArme(ctx: ModeleCtx, conversationId: string): Promise<void> {
  const { modeleNouveauFilRef, setConvs, setModelChangeError, setModeleNouveauFil } = ctx
  const arme = modeleNouveauFilRef.current
  if (!arme) return
  modeleNouveauFilRef.current = null
  setModeleNouveauFil(null)
  try {
    const retenu = await window.api.conversationSetModel?.(
      conversationId,
      arme.provider,
      arme.model,
      arme.reasoningEffort
    )
    if (retenu)
      setConvs((courant) =>
        courant.map((conv) =>
          conv.id === conversationId ? { ...conv, modeleChoisi: retenu } : conv
        )
      )
  } catch (error) {
    // Le fil part alors sur le modèle par défaut — et l'en-tête le MONTRE ; on dit pourquoi.
    setModelChangeError(
      texteFil('modele.nonEnregistreNouveauFil', {
        raison: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

// Extrait de ChatView.tsx tel quel, sans changement de comportement.
export type ComptesClaudeCtx = {
  activeId: string | null
  compteBusy: boolean
  setCompteBusy: React.Dispatch<React.SetStateAction<boolean>>
  setCompteError: React.Dispatch<React.SetStateAction<string | null>>
  setCompteNouveauFil: React.Dispatch<React.SetStateAction<string | null>>
  setComptesClaude: React.Dispatch<
    React.SetStateAction<{
      activeId: string
      accounts: {
        id: string
        displayName: string
        tier?: string | undefined
        email?: string | undefined
      }[]
    } | null>
  >
  setConvs: React.Dispatch<React.SetStateAction<Conv[]>>
}

/** Les comptes Claude proposés au fil : chargés au montage (avec reprise), et le choix d'un compte. */
// Type de retour inféré : l'objet des valeurs que ChatView.tsx relit après l'appel.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useComptesClaude(ctx: ComptesClaudeCtx) {
  const {
    activeId,
    compteBusy,
    setCompteBusy,
    setCompteError,
    setCompteNouveauFil,
    setComptesClaude,
    setConvs
  } = ctx
  useEffect(() => {
    // Differe d'une micro-tache et appel OPTIONNEL, comme dans Routage : un preload plus ancien
    // que le renderer ne doit pas produire de rejet non gere, et un `setState` atteint
    // synchronement depuis un effet declenche des rendus en cascade.
    // UN SEUL ESSAI NE SUFFIT PAS. Vecu le 2026-09-12 : quand cet appel echoue au demarrage (main
    // pas encore pret, preload plus ancien qu'un renderer recharge a chaud), la liste restait nulle
    // POUR TOUTE LA SESSION et le bloc « Compte » disparaissait de la pop-up, sans aucun message.
    let annule = false
    let essais = 0
    const charger = async (): Promise<void> => {
      if (annule) return
      const payload = await window.api.claudeAccounts?.().catch(() => null)
      if (annule) return
      if (payload && payload.accounts.length > 0) {
        setComptesClaude(payload)
        return
      }
      essais += 1
      if (essais < 5) setTimeout(() => void charger(), 1000 * essais)
    }
    void Promise.resolve().then(charger)
    return () => {
      annule = true
    }
    // Setter (`useState`) de ChatView.tsx : stable, l'effet ne tourne toujours qu'au montage.
  }, [setComptesClaude])

  /**
   * LE COMPTE CLAUDE, A L'ECHELLE DE LA CONVERSATION.
   *
   * Le choix est memorise sur la conversation ouverte (`conversationSetClaudeAccount`) ET rendu
   * actif tout de suite, pour que le badge d'auth parle du bon compte. Chaque appel du fil lit ensuite
   * ce compte sur la conversation (`claudeCompteDuFil`) : c'est le main qui tient la verite.
   */
  const choisirCompteDeConversation = async (accountId: string): Promise<void> => {
    if (compteBusy) return
    setCompteBusy(true)
    setCompteError(null)
    try {
      // Sans conversation ouverte, le choix est ARME pour le fil qui va naitre.
      if (activeId) await window.api.conversationSetClaudeAccount?.(activeId, accountId)
      else setCompteNouveauFil(accountId)
      const payload = await window.api.claudeAccountSwitch?.(accountId)
      if (payload) setComptesClaude(payload)
      if (activeId)
        setConvs((courant) =>
          courant.map((conv) =>
            conv.id === activeId ? { ...conv, claudeAccountId: accountId } : conv
          )
        )
      window.dispatchEvent(new CustomEvent('autowin:quotas-stale'))
    } catch (error) {
      setCompteError(error instanceof Error ? error.message : String(error))
    } finally {
      setCompteBusy(false)
    }
  }
  return { choisirCompteDeConversation }
}
