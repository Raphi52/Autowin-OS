---
name: skill-doctor
description: >-
  Rapport des skills : leur coût à chaque tour, leurs usages et leur dernier usage, pour choisir
  lesquelles couper. Déclencher sur `/skill-doctor`, « quelles skills ne servent pas », « combien
  coûtent nos skills », « le kit est trop gros ». Portage du rapport de Claude Code sur les traces
  d'Autowin : sonde déterministe en lecture seule, puis tri de ce qui peut partir. Il recommande, il
  ne coupe rien. PAS pour : le coût des conversations (→ `rendement`), le bilan d'installation
  (→ `doctor`), affûter un déclencheur (→ `kaizen`), le code mort (→ `residus`).
---

# skill-doctor — ce que chaque skill coûte et combien elle sert

## À quoi ça sert

Chaque skill ajoute une ligne à l'état remis au modèle, à chaque tour, qu'elle serve ou non. Ce rapport
met ce coût en face de l'usage réel, pour décider lesquelles couper. C'est le `/skill-doctor` de Claude
Code rejoué sur les traces d'Autowin : mêmes colonnes, même tri, même signalement.

## Contrôle d'entrée

Aucun : c'est de la lecture, quelques secondes. Une question sur une seule skill passe aussi par le
rapport complet, puis tu lis sa ligne.

## Procédure

### 1. MESURER

Depuis la racine du dépôt Autowin :

```
npx tsx scripts/skill-doctor.mjs
```

Code 0 exigé. Code 2 = aucune conversation lue : dis-le et ne conclus rien, car tout paraîtrait
inutilisé. `--json` ajoute le détail `tapee` / `modele` / `etape` de chaque usage. `--data <dossier>`
lit un autre dossier de données.

### 2. RENDRE LE RAPPORT

Recopie la sortie telle quelle dans un bloc de code. Ne la résume pas : l'utilisateur décide sur la table.

### 3. TRIER CE QUI PEUT PARTIR

Prends les skills signalées « jamais invoquées », puis celles sans usage depuis plus de 30 jours, de la
plus chère en contexte à la moins chère. Ignore celles dont `contexte` vaut `-` : déjà coupées, elles
n'ont rien à rapporter. Avant d'en proposer une, écarte ces quatre faux positifs :

1. **Elle est planifiée.** Son nom figure dans un `prompt` activé de
   `.autowin-data/autowin-os/scheduled-tasks.json`.
2. **Quelque chose d'actif l'appelle.** Cherche son nom entre accents graves dans les `SKILL.md` des
   autres skills activées. Un renvoi de frontière (« → `x` ») ne compte pas : seule une étape qui la
   joue compte. Cherche aussi dans le code : une phase de `src/shared/pipeline-phases.ts` ou un nom
   routé dans `src/main` sert encore, même à 0×.
3. **Elle est neuve.** Une skill de moins de 30 jours n'a pas encore eu sa chance :
   `git log --diff-filter=A --format=%ad --date=short -- skills/<nom>/SKILL.md`. Une skill absente de
   git (dossier du poste, skill ignorée) se date par son fichier.
4. **Elle sert de secours.** Sa description la déclenche sur un blocage, pas sur une demande (`forge`).
   Son `0×` ne prouve rien : signale-la, sans la recommander.

Ce qui passe les quatre contrôles devient une recommandation, avec son gain en jetons par tour.

### 4. COUPER SEULEMENT SUR DEMANDE

L'utilisateur tranche. S'il demande de couper une skill, deux voies existent :

- **Réversible, à préférer :** `"<nom>": false` sous `skills` dans
  `.autowin-data/autowin-os/registry/enablement.v1.json`. Sans redémarrage, elle sort de la liste dès le
  tour suivant (un tour déjà lancé garde la sienne) et `skill_charger` la refuse. Le reste continue : un
  `/nom` tapé charge encore la procédure
  (`src/main/agent-pilot.ts` ne lit pas ce réglage), et une phase du pipeline tourne sous son brief.
- **Définitive :** retirer son dossier. Son contenu reste dans git seulement si elle y était suivie.

Réglages › Skills n'a pas d'interrupteur : la vue est en lecture seule
(`src/renderer/src/components/CapabilitiesView.tsx`).

## Ce que le rapport ne dit pas

- **`usages` est un minimum.** Les saisies d'un fil supprimé sont reprises, pas ses appels à
  `skill_charger` ni ses runs.
- **`usages` compte les fois où la skill a servi, pas des demandes.** Un `/build` qui lance un run
  compte deux fois : le message, puis l'étape. Seules `tapee` et `modele` lisent le `SKILL.md` : une
  étape de run joue la phase sous son brief (`src/main/phase-briefs.ts`). `--json` donne le détail.
- **`jetons 7 j` compte des tours entiers, cache compris.** claude.exe additionne aussi le cache, mais
  requête par requête. Ici, c'est ce qui a tourné autour de la skill, pas son poids : un seul gros run
  peut faire tout le chiffre.
- **`contexte` est une estimation** (caractères divisés par 4). Le rapport recalcule la ligne avec une
  copie de `ligneDeSkill` (`src/main/commands.ts`), comparée à l'original par un test.
- **La date d'une étape de run** est celle de son fichier : une copie ou une restauration la décale.
- **La lecture seule a un accroc.** `nativeSkills` crée `registry/` s'il manque sous `--data`, et peut
  réparer ou migrer un réglage illisible ou ancien.

## Rapport

Clos avec : la table · le coût total de la liste · les skills recommandées, chacune avec son gain et les
quatre contrôles passés · ou, si rien ne peut partir, la phrase qui le dit et pourquoi.

## À ne pas faire

- Ne coupe aucune skill sans demande explicite.
- N'appelle pas « inutile » une skill sur son seul `0×` : les quatre contrôles passent d'abord.
- N'additionne pas `jetons 7 j` pour annoncer une dépense : plusieurs lignes partagent des runs voisins,
  et le cache n'a pas le prix de l'entrée fraîche. Le coût réel se lit avec `rendement`.
