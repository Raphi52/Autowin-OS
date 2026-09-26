<!-- RUN-template.md — copie ce fichier vers ~\.claude\runs\<session_id>\<sujet>-workspace\RUN.md
     (<session_id> = injecte a chaque tour par le hook UserPromptSubmit ; UN dossier par session ; le
     stop-gate v3.2 n'applique ses regles QU'aux runs de sa propre session). Repli : chemin plat s'il n'y a pas de session_id.
     Convention complete : _engine/ENGINE.md ch.3.
     Le hook Stop lit l'en-tete : open/rouge bloquent la fin de tour ; un green est REJOUE, jamais cru sur parole. -->
status: open
session: <session_id>       <!-- rattache le run a cette session (sinon l'emplacement <session_id>\ fait foi) -->
regime: standard            <!-- disposable | standard | critical — le curseur d'effort -->
signal: <l'artefact HORS-MODELE qui prouvera le green — p. ex. "test-x.ps1 exit 0", "capture lue", "requete SQL n>0">
signal-cmd: <facultatif mais puissant — commande IDEMPOTENTE que le gate REJOUERA via cmd /c ; prefixes sur liste blanche :
  dotnet test | dotnet build | cmd /c | powershell [-NoProfile] -File | pwsh [-NoProfile] -File —
  METS ENTRE GUILLEMETS tout chemin contenant des espaces, et joue-la toi-meme une fois avant de la declarer>
signal-attestable: <facultatif — preuve hors-modele NON rejouable (p. ex. "capture lue + empreinte de run", "requete SQL
  n>0 lue") ; en regime CRITICAL, elle satisfait l'exigence de preuve quand il n'y a ni signal-cmd ni check:>
gate: on                    <!-- on (defaut) | off — sortie de secours pour un run jetable : le hook Stop saute TOUT le gate sur une ligne `gate: off` (un `<!-- commentaire -->` en fin de ligne est tolere) dans les 14 premieres lignes (cf. stop-gate.ps1) -->

## Besoin
**Deep-why** : <le vrai probleme, pas la solution demandee>
**Scope IN** : <ce qui est couvert> / **Scope OUT** : <ce qui ne l'est pas, et pourquoi>
**Critere de succes (DoD cochable)** : les conditions de SORTIE, chacune verifiable + sa PREUVE — le judge la coche item par item ; une case a contenu reel NON cochee = item non tenu -> le **stop-gate BLOQUE le green** (deterministe, hors-modele) ; la PREUVE derriere une case cochee -> verifiee par **judge + humain** (le gate ne lit pas la substance). NE PAS recopier un signal/check : y POINTER. (disposable : une phrase suffit ; standard/critical : items, chacun avec une VRAIE preuve — pas de prose generique.) **Les `- [ ]` sous `## Besoin` sont RESERVEES a la DoD** ; risques / angles-morts / hypotheses en PROSE ou puces `-`, JAMAIS `- [ ]` (une case non-DoD bloquerait a raison comme condition non tenue ; le gate ne ferme le scope DoD que sur un heading `##` de niveau 2, pas sur `###`).
  - [ ] <condition de sortie 1> (preuve: <artefact / "cf. signal-cmd" / "cf. check:" / prose falsifiable>)
    > G/W/N (reco) : Given <etat initial> / When <action> / Then <resultat verifiable> — l'exemple FALSIFIABLE qui nourrit le red->green du build ; une case COCHEE dont la preuve reste un placeholder `(preuve: <...>)` -> le **stop-gate BLOQUE** (coche sans preuve nommee).
  - [ ] <condition de sortie 2> (preuve: ...)
**Clarifications** : une ambiguite NON resolue qui bloque le cadrage -> `[NEEDS CLARIFICATION: <quoi>]` ici meme (## Besoin). Tant qu'un marqueur a CONTENU REEL est present, le **stop-gate BLOQUE le green** (comme une case DoD non tenue) ; un placeholder `[NEEDS CLARIFICATION: <...>]` est ignore. Resous-la (reponse + retrait du marqueur) avant de clore.
**Decisions deliberees** : <les choix volontaires que la revue ne doit PAS re-signaler>
**Hypotheses annoncees** : <"je suppose X (fait : ...) — corrige-moi">

## Contraintes
<!-- frame ecrit les bornes de solution : plateforme/politique/dependances/budget/actions interdites.
     Chaque contrainte est HARD ou SOFT, nomme sa source, et enonce la consequence si elle est violee. Ne duplique pas le Scope OUT. -->
- [HARD|SOFT] <contrainte> (source: <fait / utilisateur / politique>; consequence: <ce qui casse ou doit s'arreter>)

## Options
<!-- si un choix d'approche est ENGAGE : >=3 options REELLEMENT distinctes et notees + une ligne Décision:
     (le gate controle a la cloture ; des options de paille = un defaut que le judge signalera) -->
- Option A — <desc> score: NN
- Option B — <desc> score: NN
- Option C — <desc> score: NN
Décision: <laquelle et pourquoi>

## SOP
<!-- terrain n'ecrit QUE la procedure operatoire propre a la tache : action -> commande/outil -> signal attendu ->
     repli ou condition d'arret. Renvoie a ENGINE Ch.4 pour la boucle de build generique ; ne la recopie pas ici. -->
1. <action> -> <commande/outil> -> <signal hors-modele attendu> -> <repli ou condition d'arret>

## Journal
<!-- ajout seul (append-only) : [ts] unit=<id> run=<stamp> VERIFIED|FAILED|FLAKY|CLAIM|PROOF|USER-OK -->

## Défauts
<!-- registre du judge : [gravite, statut] description — jamais efface, resolu ou accepte-avec-raison -->

## Reprise
Goal:
Hypothesis:
Tried:
Next:
Blockers:
Contexte gele (reco standard · OBLIGATOIRE critical) : fichiers touches · decisions actees · liens (RUN/commits/docs) — de quoi REPRENDRE sans le fil de session (anti context-collapse multi-session).

## Cicatrices
<!-- lecons du run (volatiles -> a traiter comme des HYPOTHESES) ; promeus-les en check: ou en memoire quand elles durent (ENGINE ch.3) -->

## Checks
<!-- lecons promues en code, EXECUTEES par le gate a chaque cloture : check: <commande, exit!=0 = bloque> -->
