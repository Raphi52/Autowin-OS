---
name: clean
description: Contrôle avant la fin, entre build et judge, sur un livrable fonctionnellement vérifié. Deux temps : (1) retire les résidus laissés par CE run seulement — traces de débogage (log, sonde, drapeau d'essai), fichiers jetables (sauvegarde, sortie temporaire, script de mesure), code mort d'une piste abandonnée ; (2) passe les lignes écrites par ce run à la GRILLE QUALITÉ (conception, justesse, simplicité, tests, erreurs, nommage, commentaires, typage, cohérence, sécurité, ressources, documentation), corrige ce qui se corrige sans changer de comportement et liste le reste comme défaut pour judge. Rejoue la preuve après chaque retrait, consigne le rapport. À utiliser sur `$clean`, "nettoie avant de finir", "cherche les artefacts des essais ratés", "passe la grille qualité", automatiquement après un build/garde réussi et avant le judge final ou le vert du RUN, et après toute mutation post-judge qui invalide le verdict précédent.
---
# clean — retirer les traces du run, puis passer son code a la grille qualite

## Ce que tu produis
Un etat qui peut passer au jugement : plus aucune trace des essais, chaque ligne ecrite par le run
notee contre la grille qualite, le livrable intact, une preuve rejouee.

## Les six reflexes

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

5. **AU MOMENT ou les residus sont partis → passe les lignes du run a la GRILLE QUALITE.**
   Perimetre : les lignes ajoutees ou modifiees par CE run (`git diff` + fichiers crees), rien d'autre.
   Chaque critere de la grille ci-dessous recoit UN verdict :
   - ✅ + la preuve LUE (`fichier:ligne` ouvert, ou commande + code de sortie) ;
   - ❌ + `fichier:ligne` + la regle violee ;
   - « sans objet » + pourquoi (ex. aucune entree externe → Securite sans objet).
   Un ✅ sans preuve n'existe pas : ecris « non evalue ». Un gout sans regle violee n'est PAS un ❌ :
   un ❌ nomme un critere de la grille, une regle du lint ou une convention ecrite du depot.
   Puis tranche chaque ❌ :
   - corrigeable SANS changer de comportement et dans les lignes du run (nom, doublon introduit,
     constante magique, commentaire qui dit le quoi, imbrication aplatissable, typage force
     remplacable) → corrige-le comme un retrait du reflexe 4 : un a la fois, preuve rejouee ;
   - sinon (test absent, erreur avalee, cas limite non traite, faille) → tu ne le corriges PAS :
     changer un comportement, c'est BUILD. Liste-le en « ❌ restant » ; ton verdict d'etape devient
     « partiel » et judge le recoit tel quel. Un ❌ restant maquille en ✅ est un faux vert.

6. **AU MOMENT ou tu crois avoir fini → relis `git status` une derniere fois.**
   Un fichier suivi modifie hors du perimetre du livrable est un DEFAUT, meme s'il est plus propre.

## La grille qualite

Base : les criteres de revue de Google (https://google.github.io/eng-practices/review/reviewer/looking-for.html,
lu le 2026-10-21), completes par la sante du code exigee ici : aucun pansement, typage, securite, ressources.
Le haut du panier n'est pas un ressenti : c'est ZERO ❌ restant, chaque ✅ adosse a une preuve.

| Critere | Ce qui est exige | Comment le prouver |
|---|---|---|
| Conception | Le changement vit au bon endroit (la source unique du sujet), s'integre aux appels existants, ne duplique aucun existant | grep du role et du nom avant de conclure « nouveau » ; `fichier:ligne` de l'appelant |
| Justesse | Fait ce que la tache demande ; cas limites traites un a un : vide, absent/null, borne, erreur d'E/S, appel concurrent ou reentrant | chaque cas cite avec la ligne qui le traite, ou le test qui le couvre |
| Simplicite | Rien de plus que le besoin : ni parametre, ni abstraction, ni branche pour un usage futur ; une fonction = une idee ; imbrication aplatie par retour anticipe | lecture du diff ; chaque ajout relie a un point de la tache |
| Tests | Chaque comportement ajoute ou corrige a un test au site d'appel qui ROUGIT quand on reinjecte le defaut ; assertions precises ; aucun test desserre pour passer | le test, et la reinjection faite (pas supposee) avec son rouge |
| Erreurs | Aucun pansement : ni catch vide ou avale, ni valeur en dur qui masque, ni retry aveugle, ni delai allonge ; une erreur dit quoi et ou | `fichier:ligne` de chaque catch / repli du diff |
| Nommage | Chaque nom dit ce que la chose est ou fait, dans le vocabulaire du depot ; ni `tmp`, ni `data2`, ni abreviation obscure | lecture des noms introduits |
| Commentaires | Disent le POURQUOI et l'origine (date, `conv-NNN`), pas le quoi ; aucun commentaire devenu faux apres le changement | relecture des commentaires voisins des lignes touchees |
| Typage | Ni `any`, ni `as` force, ni `!` ou `@ts-ignore` sans commentaire qui le justifie ; typage vert | `npm run typecheck` + code de sortie |
| Coherence | Suit le style et les motifs du fichier voisin ; lint vert sur les fichiers touches ; aucun reformatage hors des lignes du run | lint des fichiers touches + code de sortie ; `git diff --stat` |
| Securite | Aucun secret en dur ; toute entree externe (fichier, reseau, modele, utilisateur) validee avant usage ; aucune commande, requete ou chemin construit par concatenation non echappee | `fichier:ligne` de chaque entree externe et de sa validation |
| Ressources | Pas de travail gaspille : rien de quadratique sur des donnees non bornees, pas d'E/S synchrone dans un chemin chaud, tout ecouteur, minuteur ou processus ouvert est libere | `fichier:ligne` de l'ouverture et de sa liberation |
| Documentation | Si le changement modifie la facon de construire, tester ou utiliser : doc, AGENTS.md ou README mis a jour | le fichier de doc touche, ou « sans objet » + pourquoi |

## Rapport (obligatoire)
Perimetre inspecte · Retire (chemin ou `file:line` + pourquoi c'est attribuable a ce run) ·
Conserve (chemin + pourquoi tu n'y as pas touche) · Grille qualite (tableau
`Critere | Verdict | Preuve`, puis la ligne `Grille : N ✅ · K ❌ restants · S sans objet`) ·
Preuve rejouee (commande exacte + resultat).
Pas de preuve rejouee citee = pas de nettoyage valide. Pas de grille = pas de clean.

## Interdits
Elargir au menage general du depot · changer un comportement · supprimer un fichier ambigu ·
reformater des fichiers non touches · declarer propre sur simple lecture · noter ✅ sans preuve ·
inventer un ❌ de gout · noter la dette anterieure au run.
