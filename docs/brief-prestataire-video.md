# Autowin OS — brief pour la production des vidéos commerciales

> Document destiné au prestataire vidéo. Chaque capacité listée existe dans le produit aujourd'hui.
> Les points marqués « limite » ne doivent pas être montrés comme plus aboutis qu'ils ne le sont.

## 1. En une phrase

**Autowin OS est un cockpit qui fait travailler des agents d'intelligence artificielle sur vos projets,
les surveille en direct, et n'accepte un résultat que s'il est prouvé.**

Accroches possibles :
- « Vos agents IA travaillent. Autowin vérifie. »
- « Plusieurs IA, un seul poste de pilotage. »
- « Pas de "c'est fait" sans preuve. »

## 2. Pour qui, pour quel problème

- **Cible** : équipes de développement et d'exploitation qui utilisent déjà des IA (Claude, ChatGPT/Codex, Kimi…).
- **Problème** : une IA seule annonce souvent « terminé » sans l'avoir vérifié, travaille dans votre dossier
  au risque de tout casser, et on ne sait pas ce qu'elle a fait ni combien elle a coûté.
- **Réponse Autowin** : un chef d'orchestre qui découpe le travail, le fait faire dans une copie à part,
  le fait contrôler par un juge indépendant, et trace tout.

## 3. Ce que fait le produit — les capacités à montrer

### Parler à l'agent, qui répond ET agit
- Un **chat en français** : on décrit ce qu'on veut, l'agent répond ou passe à l'action.
- L'agent **pilote l'application lui-même** : il ouvre des vues, lance des travaux, crée des conversations.
- Chaque fin de tour se termine par 4 rubriques claires : **✅ Fait · 📍 Maintenant · ⏳ Reste à faire · 👉 Recommandé**.
- La suite recommandée est **pré-remplie** dans le champ de saisie : une touche (Tab) pour l'accepter.
- **Mode auto** : l'agent enchaîne seul les étapes, et s'arrête de lui-même quand le travail est fini.
- Réponses **mises en page** (tableaux, schémas, comparatifs) directement dans la conversation.

### Plusieurs IA, un seul poste
- **Claude, Codex/ChatGPT, Kimi** interchangeables ; architecture ouverte à d'autres modèles.
- Un modèle différent **par rôle** : celui qui organise, celui qui exécute, celui qui juge.
- **Panels de modèles** : plusieurs IA analysent la même question, leurs avis sont fusionnés.

### Un travail discipliné, étape par étape
- Un parcours de travail : **explorer → cadrer → préparer → construire → nettoyer → juger**.
- Des profils prêts à l'emploi : *Éclair* (question rapide), *Correctif*, *Feature*, *Chantier*,
  *Panel critique*, *Exploration*, *Remake*.
- L'application **choisit le bon profil** selon la demande — ou répond directement si c'est simple.
- **Le juge ne corrige jamais ce qu'il juge** : il est séparé de celui qui produit.
- Si le juge refuse, le travail **repart en correction** automatiquement (2 reprises maximum).

### La preuve avant le « c'est fait »
- Autowin **rejoue lui-même les tests** au lieu de croire l'IA sur parole.
- Des garde-fous inscrits dans le code (et non dans une consigne que l'IA pourrait ignorer)
  bloquent un « terminé » sans preuve.
- **Rien n'est publié** (envoi du code, fusion) sans la demande explicite de l'utilisateur.

### Travailler sans risque pour le projet
- Chaque agent travaille dans **sa propre copie du projet** : plusieurs agents en parallèle, sans collision.
- Le travail n'arrive dans le projet réel **qu'après validation** ; les conflits sont détectés.
- **Récupération du travail perdu** : Autowin retrouve les modifications abandonnées ou jamais fusionnées.

### Tout voir : l'Observatory
- Ce que chaque agent a envoyé, reçu, « pensé », et ses échecs — en direct.
- **Coût par tour et par modèle** affiché (jamais inventé quand le fournisseur ne le donne pas).
- Rétrospective d'une conversation : ce qui a été tenté, ce qui a échoué, ce qui a coûté.

### Une mémoire d'équipe
- Le **Brain** : une base de connaissances partagée (décisions, leçons, contraintes).
- L'agent **retient** ce qu'il apprend et le **relit** avant de conseiller.
- Stockée en fichiers texte versionnés : portable, sans enfermement chez un éditeur.

### Connecté au quotidien de l'équipe
- **Tickets** : lecture, recherche, création et mise à jour des fiches de travail.
- **Traitement en masse** : jusqu'à 3 tickets traités en parallèle, une conversation par ticket.
- **Bases de données en lecture seule** pour constater un paramétrage.
- **Vue du code source** : branche, changements, différences, historique — chaque action prépare une demande à l'agent.
- **Applications Windows** : l'agent peut ouvrir et utiliser une application dans un bureau caché,
  sans toucher à l'écran de l'utilisateur ; une petite fenêtre montre ce qu'il fait en direct.

### Des « skills » : des savoir-faire prêts à l'emploi
Exemples à citer : **scout** (trouver quoi améliorer), **build** (réparer un défaut), **judge** (audit critique),
**salvage** (récupérer le travail perdu), **kaizen** (améliorer le comportement de l'IA),
**heal** (soigner une base de code), **arena** (mesurer le meilleur workflow pour une tâche).

### Robuste et souverain
- Fermer la fenêtre **n'arrête pas** les travaux en cours (l'app reste dans la barre système).
- Mises à jour en un clic.
- **Vous possédez le code de votre outil** : local, modifiable, souverain.

## 4. Scénarios de démonstration suggérés

1. **« Corrige ce bug »** : la demande dans le chat → le travail démarre dans une copie séparée →
   les tests sont rejoués → le juge valide → récapitulatif ✅ Fait.
2. **Le juge qui dit non** : un résultat refusé, renvoyé en correction, puis accepté.
3. **Trois tickets d'un coup** : traitement en masse, trois conversations en parallèle.
4. **Observatory** : on ouvre le détail d'un travail, on voit chaque étape et son coût.
5. **Panel de modèles** : Claude et Codex donnent leur avis, Autowin synthétise.

## 5. Écrans disponibles

Captures existantes dans `docs/screenshots/` : `chat.png`, `observatory.png`, `settings.png`.
Vues principales de l'application : **Chat, Workflows (runs), Observatory, Mémoire (Brain), Réglages**.

## 6. Ce qu'il ne faut PAS promettre dans les vidéos

- Pas de « zéro erreur » ni d'« IA infaillible » : Autowin **réduit** les faux succès, il les rend visibles.
- Pas de reprise automatique après un arrêt brutal de l'ordinateur (en cours de développement).
- Pas d'installateur grand public : distribution actuelle par copie du dépôt.
- La correction rapide hors parcours complet exige un projet qui déclare ses tests.
- Ne pas montrer de données réelles de clients ou de bases de production à l'écran.
- Les coûts affichés dépendent des fournisseurs d'IA ; ne pas annoncer de chiffre d'économie non mesuré.
