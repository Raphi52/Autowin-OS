/**
 * LA RÉPONSE QUI PORTE UN BLOC DU FIL (conv-1147, 2026-10-25 — défaut D5 du juge).
 *
 * Le Markdown du fil ne reçoit que du texte (`memo` sur des primitives). La carte « Lancer en N
 * fils » tirait donc son souvenir « déjà lancée » de sa seule SOURCE : deux cartes au même
 * contenu, ou la même carte recopiée dans une branche du fil, partageaient ce souvenir. La seconde
 * se croyait lancée sans l'avoir été. ChatMessageRow pose ici l'identifiant de la réponse ; il est
 * unique dans toutes les conversations (`store/conversations.ts`, `nextUniqueMessageId`, et `fork`
 * qui en régénère de neufs). Un contexte traverse le `memo` du Markdown sans changer ses props.
 *
 * `null` = rendu hors d'un fil (aperçu, test) ; `''` = réponse encore en cours d'écriture, sans
 * identifiant définitif ; sinon, son `messageId`. Fichier sans composant (react-refresh).
 */
import { createContext } from 'react'

export const MessageDuFil = createContext<string | null>(null)
