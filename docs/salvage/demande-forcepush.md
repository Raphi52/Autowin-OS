Demande du droit Git ForcePush sur le depot AutoWinOS

Demandeur : raphael.vilain@amitel365.onmicrosoft.com
Depot : https://dev.azure.com/AmitelGTC/AutoWinOS/_git/AutoWinOS

CE QUI EST BLOQUE
La suppression de deux branches de sauvegarde devenues inutiles. Azure repond :

  TF401027: You need the Git 'ForcePush' permission to perform this action.
  Details: identity cc64c155-2955-4895-86a9-debcecd74280\raphael.vilain@amitel365.onmicrosoft.com, scope 'branch'.

Branches concernees :
  - autowin/safety/main-dismiss-20260903
  - autowin/secours/pc-20260901/main-ahead-11

POURQUOI CE N'EST PAS RISQUE
Il ne s'agit pas de reecrire l'historique de main. Ce sont des branches de
sauvegarde creees automatiquement par notre outil, dont le contenu a ete
compare etat contre etat avec main : il est deja integralement en base.
Leurs identifiants sont consignes dans deux fichiers versionnes du depot
(docs/salvage/registre-branches-autowin-2026-09-08.md et
registre-refs-autowin-2026-09-08.md), donc chaque suppression reste reversible.

CONTEXTE
Le depot accumulait 89 branches de sauvegarde automatiques en 22 jours. Apres
tri par contenu, 27 ont ete retirees sans aucune perte. Ces deux-la sont le
seul reliquat et bloquent la fin du nettoyage. Une regle de retention est
desormais dans le code pour que le stock cesse de croitre.

DEMANDE
Au choix : accorder le droit ForcePush limite aux branches autowin/*, ou
supprimer ces deux branches cote administration.
