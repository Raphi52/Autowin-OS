/**
 * Titre d'une nouvelle conversation, tiré de son premier message.
 *
 * La règle vit dans `shared/titre-automatique.ts` depuis que le stockage RETITRE le fil à chaque
 * message de l'utilisateur (conv-999, 2026-10-16) : une seule définition, pour que le titre de
 * création et celui des messages suivants ne divergent pas.
 */
export {
  TITRE_CONVERSATION_MAX,
  titreDepuisMessage as titreDepuisPremierMessage
} from '../../../shared/titre-automatique'
