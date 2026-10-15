import { useEffect, useRef, useState } from 'react'
import { dureeLisible, secondesDe } from './thinking-block-corps'

/**
 * CHRONO A LA SECONDE D'UNE ACTION EN COURS.
 *
 * Signale le 2026-10-15 (conv-982) : « le timer de raisonnement s'actualise toutes les secondes et
 * celui de actions toutes les 5 ». La pastille de duree d'une action en cours (orchestration,
 * verify) n'est pas une horloge : c'est le debut du TEXTE du battement que le processus principal
 * envoie toutes les `VERIFY_BATTEMENT_MS` (5 s, src/main/verify-battement.ts). Entre deux
 * battements, rien ne la faisait avancer — pendant que « Raisonnement », a cote, avancait a 1 s.
 *
 * Le battement reste la SOURCE de la duree (le processus principal connait le vrai depart de
 * l'action, l'ecran non). L'ecran en deduit seulement un depart estime (`recalerAncre`) et avance
 * a partir de lui chaque seconde, comme le bloc Raisonnement. On ne multiplie pas les battements :
 * cinq fois plus d'evenements entre processus pour un chiffre que l'ecran sait compter seul.
 */

/**
 * Au-dela de cet ecart entre le depart deja estime et celui qu'annonce un nouveau battement, ce
 * n'est plus du bruit (arrondi a la seconde du processus principal, latence de l'evenement) : c'est
 * une autre horloge — une autre action du groupe, ou un ecran fige qui se reveille.
 */
const ECART_DE_RECALAGE_MS = 2_000

/**
 * Depart estime de l'action : `recuA - secondes`. Tant que les battements concordent, on garde le
 * depart le plus ANCIEN : le chiffre affiche ne recule donc jamais d'une seconde quand un battement
 * arrive un peu en retard sur le tic de l'ecran.
 */
export function recalerAncre(ancre: number | undefined, secondes: number, recuA: number): number {
  const estimee = recuA - secondes * 1000
  if (ancre === undefined || Math.abs(estimee - ancre) > ECART_DE_RECALAGE_MS) return estimee
  return Math.min(ancre, estimee)
}

/**
 * La duree a afficher pour `duree` (« 4 min 12 s », tiree du battement), avancee chaque seconde
 * tant que l'action est `vivante`. Une action finie, ou un texte qui ne commence pas par une duree,
 * rend la duree telle quelle : aucun chiffre invente.
 */
export function useDureeVivante(duree: string | undefined, vivante: boolean): string | undefined {
  const ancreRef = useRef<number | undefined>(undefined)
  // Dernier chiffre compte par l'ecran, et le battement dont il part. Ecrit SEULEMENT par le tic,
  // jamais pendant le rendu.
  const [compte, setCompte] = useState<{ pour: string; secondes: number } | null>(null)
  useEffect(() => {
    const secondes = duree ? secondesDe(duree) : null
    if (!duree || !vivante || secondes === null) {
      ancreRef.current = undefined
      return
    }
    const ancre = recalerAncre(ancreRef.current, secondes, Date.now())
    ancreRef.current = ancre
    // Tic CALE sur les secondes de l'ancre : un setInterval libre pourrait sauter ou doubler une
    // seconde quand son phasage tombe pres de la frontiere.
    const prochain = (t: number): number => 1000 - ((t - ancre) % 1000)
    let minuteur = 0
    const battre = (): void => {
      const t = Date.now()
      setCompte({ pour: duree, secondes: Math.floor((t - ancre) / 1000) })
      minuteur = window.setTimeout(battre, prochain(t))
    }
    minuteur = window.setTimeout(battre, prochain(Date.now()))
    return () => window.clearTimeout(minuteur)
  }, [duree, vivante])
  const secondes = duree ? secondesDe(duree) : null
  if (!duree || !vivante || secondes === null) return duree
  if (!compte) return duree
  // Compte parti de CE battement : il le prolonge. Compte d'un battement precedent (nouveau
  // battement arrive, premier tic pas encore passe) : il ne sert qu'a ne pas faire RECULER le
  // chiffre d'une seconde, et seulement s'il raconte la meme horloge.
  const prolonge =
    compte.pour === duree ||
    (compte.secondes > secondes && (compte.secondes - secondes) * 1000 <= ECART_DE_RECALAGE_MS)
  return prolonge ? dureeLisible(Math.max(secondes, compte.secondes)) : duree
}
