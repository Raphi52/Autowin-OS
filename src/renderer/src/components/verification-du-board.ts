/**
 * VÉRIFIER DEPUIS LE BOARD — le calcul PUR (conv-1136, 2026-10-23).
 *
 * Demande : « dans le board faut un bouton pour tout vérifier et un bouton vérifier sur un post it
 * pour le faire quitter la ligne à vérifier », « et vérifier manuellement », « et faire une skill
 * /verify ou /check ». Lecture validée par l'utilisateur (« parfait go ») :
 *   - « Vérifier » ENVOIE `/check` dans le fil du post-it : un vrai tour y rejoue la preuve. Le
 *     post-it ne quitte la ligne que par cette preuve — la carte lit le statut de la DERNIÈRE demande
 *     du fil (`carte-du-fil.ts`, `statutDuSegment`) : vert → « Fait », rouge → « Bloqué » ;
 *   - « Vérifié à la main » le pose en « Fait » SANS preuve : le même état manuel que le glisser
 *     (`etats-manuels-carte.ts`), gardé sur ce poste, jamais compté comme une preuve ;
 *   - « Tout vérifier » envoie `/check` à chaque post-it de la ligne AFFICHÉ (la frise de 14 jours,
 *     filtre de personne compris) — jamais aux centaines de fils plus anciens que personne ne voit :
 *     chaque envoi est un tour de modèle payé.
 *
 * `/check` et pas `/verify` : `verify` est déjà le nom d'un outil du chat ; deux sens pour un mot
 * auraient brouillé la consigne de l'agent.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CarteDesBesoins, StatutDemande } from '../../../shared/carte-des-besoins'
import { filsDuProjet } from './carte-des-besoins-branches'
import type { PostItDeLaRiviere } from './carte-riviere'

/** Le message envoyé dans le fil : la skill `skills/check/SKILL.md`. */
export const COMMANDE_DE_VERIFICATION = '/check'

/**
 * Les post-its que « Tout vérifier » vise : ceux de la ligne « À vérifier » (l'étage AFFICHÉ, état
 * manuel compris), et seulement ceux de la personne choisie quand un filtre est posé — les autres
 * sont estompés à l'écran, l'utilisateur ne les vise pas.
 */
export function postitsAVerifier(
  postits: readonly PostItDeLaRiviere[],
  personne: string | null
): PostItDeLaRiviere[] {
  return postits.filter(
    (p) => p.etage === 'sans-preuve' && (personne === null || p.demandeur?.cle === personne)
  )
}

/** Ce que rend l'envoi d'un `/check` dans un fil. */
export interface EnvoiDeVerification {
  ok: boolean
  error?: string
}

export interface BilanDeVerification {
  lances: string[]
  echecs: { conversationId: string; raison: string }[]
}

/**
 * Envoie `/check` dans chaque fil, UN PAR UN : chaque envoi rend la main dès que le tour a démarré
 * (`lancerDansConversation`), pas à sa fin ; en série, un fil refusé n'empêche pas les suivants et
 * son refus est gardé pour être dit.
 */
export async function lancerLesVerifications(
  conversationIds: readonly string[],
  envoyer: (conversationId: string, message: string) => Promise<EnvoiDeVerification>
): Promise<BilanDeVerification> {
  const bilan: BilanDeVerification = { lances: [], echecs: [] }
  for (const conversationId of conversationIds) {
    try {
      const r = await envoyer(conversationId, COMMANDE_DE_VERIFICATION)
      if (r.ok) bilan.lances.push(conversationId)
      else bilan.echecs.push({ conversationId, raison: r.error ?? 'envoi refusé' })
    } catch (e) {
      bilan.echecs.push({ conversationId, raison: e instanceof Error ? e.message : String(e) })
    }
  }
  return bilan
}

/** Le bilan en une ligne : « /check lancé dans 3 fils », « … · 1 refusé : <raison> ». */
export function resumeDuBilan(bilan: BilanDeVerification): string {
  const n = bilan.lances.length
  const lance = n === 0 ? 'aucun /check lancé' : `/check lancé dans ${n} fil${n > 1 ? 's' : ''}`
  if (bilan.echecs.length === 0) return lance
  const e = bilan.echecs.length
  return `${lance} · ${e} refusé${e > 1 ? 's' : ''} : ${bilan.echecs[0].raison}`
}

/** Pas du recalcul pendant qu'un `/check` tourne : le calcul ne refait que les fils qui ont bougé. */
export const PAS_DU_SUIVI_MS = 15_000
/** Au-delà, le fil n'est plus suivi : « Actualiser » reste là, rien ne tourne en fond pour rien. */
export const DUREE_MAX_DU_SUIVI_MS = 30 * 60_000
/**
 * Un fil lancé il y a moins de ça reste suivi même si la carte ne le voit pas encore « en cours » :
 * le recalcul peut précéder l'écriture du `/check` dans le fil, il ne doit pas clore le suivi.
 */
export const GRACE_DU_SUIVI_MS = 20_000

/**
 * Les fils encore à suivre : `suivis` = heure de lancement par fil. Un fil sort du suivi quand sa
 * dernière demande n'est plus « en cours » (le post-it a rejoint « Fait », « Bloqué » ou « À
 * vérifier »), passé le délai de grâce, ou au bout de la durée maximale.
 */
export function suivisRestants(
  carte: CarteDesBesoins,
  suivis: Readonly<Record<string, number>>,
  maintenant: number
): Record<string, number> {
  const derniers = new Map<string, StatutDemande>()
  for (const projet of carte.projets)
    for (const fil of filsDuProjet(projet.demandes))
      derniers.set(fil.conversationId, fil.derniere.statut)
  const restants: Record<string, number> = {}
  for (const [id, depuis] of Object.entries(suivis)) {
    const age = maintenant - depuis
    if (age > DUREE_MAX_DU_SUIVI_MS) continue
    if (age < GRACE_DU_SUIVI_MS || derniers.get(id) === 'en-cours') restants[id] = depuis
  }
  return restants
}

/**
 * Le geste « vérifier » de la vue : envoie `/check` par la commande `chat_send` (un vrai tour dans
 * le fil, la skill y est reconnue), recalcule la carte, puis la recalcule tous les `PAS_DU_SUIVI_MS`
 * tant qu'un fil lancé tourne encore — le post-it change de ligne sans « Actualiser ».
 */
export function useVerificationDuBoard(
  active: boolean,
  carte: CarteDesBesoins | null,
  charger: () => Promise<void>
): (conversationIds: readonly string[]) => Promise<BilanDeVerification> {
  const [suivis, setSuivis] = useState<Record<string, number>>({})

  const verifier = useCallback(
    async (conversationIds: readonly string[]) => {
      const bilan = await lancerLesVerifications(
        conversationIds,
        async (conversationId, message) => {
          const r = await window.api.appCommand('chat_send', { conversationId, message })
          return { ok: r.ok, ...(r.error ? { error: r.error } : {}) }
        }
      )
      if (bilan.lances.length > 0) {
        const depuis = Date.now()
        setSuivis((avant) => ({
          ...avant,
          ...Object.fromEntries(bilan.lances.map((id) => [id, depuis]))
        }))
        await charger()
      }
      return bilan
    },
    [charger]
  )

  // Chaque carte relue retire les fils finis ; l'état vient d'un calcul sur la carte reçue, il ne
  // boucle pas (même motif que le chargement de la vue).
  useEffect(() => {
    if (!carte) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSuivis((avant) => {
      if (Object.keys(avant).length === 0) return avant
      const restants = suivisRestants(carte, avant, Date.now())
      return Object.keys(restants).length === Object.keys(avant).length ? avant : restants
    })
  }, [carte])

  const nombreSuivis = Object.keys(suivis).length
  useEffect(() => {
    if (!active || nombreSuivis === 0) return
    const minuteur = window.setInterval(() => void charger(), PAS_DU_SUIVI_MS)
    return () => window.clearInterval(minuteur)
  }, [active, nombreSuivis, charger])

  return verifier
}

/**
 * Délai avant de cacher les gestes d'un post-it quitté : ses boutons sont posés SUR son coin, donc
 * passer du papier au bouton « quitte » le post-it ; le bouton atteint annule la sortie.
 */
export const DELAI_DE_SORTIE_MS = 150

export interface SurvolDesGestes {
  /** Le post-it dont les gestes sont montrés, ou `null`. */
  id: string | null
  entrer: (conversationId: string) => void
  sortir: () => void
}

/**
 * Quel post-it montre ses gestes « vérifier ». Un état plutôt que `:hover + …` en CSS : les gestes
 * sont rendus APRÈS tous les post-its (un bouton n'entre pas dans un bouton, et les glisser dans
 * chaque post-it aurait réindenté tout le rendu de la rivière).
 */
export function useSurvolDesGestes(): SurvolDesGestes {
  const [id, setId] = useState<string | null>(null)
  const sortie = useRef<number | null>(null)
  const annuler = useCallback((): void => {
    if (sortie.current !== null) window.clearTimeout(sortie.current)
    sortie.current = null
  }, [])
  const entrer = useCallback(
    (conversationId: string) => {
      annuler()
      setId(conversationId)
    },
    [annuler]
  )
  const sortir = useCallback(() => {
    annuler()
    sortie.current = window.setTimeout(() => {
      sortie.current = null
      setId(null)
    }, DELAI_DE_SORTIE_MS)
  }, [annuler])
  // Démonté pendant une sortie en attente : le minuteur ne pose rien sur un composant parti.
  useEffect(() => annuler, [annuler])
  return { id, entrer, sortir }
}
