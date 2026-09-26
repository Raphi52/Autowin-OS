Demande du droit Git ForcePush sur le depot AutoWinOS

Depot : https://dev.azure.com/AmitelGTC/AutoWinOS/_git/AutoWinOS
Demandee une premiere fois le 2026-09-08 (raphael.vilain), RESTEE SANS SUITE.
Relancee le 2026-09-17 (vincent.fayolle) : le blocage s'est elargi de 2 branches a 45.

A QUI L'ADRESSER
Lecture des droits du depot le 2026-09-17 (API accesscontrollists, espace de noms
2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87) : une SEULE identite y a des droits propres,
cedric.tumelaire@amitel365.onmicrosoft.com (masque 228990, ForcePush compris). Tous les
autres comptes heritent de Contributors, qui n'inclut pas ce droit. C'est donc a lui, ou a
un administrateur du projet, que la demande doit aller — pas a l'equipe.

Et l'equipe ne peut pas se debloquer elle-meme : vincent.fayolle n'appartient qu'a
[AutoWinOS]\AutoWinOS Team et [RIG]\Judiciaire, aucun groupe d'administration (verifie le
2026-09-17, API graph/memberships). Cedric.tumelaire est, lui, dans Project Administrators.
Cette demande ne peut donc PAS etre honorree cote developpeur, quelle que soit la bonne
volonte : elle attend une action d'administration.

CE QUI EST BLOQUE
La suppression de 45 branches de sauvegarde devenues inutiles. Azure repond, aussi bien par
`git push` que par son API REST (`updateStatus: forcePushRequired`) :

  TF401027: You need the Git 'ForcePush' permission to perform this action.
  Details: identity cc64c155-2955-4895-86a9-debcecd74280\<compte>, scope 'branch'.

La liste des 45 branches et de leurs SHA est dans
docs/salvage/registre-branches-2026-09-17.md.

POURQUOI CE N'EST PAS RISQUE
Il ne s'agit pas de reecrire l'historique de main. Ce sont des branches de sauvegarde
creees automatiquement par notre outil, dont le contenu a ete compare etat contre etat
avec main : il est deja integralement en base. Leurs identifiants sont consignes dans des
fichiers versionnes du depot, donc chaque suppression reste reversible
(`git branch <nom> <sha>` puis `git push origin <nom>`).

Trois d'entre elles ont d'ailleurs pu etre supprimees le 2026-09-17 sans aucun droit
supplementaire : Azure accorde ForcePush au CREATEUR d'une branche, et celles-la avaient
ete poussees depuis ce poste. La regle bloquante ne protege donc rien ici — elle empeche
seulement de nettoyer ce qu'un autre poste a cree.

CONTEXTE
Le depot accumulait 89 branches de sauvegarde automatiques en 22 jours. Apres tri par
contenu, 44 ont ete retirees sans aucune perte. Les 45 restantes sont le reliquat et
bloquent la fin du nettoyage : ce que l'on voit dans le selecteur de branches, ce n'est pas
`git status`, c'est cette liste. Une regle de retention est dans le code pour que le stock
cesse de croitre (rapport horaire, `os.rapportRetention()`), mais elle RAPPORTE sans
supprimer cote serveur — precisement parce que ce droit manque.

DEMANDE
Au choix : accorder le droit ForcePush limite aux branches autowin/*, ou supprimer les 45
branches cote administration a partir du registre.
