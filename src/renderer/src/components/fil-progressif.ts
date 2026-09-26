import { useEffect, useState } from 'react'

/**
 * RENDRE UN LONG FIL PAR TRANCHES — cause des gels `vue-chat` (gels.jsonl : 859 gels, p95 ≈ 10 s).
 *
 * Mesuré le 2026-09-18 : ouvrir conv-526 (164 messages, 1,3 Mo) rendait tout le fil dans UN SEUL
 * rendu React, 3,3 s pendant lesquelles la fenêtre ne répond plus. Une mise à jour en streaming,
 * elle, ne coûte que 2 ms : le gel vient bien de l'OUVERTURE du fil, pas du flux.
 *
 * On rend d'abord la fin du fil (ce que l'utilisateur regarde), puis on remonte d'une tranche par
 * tâche : entre deux tranches, la fenêtre peint et traite les clics.
 */
export const TRANCHE_FIL = 12

/** Premier index rendu du fil identifié par `cle` (une conversation) de `total` messages. */
export function useDebutProgressif(cle: string | null, total: number): number {
  const depart = { cle, total, debut: Math.max(0, total - TRANCHE_FIL) }
  const [etat, setEtat] = useState(depart)
  // Autre fil, OU fil chargé d'un bloc (plus d'une tranche d'un coup : relecture du store, fil
  // d'abord vide puis rempli) : on repart de sa fin, DANS ce rendu. Le streaming, lui, n'ajoute
  // qu'un message à la fois et garde le début courant.
  const recharge = etat.cle !== cle || total - etat.total > TRANCHE_FIL
  const courant = recharge ? depart : etat.total === total ? etat : { ...etat, total }
  if (courant !== etat) setEtat(courant)
  const debut = Math.min(courant.debut, total)

  useEffect(() => {
    if (debut <= 0) return
    const minuteur = setTimeout(() => {
      setEtat((e) => (e.cle === cle ? { ...e, debut: Math.max(0, e.debut - TRANCHE_FIL) } : e))
    }, 0)
    return () => clearTimeout(minuteur)
  }, [cle, debut])

  return debut
}
