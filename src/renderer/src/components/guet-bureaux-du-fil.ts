/**
 * LE FIL LANCE UN BUREAU CACHÉ (2026-10-31) : « ça remplace le bloc qui s'affichait dans le chat ».
 * Depuis le 2026-11-19, chaque lancement ajoute 1 au petit chiffre rouge de l'icône écran au lieu
 * d'ouvrir le panneau (« au lieu de m'ouvrir le panel, ça doit me mettre un petit 1 rouge »).
 *
 * Le guet de l'ancien bloc du fil, sans son image : la seule liste des bureaux de CE fil, et
 * de toute sa super conv : un lot ouvre son bureau dans son propre fil, pas dans celui qu'on regarde.
 * Un lanceur écrit une fiche sur disque, quel que soit le chemin (outil, script, run) : aucune action
 * de l'agent ne prévient l'interface, c'est donc cette liste qui dit qu'un bureau vient de naître.
 *
 * Rythme : une lecture toutes les 5 s, attente doublée après chaque échec, 60 s au plus.
 * Chaque liste peut relancer PowerShell côté principal (boucle du 21/10 : 120,2 s figées).
 *
 * Un hook et pas un état de ChatView : une lecture sans nouveauté ne re-rend pas tout le fil.
 */
import { useEffect, useRef } from 'react'
import type { BureauTv } from '../../../main/bureau/hdesk-tv'

export interface GuetBureauxApi {
  hdeskTvBureaux: (conversationId?: string) => Promise<BureauTv[]>
}

export const GUET_MS = 5000
export const ATTENTE_ECHEC_MAX_MS = 60000

/**
 * Sans cette borne, chaque redémarrage de l'app rallumerait le chiffre pour un bureau d'hier dès qu'on
 * ouvre son fil : la mémoire ci-dessous ne survit qu'à la session, et ce bureau n'a rien de « lancé ».
 */
const OUVERTURE_APP = Date.now()

/*
 * Dans sessionStorage et pas en mémoire du composant : ChatView se recharge à chaud, et un
 * bureau déjà compté ne doit pas rallumer le chiffre : seul un NOUVEAU lancement le fait.
 */
const CLE_STOCKAGE = 'autowin.bureaux-du-fil.vus'

function lireVus(): Record<string, string[]> {
  try {
    const brut = JSON.parse(globalThis.sessionStorage?.getItem(CLE_STOCKAGE) ?? '{}')
    return brut && typeof brut === 'object' ? (brut as Record<string, string[]>) : {}
  } catch {
    // Stockage illisible : au pire un bureau récent est compté une fois de plus.
    return {}
  }
}

function ecrireVus(vus: Record<string, string[]>): void {
  try {
    globalThis.sessionStorage?.setItem(CLE_STOCKAGE, JSON.stringify(vus))
  } catch {
    // Stockage indisponible : la mémoire vaut alors jusqu'à la lecture suivante seulement.
  }
}

/** La date en plus de l'identifiant : un agent qui relance dans le même bureau lance à nouveau. */
const cleDuLancement = (b: BureauTv): string => `${b.id}|${b.lanceLe ?? ''}`

/**
 * Retient la liste lue et rend les lancements jamais encore vus, du plus récent au plus ancien
 * (l'ordre de fusionnerBureaux, hdesk-tv.ts) : chacun compte pour un dans le chiffre de l'icône.
 */
function noterLecture(
  conversationId: string,
  liste: readonly BureauTv[],
  depuis: number
): BureauTv[] {
  const vus = lireVus()
  const connus = new Set(vus[conversationId] ?? [])
  const lances = liste.filter(
    (b) => !connus.has(cleDuLancement(b)) && Date.parse(b.lanceLe ?? '') >= depuis
  )
  if (liste.some((b) => !connus.has(cleDuLancement(b)))) {
    ecrireVus({
      ...vus,
      [conversationId]: [...connus, ...liste.map(cleDuLancement)]
    })
  }
  return lances
}

/**
 * Pur : les fils dont le panneau montre les bureaux. Le fil affiché, et s'il appartient à une super
 * conv, son chef et les lots qui y ont un onglet. Vide sans fil ouvert.
 */
export function filsDuPanneau(
  fil: string | null,
  chef: string | null,
  liens: ReadonlyMap<string, { chef: string; onglet: boolean }>
): string[] {
  if (!fil) return []
  if (!chef) return [fil]
  const lots = [...liens].filter(([, l]) => l.chef === chef && l.onglet).map(([id]) => id)
  return [...new Set([chef, fil, ...lots])]
}

export interface OptionsGuet {
  /** Faux = rien n'est lu : la vue chat n'est pas à l'écran. Au retour, la lecture repart aussitôt. */
  actif: boolean
  /** Les fils à guetter (filsDuPanneau). */
  fils: readonly string[]
  onBureauLance: (bureau: BureauTv, conversationId: string) => void
  api?: GuetBureauxApi
  /** Instant avant lequel un bureau n'est pas « lancé » : l'ouverture de l'app. */
  depuis?: number
}

export function useGuetBureauxDuFil({
  actif,
  fils,
  onBureauLance,
  api,
  depuis = OUVERTURE_APP
}: OptionsGuet): void {
  const rappelRef = useRef(onBureauLance)
  useEffect(() => {
    rappelRef.current = onBureauLance
  })

  // La clé et pas le tableau : ChatView peut rendre un tableau neuf aux mêmes fils.
  const cleFils = fils.join('\n')

  useEffect(() => {
    const cible = api ?? (window as unknown as { api?: Partial<GuetBureauxApi> }).api
    if (!actif || !cleFils || !cible?.hdeskTvBureaux) return
    const lireListe = cible.hdeskTvBureaux
    let vivant = true
    let echecs = 0
    let minuterie: ReturnType<typeof setTimeout> | null = null

    const tour = async (): Promise<void> => {
      if (typeof document === 'undefined' || !document.hidden) {
        try {
          // L'une après l'autre : un fil sans fiche ne coûte aucun PowerShell, et une
          // lecture de plus ne part pas pour un fil que l'écran vient de quitter.
          for (const fil of cleFils.split('\n')) {
            const liste = await lireListe(fil)
            if (!vivant) return
            for (const lance of noterLecture(fil, liste, depuis)) rappelRef.current(lance, fil)
          }
          echecs = 0
        } catch {
          // Une liste en échec n'annonce rien : elle espace seulement la suivante.
          echecs++
        }
      }
      if (!vivant) return
      const attente = echecs ? Math.min(GUET_MS * 2 ** (echecs - 1), ATTENTE_ECHEC_MAX_MS) : GUET_MS
      minuterie = setTimeout(() => void tour(), attente)
    }
    void tour()
    return () => {
      vivant = false
      if (minuterie) clearTimeout(minuterie)
    }
  }, [actif, api, cleFils, depuis])
}
