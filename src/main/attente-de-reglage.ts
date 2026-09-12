import type { ExecutionUsageSnapshot } from './execution-supervisor'

/**
 * ATTENDRE QU'UN APPEL ENCORE EN VOL SE REGLE — plutot que refuser la reprise a l'instant meme.
 *
 * Mesure du 2026-09-12 (journaux de tours) : « Reprise refusee : N appel(s) provider encore
 * actif(s) » revient 17 fois, c'est la famille d'echec d'orchestration la plus frequente (17 sur
 * 75 lancements). Le texte du refus dit LUI-MEME « Refus transitoire : l'appel en cours se regle
 * seul » et « La suite correcte est de relancer la MEME demande ». Autrement dit : le code connait
 * la reparation et la fait payer a l'utilisateur, qui doit retaper sa demande au tour suivant.
 *
 * On patiente donc, BORNE, en relisant les compteurs persistes. Ce qui ne change pas : passe le
 * plafond, le refus part inchange — il protege le budget contre deux transports qui depenseraient
 * le meme devis en parallele, et ce role-la reste entier.
 */

/** Plafond d'attente. Au-dela, l'appel « en vol » n'en est probablement plus un : on refuse. */
export const ATTENTE_MAX_MS = 60_000

/** Intervalle entre deux relectures du checkpoint. */
export const PAS_DE_RELECTURE_MS = 1_000

export interface OptionsAttenteDeReglage {
  /** Relit les compteurs PERSISTES. Absente, aucune attente n'a lieu (comportement historique). */
  relire?: () => ExecutionUsageSnapshot | undefined | Promise<ExecutionUsageSnapshot | undefined>
  attenteMaxMs?: number
  pasMs?: number
  /** Horloge injectable : les tests passent un no-op, la production dort vraiment. */
  sleep?: (ms: number) => Promise<void>
  maintenant?: () => number
  signal?: AbortSignal
  /** Observabilite : appele une fois si l'on a effectivement patiente. */
  onAttente?: (info: { appelsActifs: number; attenduMs: number; regle: boolean }) => void
}

const sommeilReel = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Rend l'etat budgetaire a utiliser pour la reprise : celui relu si l'appel s'est regle, sinon
 * l'etat de depart tel quel (et c'est alors l'appelant qui refuse, avec son message inchange).
 */
export async function attendreLeReglageDesAppels(
  depart: ExecutionUsageSnapshot | undefined,
  options: OptionsAttenteDeReglage = {}
): Promise<ExecutionUsageSnapshot | undefined> {
  const { relire } = options
  if (!depart || depart.activeCalls <= 0 || !relire) return depart
  const attenteMaxMs = options.attenteMaxMs ?? ATTENTE_MAX_MS
  const pasMs = Math.max(1, options.pasMs ?? PAS_DE_RELECTURE_MS)
  const sleep = options.sleep ?? sommeilReel
  const maintenant = options.maintenant ?? Date.now
  const debut = maintenant()
  const appelsActifs = depart.activeCalls
  let courant = depart
  while (maintenant() - debut < attenteMaxMs) {
    // Un Stop pendant l'attente rend la main tout de suite : le refus partira, pas un blocage muet.
    if (options.signal?.aborted) break
    await sleep(pasMs)
    let relu: ExecutionUsageSnapshot | undefined
    try {
      relu = await relire()
    } catch {
      // Checkpoint illisible a cet instant : on retente au pas suivant plutot que d'accuser.
      relu = undefined
    }
    if (!relu) continue
    courant = relu
    if (relu.activeCalls <= 0) {
      options.onAttente?.({ appelsActifs, attenduMs: maintenant() - debut, regle: true })
      return relu
    }
  }
  options.onAttente?.({ appelsActifs, attenduMs: maintenant() - debut, regle: false })
  return courant
}
