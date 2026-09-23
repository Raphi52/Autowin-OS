# Prise en main d'Autowin OS

Pour démarrer en dix minutes. Les mots techniques sont traduits dans [`glossaire.md`](glossaire.md).
Ce que le produit fait vraiment, avec ses limites : [`features.md`](features.md).

## 1. Installer et lancer

1. Depuis le dossier du dépôt : `npm install` (installe les dépendances).
2. `npm run dev` lance l'application en mode développement.
3. Au moins un modèle IA doit être disponible sur le poste (par exemple le CLI Claude, déjà connecté).
   Le choix du modèle se fait dans l'onglet **Réglages**.

## 2. Poser une première demande

Écris dans le champ du **Chat** et envoie. Le titre de la conversation reprend le début de ton message
(80 caractères au plus).

- Une question simple reçoit une réponse directe.
- Une demande de travail (corriger, créer, vérifier) lance un **travail** : une ligne d'état apparaît
  tout de suite dans le fil — « Travail lancé : … » —, puis le travail avance dans une copie de
  travail séparée de ton dépôt. Rien n'arrive dans ton dépôt tant que le contrôle final n'a pas validé.
- Sous chaque réponse, le **coût du tour** s'affiche quand le modèle IA le fournit. S'il ne le fournit
  pas, rien n'est affiché : aucun chiffre n'est inventé.

## 3. Lire la fin d'un tour

Quand l'agent a agi, il termine par quatre rubriques : **✅ Fait**, **📍 Maintenant**,
**⏳ Reste à faire**, **👉 Recommandé**. La dernière propose une seule suite ; elle est pré-remplie en
grisé dans le champ, et **Tab** l'accepte.

## 4. Le mode auto

L'interrupteur **mode auto**, dans la barre de gauche, renvoie tout seul la suite recommandée à chaque
fin de tour. Chaque tour coûte de l'argent réel. Il s'arrête :

- quand l'agent écrit la ligne de fin explicite `AUTOWIN_FIN_V1` (invisible à l'affichage) ;
- quand la même suite est proposée deux fois de suite ;
- quand tu le désactives.

Le code de cette décision : `src/renderer/src/components/chat-auto-mode.ts`.

## 5. Suivre et contrôler

- **Workflows** : le détail d'un travail (étapes, preuves, verdict du contrôle final).
- **Observatory** : ce que chaque tour a consommé et ce qu'il a reçu en contexte.
- Rien n'est publié (commit, push, fusion) sans ta demande explicite.

## 6. Quand ça coince

- Un travail refusé par le contrôle final affiche son motif dans le fil ; le bouton **Relancer** le
  rejoue.
- Un tour interrompu se **reprend** d'un clic, sans retaper la demande.
- Pour les tours qui agissent sans rien écrire : [`tours-muets-etat-des-lieux.md`](tours-muets-etat-des-lieux.md).
