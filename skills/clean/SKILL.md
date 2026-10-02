---
name: clean
description: Contrôle de nettoyage avant la fin, entre build et judge. Inspecte un livrable fonctionnellement vérifié : trois familles de résidus laissés par CE run seulement — traces de débogage (log, sonde, drapeau d'essai), fichiers jetables (sauvegarde, sortie temporaire, script de mesure) et code mort d'une piste abandonnée (helper sans appelant, TODO du run, bloc commenté), sans refactor ni changement de comportement ; ne nettoie que les éléments sûrs et attribuables à ce run, rejoue le signal principal et les tests voisins, consigne la preuve dans le rapport (texte rendu), puis passe l'état nettoyé à judge. À utiliser sur `$clean`, "nettoie avant de finir", "cherche les artefacts des essais ratés", "faut-il refactorer avant validation", automatiquement après un build/garde réussi et avant le judge final ou le vert du RUN, et après toute mutation post-judge qui invalide le verdict précédent.
---
# clean — retirer les traces du run, sans toucher au reste

## Ce que tu produis
Un etat qui peut passer au jugement : plus aucune trace des essais, le livrable intact, une preuve rejouee.

## Les cinq reflexes

1. **AU MOMENT ou tu commences → rejoue la preuve AVANT de toucher a quoi que ce soit.**
   Note la commande et son code de sortie. Rouge → tu ne nettoies pas, tu le dis et tu t'arretes.

2. **AU MOMENT ou tu inventories → ne regarde que ce que CE run a touche.**
   Deux axes, pas un : `git status --porcelain` ET `git status --porcelain --ignored -uall`
   (un residu range dans un chemin ignore n'apparait QUE la), plus un balayage des fichiers
   modifies depuis le debut du run. Puis lis le diff. Trois familles seulement :
   trace de debug (log, sonde, drapeau d'essai), fichier jetable (sauvegarde, sortie temporaire,
   script de mesure), code mort d'une piste abandonnee (helper sans appelant, TODO du run, bloc commente).
   Tout le reste — dette anterieure, fichier que tu n'as pas cree, fichier non suivi dont tu ignores
   l'auteur — n'est PAS de ton ressort.

3. **AU MOMENT ou tu hesites sur un fichier → tu le GARDES.**
   Un fichier ambigu conserve coute zero ; un fichier de l'utilisateur supprime coute le run.
   Ecris-le dans « Conserve » avec la raison. Le doute ne se tranche pas par la suppression.

4. **AU MOMENT ou tu retires quelque chose → un retrait, puis la preuve.**
   Un seul retrait a la fois, puis relance la commande de preuve. Rouge → tu annules CE retrait
   (edition ciblee, jamais un reset large) et tu l'ecris comme echec.
   A la fin, rejoue AUSSI la suite voisine par PREFIXE de dossier (un glob), jamais par liste
   tapee a la main : une liste manuelle oublie des fichiers en silence. Cite le nombre de fichiers
   et de tests obtenu.

5. **AU MOMENT ou tu crois avoir fini → relis `git status` une derniere fois.**
   Un fichier suivi modifie hors du perimetre du livrable est un DEFAUT, meme s'il est plus propre.

## Rapport (obligatoire)
Perimetre inspecte · Retire (chemin ou `file:line` + pourquoi c'est attribuable a ce run) ·
Conserve (chemin + pourquoi tu n'y as pas touche) · Preuve rejouee (commande exacte + resultat).
Pas de preuve rejouee citee = pas de nettoyage valide.

## Interdits
Elargir au menage general du depot · changer un comportement · supprimer un fichier ambigu ·
reformater des fichiers non touches · declarer propre sur simple lecture.
