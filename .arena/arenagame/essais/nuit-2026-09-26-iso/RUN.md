## m0

L'améliorateur passe en premier, sur la source déjà notée `essais/nuit-2026-09-26/m2`. Bras extraits de `m2.bras.tar` dans
`m0/ameliore/moi/`. La sonde de tenue est dans `m0/ameliore/moi/sonde/<bras>/tenue2.luau` : c'est celle de m1, rejouée sous
lune 0.10.5.

### Notes de m2 (check.mjs, auto /52) et coûts (`total_cost_usd` de `out-<bras>.json`, 1 reprise pour les 4 bras)
| bras | note | règles | équilibrage | $ | tours | modelUsage, 2e segment (cumulé) | échecs check.mjs |
|---|---|---|---|---|---|---|---|
| A (B12) | **51,5** | 35/35 | 9,5 | 8,85 | 100 | Opus 8,65 (sortie 194 k, relu 14,1 M) + Haiku 0,20 | géant 61,0 %, gobelins 55,2 % |
| B (B14) | 51,2 | 34/35 | **9,6** | **6,41** | 64 | Opus 6,28 (sortie 157 k, relu 6,7 M) + Haiku 0,14 | « destruction du roi : trois couronnes et fin : J1 ne gagne pas en attaquant seul » |
| C (C14) | 51,2 | 34/35 | **9,6** | 8,39 | 108 | Opus 8,23 (sortie 173 k, relu 13,8 M) + Haiku 0,16 | la même |
| X (nu) | 50,0 | 34/35 | 8,4 | 8,80 | 18 | Opus 8,80 (sortie 228 k, relu 8,1 M) | « les tours tirent sur les unités » ; boule de feu 31,3 %, mini P.E.K.K.A 66,7 % |

### Gagnant et A de la prochaine manche : **A = B12, imposé par l'humain**
`sys-a.txt` sera la copie exacte de `nuit-2026-09-25/m6/sys-b.txt` (SHA-256 760784C0…). C'est le script qui l'écrit, pas moi. La
règle d'adoption aboutit au même A :
- 2 points : non (B et C à −0,3).
- 30 % : non. B est à −0,3 point, mais seulement 27,6 % moins cher (6,41 contre 8,85 $). C est 5 % moins cher.
- Lignée : non. B13 puis B14 ont une note inférieure à A dans les 2 manches (51,3 contre 51,6, puis 51,2 contre 51,5), même s'ils
  coûtent moins les deux fois. La lignée C a aussi une note inférieure les deux fois.

**`sys-b.txt` (B15) et `sys-c.txt` (C15) sont des variantes de CE texte** : B12 octet pour octet (324 lignes, préfixe vérifié),
plus un bloc final.

### Ce que disent les échecs
B14 et C14 ont perdu 0,4 point chacun sur la même règle. **La cause est une règle écrite par l'améliorateur de m1**, « le roi
tient au moins 90 s ET au moins 8 poses ». Elle a été fondée sur le seul b-1 de m1, qui tenait 95 à 155 s. Pour la tenir :
- b-1 a monté son roi à 7 000 pv et 300 dégâts (`b-1/src/shared/Partie.luau:29`). Son RUN.md l. 63 : « Tours réglées pour la tenue
  B14 ».
- c-1 a monté son roi à 6 000 pv et 200 dégâts (`c-1/src/shared/Partie.luau:24`).

Sonde rejouée (J1 pose en (9, 10) sa première troupe payable, J2 passif, 8 graines) :
| bras | roi adverse tombé | poses | check.mjs |
|---|---|---|---|
| a-1 m2 | 64 à 118 s | 7 à 14 | 35/35 |
| b-1 m2 | 114 à 179 s, **jamais sur la graine 6** | 13 à 27 | rouge |
| c-1 m2 | 89 à 152 s, **jamais sur la graine 8** | 10 à 26 | rouge |
| x-1 m2 | 42 à 130 s | 5 à 17 | autre règle |

a-1, qui fait 35/35, raterait la règle de m1 sur 7 graines sur 8. Il fallait une borne haute, et la règle n'en avait pas.

### Hypothèse de B15 (texte)
B12, plus les points 2 à 5 de B14 : favori de banc qui n'attend jamais, visées de B12, au plus 4 passes, verdict qui suit le
correcteur. Ces points ont donné 9,6 en équilibrage pour 28 % de coût en moins. Le point 1 de B14 est remplacé par une tenue
bornée des deux côtés. Sur chaque graine, le roi TOMBE et J1 gagne, avant 155 s, après au moins 7 poses, avec une visée de 60
à 120 s. D'où viennent les bornes :
- a-1 m2 (35/35) : 64 à 118 s, 7 à 14 poses (`a-1/src/shared/Partie.luau:22`, `:33-34`) ;
- b-1 m1 (35/35) : jusqu'à 155 s ;
- a-1 m1, qui a perdu le cycle parce que la partie était finie : 5 poses.

Prédiction : 35/35, équilibrage ≥ 9,6, total ≥ 51,6, ≤ 6,5 $, ≤ 70 tours. Sous 6,20 $ (−30 % de 8,85), la règle des 30 % jouerait.

### Hypothèse de C15 (outil / procédure)
Un plafond écrit en texte ne tient pas :
- c-1 a fait 7 passes malgré « au plus 4 » (son RUN.md l. 75) ;
- a-1 en a fait 14, sans plafond.

Ces tours se paient en relecture : 14,1 M et 13,8 M jetons contre 6,7 M chez b-1 (4 passes). C15 = B12, plus deux outils :
- la porte de C14, corrigée à deux bornes (mêmes bornes et mêmes lignes que B15) ;
- `tools/passe.ps1`, seul lanceur du banc. Il refuse la 5e passe en code 1 et écrit lui-même la ligne « Passe n » dans le
  RUN.md.

Prédiction : exactement 4 lignes « Passe », ≥ 51,6, ≤ 6,5 $, ≤ 70 tours.

Règles de jeu chiffrées ou géométriques ajoutées : les seules sont les bornes de tenue (155 s, 7 poses, visée 60 à 120 s). Elles
sont passées par a-1 m2 (35/35) aux lignes citées et mesurées par la sonde. Les autres chiffres sont des bandes et des budgets
de banc repris de B12 et B14.

### Causes Autowin OS repérées
1. `.arena/arenagame/nuit.sh:29` (prompt de l'améliorateur) exige « la ligne d'un bras qui passe le test ». L'améliorateur de m1
   l'a respectée : b-1 m1 passait bien. Mais la règle ne demande pas de vérifier que les AUTRES bras qui passent tiennent le
   seuil. Un seuil à une seule borne, tiré d'un seul bras, a donc coûté −0,4 à B et à C. Piste, non appliquée (hors de mon
   périmètre) : exiger que le seuil soit tenu par TOUS les bras qui passent le test dans la manche citée, et qu'une règle de
   durée ait ses deux bornes.
2. `.arena/arenagame/clore-run.mjs:280-300` recopie bien `status_bras:` depuis la correction (a-1 m2 : `status_bras: red`,
   RUN.md l. 4). En revanche, les RUN.md de b-1 (clos à 09:09) et de c-1 (09:11) ont été clos AVANT la correction. Leur verdict
   déclaré est perdu, et la note « preuve honnête » de ces deux bras n'est plus calculable.
3. `.arena/arenagame/lance-bras.sh:67-74` colle toujours CLEAN et JUDGE en entier : `sys-effectif-b-1.txt` fait 80 710 octets
   pour un `sys-b.txt` de 44 059. C'est déjà signalé en m0 et m1 de nuit-2026-09-26. Les 3 bras ont suivi la l. 77 (un seul juge
   `haiku`).
4. Plafond de passes non tenu par c-1 (7 passes pour 4 prévues). Aucune ligne d'Autowin OS ne le produit : c'est une consigne
   de texte sans garde-fou. C15 teste l'outil qui la ferait tenir. Non localisée dans Autowin OS.

### Note de l'orchestrateur (conv-826, 09:45) — réserve pour la comparaison
Première nuit à bras ISOLÉS. En m1, une interdiction trop large de `lance-bras.sh` a refusé à tort une commande de c-1 :
`PowerShell(*claude*runs*)` a reconnu `$env:CLAUDE_SESSION_ID` suivi du chemin de SA propre racine `…\runs` (la
correspondance ignore la casse). Corrigé à 09:44 en `*.claude*runs*` / `*.claude*projects*`, dans `lance-bras.sh`
(modification de même longueur en octets : les 4 lance-bras.sh de m1 lisaient le script) et dans les
`m1/isolement-*.json` ; non vérifié que les sessions déjà ouvertes relisent ce fichier. m2 part avec la règle corrigée.
