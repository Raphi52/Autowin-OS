/**
 * REMPLIR LA ZONE DE SAISIE DEPUIS UNE PAGE INTERACTIVE (conv-1304, 2026-10-30).
 *
 * Un bouton de choix `#autowin-prompt` d'un bloc ```html-render ENVOIE son libelle
 * (bouton-prompt-html.ts) : ce qui part est ce qui est ecrit, le fil le garantit parce qu'aucun
 * script ne tourne dans ce bloc. Dans un bloc ```html-interactif, le code de la page tourne : il
 * pourrait envoyer autre chose que ce que l'utilisateur lit. Le choix y REMPLIT donc la zone de
 * saisie, sans rien envoyer — l'utilisateur relit le message et l'envoie lui-meme (Entree).
 *
 * Le fil fournit la fonction : la vue normale vise son composer, une fenetre de mosaique le sien.
 * Hors du fil (tests, autres vues), aucune fonction : la page en est avertie sous son cadre.
 */
import { createContext } from 'react'

export const RemplirSaisieDuFil = createContext<((texte: string) => void) | null>(null)
