# Pourquoi un prompt sur cinq ne rend rien — état des lieux mesuré

> Écrit le 2026-08-14 pour qu'une session ultérieure reprenne sans refaire l'enquête.
> Mandat de l'utilisateur : « fais que lundi le chat puisse faire toutes les tasks que j'vais lui
> demander », après une journée où plusieurs tâches n'ont pas abouti.

## Ce qui a été MESURÉ (pas supposé)

Population complète du magasin de conversations, `.autowin-data/autowin-os/conversations.json`,
**5 022 messages d'assistant** :

| Statut | Nombre | Part |
| --- | ---: | ---: |
| `completed` | 4 787 | 95,3 % |
| `failed` | 137 | 2,7 % |
| `interrupted` | 63 | 1,3 % |
| `cancelled` | 34 | 0,7 % |
| `streaming` (figé) | 1 | 0,0 % |

**Les échecs déclarés ne sont donc PAS le sujet.** Un surveillant qui relancerait les tours morts
traiterait 0,02 % du problème.

Le chiffre qui compte :

> **1 013 tours sur 5 022 — 20,2 % — sont MUETS** : leur contenu ne comporte que des étiquettes
> `[a exécuté …]` et aucun texte. **La plupart sont marqués `completed`.**

Exemples relevés : `conv-1086` aligne des séries entières (`exec`, `judge`, `gate`, `exec`…) sans une
ligne de compte-rendu ; `conv-1178` et `conv-1167` idem sur `read_file` / `find_in_files`.

## Le diagnostic

Un tour muet marqué `completed` est un **label menteur** : l'application annonce une réussite là où
l'utilisateur n'a rien reçu d'exploitable. C'est la traduction exacte de sa plainte « 1 prompt = 1
réussite » — il ne peut même pas savoir que ça a raté.

C'est la même classe de faute que deux autres corrigées le même jour :

- le message d'échec de mise à jour accusait le travail non committé alors que git parlait de
  divergence de branche (corrigé : `diagnostiquerEchecMaj`, `src/main/git-update.ts`) ;
- le balayage annonçait « copies conservées » sans dire qu'elles l'étaient définitivement.

## Ce que le dépôt SAVAIT déjà

`src/main/agent-pilot.mute-turn.test.ts` documente le cas depuis le 2026-07-29 (conv-76 : trois
messages de 40 à 64 caractères, 18 appels de sous-agents pour 10,05 $, aucun texte de l'agent). Une
relance mécanique existe — `grantRecoveryIteration('muted-turn')` dans `src/main/index.ts` — et elle
est **bornée à une fois**.

**Les 20,2 % mesurés aujourd'hui prouvent qu'elle ne suffit pas.** C'est le point de départ, et le
piège à éviter : ajouter un second mécanisme par-dessus un premier dont on n'a pas compris l'échec.

## La prochaine étape, dans l'ordre

1. **Instrumenter avant de corriger.** Sur un tour muet, savoir laquelle est vraie :
   la relance n'est jamais déclenchée ? elle est déclenchée mais le modèle re-rend du vide ?
   le texte est produit puis perdu à l'affichage ou à la persistance ?
   Sans cette réponse, tout correctif est un pari.
2. **Distinguer muet-après-action et muet-tout-court.** Un tour qui a exécuté dix commandes sans
   conclure n'a pas le même défaut qu'un tour qui n'a rien fait du tout.
3. Seulement ensuite, corriger la cause nommée.

## Sûreté

Faire parler un tour qui a déjà agi est **sans risque** : on lui demande de rendre compte de ce qu'il
a fait, on ne rejoue aucune action. C'est ce qui distingue ce chantier d'un relanceur automatique,
lequel pourrait dupliquer une écriture ou une dépense déjà engagée — écarté pour cette raison.

## Contexte d'environnement à connaître

- L'arbre `C:\Amitel\Autowin OS` était posé sur la branche `autowin/recovery/run-e9bba61b1111-1`, ce
  qui bloquait toute mise à jour (divergence). Remis sur `main` le 2026-08-14.
- Le commit `36937cb` de cette branche de récupération porte un remaniement du composer (envoi unique,
  suppression de la file) **non terminé** : sa preuve CDP avait été faite contre un processus principal
  périmé, donc elle ne vaut rien. À reprendre en redémarrant l'application AVANT toute mesure.
- Plusieurs sessions écrivent dans cet arbre : committer dès qu'un correctif est vérifié.
