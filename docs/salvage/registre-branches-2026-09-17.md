# Registre des branches distantes — relevé du 2026-09-17

Consigné AVANT suppression, par la même règle que les registres du 2026-09-08 : on ne
supprime aucune branche dont le SHA n'est écrit nulle part.

Dépôt : dev.azure.com/AmitelGTC/AutoWinOS.
Restauration : `git branch <nom> <sha>` puis `git push origin <nom>`.

## Supprimées le 2026-09-17 (3 distantes + 3 locales) — aucune perte

| SHA | branche | où |
|---|---|---|
| `7e8b38e359ef6771ed7371917c1bc2f26a0857fd` | `autowin/secours/pc-20260901/main-ahead-11` | distante |
| `9542f6986d37fef52fda9340b2fba84db057dd2a` | `autowin/secours/pc-20260901/recu-ballants` | distante |
| `1147a195f6a2a459bcfe59debc2784974b695d7a` | `autowin/secours/pc-20260901/run-7b106fd6c281-uncommitted` | distante |
| `237d58e0d377690b025f6254f90055ea28be0838` | `autowin/recovery/run-7b106fd6c281-1` | locale |
| `4bbab009e29d2168310ca5ad3fd55e64e918c337` | `feat/observatory-injections-exhaustives` | locale |
| `7e8b38e359ef6771ed7371917c1bc2f26a0857fd` | `fix/heal-signe-de-vie-et-trace-erreur` | locale |

Reçus conservés sous `refs/autowin/salvage-20260917/`.

`main-ahead-11` est la branche que le registre du 2026-09-08 laissait en place, suppression
refusée faute du droit ForcePush. Elle est partie aujourd'hui : elle avait été poussée
DEPUIS ce poste, et Azure accorde ce droit au créateur d'une branche. C'est la seule raison
pour laquelle trois ont pu partir et quarante-cinq non.

## À supprimer — 45 branches, triées, suppression REFUSÉE par Azure

Toutes ont été triées PAR LEUR CONTENU contre `origin/main` le 2026-09-17 : aucune ne porte
de travail absent de la base. Trois motifs, du plus simple au moins évident :

- **ancêtre de main** — le commit est littéralement dans l'historique de `main` ;
- **même empreinte de patch** — le contenu est arrivé sous un autre SHA (publication depuis
  une copie isolée, piège documenté le 2026-08-24) ;
- **contenu présent autrement** — la même intention est réimplémentée dans `main`, en
  général plus loin. Les cas notables sont détaillés sous le tableau.

| SHA | branche | motif |
|---|---|---|
| `204245100cb9e83475b94c3eaadde514b4cab284` | `agent/describe-exit-code` | ancêtre de main |
| `59b8141fb74e0d990ad8faeb5e182e79c73e36f8` | `autowin/safety/main-dismiss-20260903` | même empreinte de patch |
| `9e2fd8191e5106edcc1cd04032c63910352306a7` | `autowin/secours/copie-command-edit-c1f99db0-b23d-446d-a222-c5c6e175a7e9` | contenu présent autrement |
| `0cd50f310747cbc5d57489d4feb589aa8e2f768b` | `autowin/secours/copie-command-edit-c37ccae6-131c-4409-a190-54b46bbcd6ab` | contenu présent autrement |
| `a39269ecfd8a2198a4a3183d07b8c1eb17e9cd54` | `autowin/secours/copie-command-edit-conv-21-chatview-css-1ktkiqs` | contenu présent autrement |
| `49ffae0ec3e9afc52c50b3b3a59e9f1e3b4b0e59` | `autowin/secours/copie-command-edit-conv-21-chatview-parts-pipeline--1qg922y` | contenu présent autrement |
| `2ea324c71f75ee82cf7a957f1b160ff065bb6ee7` | `autowin/secours/copie-command-edit-conv-21-chatview-parts-tsx-0aggx8w` | contenu présent autrement |
| `3a3a164917361d34c6cb83bddcc19baf6826106a` | `autowin/secours/copie-run-1509aba9e86b-1` | contenu présent autrement |
| `c312e3a6808404a2da9eda37dd3a9583a937fb70` | `autowin/secours/copie-run-2f92164b77eb-1` | contenu présent autrement |
| `ab6b5e547134badc6f71feb970ee20089d809909` | `autowin/secours/copie-run-47f09e7d1928-6` | contenu présent autrement |
| `fbaeffd91605337ffc26d4d85af2527a80eb0f07` | `autowin/secours/copie-run-4b7398c47f63-1` | contenu présent autrement |
| `dec2c9a3a590e8f75cb764478fe7c1e021ef7813` | `autowin/secours/copie-run-74480219d1c1-11` | contenu présent autrement |
| `035fd6b62257c564fd4b96ef1e0edbaa11005ed6` | `autowin/secours/copie-run-74480219d1c1-4` | contenu présent autrement |
| `0d6232996d8d81fe0044a3893d8c27135d378eb1` | `autowin/secours/copie-run-9110a116942d-1` | contenu présent autrement |
| `8783223a943730510732ea2cf559e69d99addeba` | `autowin/secours/copie-run-b21d68a5f1a4-1` | contenu présent autrement |
| `7ac77c040bf71c9d9f184c0e330255e47acdea03` | `autowin/secours/copie-run-bf1c328269aa-1` | contenu présent autrement |
| `a413b1fa9b4381adcf6bacf0e542bd7a924ff40d` | `autowin/secours/copie-run-cab532434a80-1` | contenu présent autrement |
| `e9f6a03c35bd6d6b328fdf46ac1cc0c5878f9df6` | `autowin/secours/copie-run-d386a227975e-1` | contenu présent autrement |
| `323ad9e249f6ead3393618d3e84da4cbab0598da` | `autowin/secours/copie-run-fd8d6412055b-1` | contenu présent autrement |
| `f10e813c0d5f69d3b3ce4fed36b15cea2cbc9060` | `autowin/secours/transport-exit-codes-20260806` | contenu présent autrement |
| `8cd3a12b37794ae928ab110e88bd44d74c33bcb0` | `feat/brain-embarque` | même empreinte de patch |
| `47a52d927b550d43b5b46a133a7bd96010ac7a22` | `feat/brain-inbox-fallback` | contenu présent autrement |
| `34c7ad3748b07deed030b475d3e4ec5d830126cf` | `feat/chat-menu-orthographe` | contenu présent autrement |
| `945760b894ec1c8aaea739a298325147d994a309` | `feat/prompt-envoye-ligne-de-phase` | ancêtre de main |
| `3391d7727195dd3c66cc8e319fdce3c00b006a7d` | `feat/sql-read` | ancêtre de main |
| `0e4e6c322824f947dc4bc5feccb1a7056e0d2548` | `feat/themes-selecteur-et-voiles` | ancêtre de main |
| `244f2b03b8dfed3344819333462be5c30d4d0e6a` | `feat/ticket-create` | ancêtre de main |
| `d4bd3a026e566ef04860fc24b09e0177c5f2e035` | `fix/bouton-demarrer-brain-reamorce` | ancêtre de main |
| `fa4f527010efd47b92fc135bb717094d6f374214` | `fix/brain-origine-configuree` | même empreinte de patch |
| `9f89b4328e9317d6ec8080c62d64044bf9a2aaef` | `fix/edit-file-encoding` | contenu présent autrement |
| `fc84a9a9150074b89c036ead882151fa6e09c92a` | `fix/fence-html-render` | même empreinte de patch |
| `7ef090b31b19fd30badfb63e9477be3e6d083060` | `fix/fs-watch-short-path` | contenu présent autrement |
| `78e422ba32acb04225c30132e7774ddd89a1b01e` | `fix/identite-session-dossier` | contenu présent autrement |
| `71b3a46eea523c02df1693b0c88fe4e70f3c9ae9` | `fix/kaizen-leviers-injectes` | même empreinte de patch |
| `7ddfbd70c7aff0bf011d56e2bca970061b9eecc4` | `fix/preflight-install-cli-claude` | même empreinte de patch |
| `8de15d60d0d6ffb2b13dcaf5d0aa26985cc3cdc2` | `fix/scout-interne-5-candidats` | ancêtre de main |
| `80c7abaced1973cc78df418f1155763ee84df12d` | `fix/session-key-workspace` | contenu présent autrement |
| `1fbdda8bba86692f184ebb96562aadb6466ae655` | `fix/ticket-get` | ancêtre de main |
| `4beb5f91216d8a2e23bc2669a4f85bc6d47259af` | `fix/verdict-defaut-ferme-plus-en-vert` | même empreinte de patch |
| `3f18acc77d5006f37a8d8d69309a78ba570201c8` | `fix/watchdog-racine-et-purge-orphelins` | ancêtre de main |
| `a02a59a0eba597d1502ffe44da8716899c52fefd` | `salvage/2026-09-07/journal-gc-reservation-active` | contenu présent autrement |
| `4f0612814241c9f37f55876e938c6f6cd38adbff` | `salvage/2026-09-07/tri-5-travaux-non-publies` | ancêtre de main |
| `8d269ecd9e7a7a7c193aef5effee2d5ebb6d63b5` | `salvage/reprise-conv-629` | ancêtre de main |
| `134dd7471c718064773b267750d886c9f924614d` | `sauvegarde/agent-run-8f96283bcb63` | contenu présent autrement |
| `8ec2d6574a70dc1ce4eff18b56a29254665873fb` | `sauvegarde/main-local-20260906` | contenu présent autrement |

### Les six cas qui méritaient une lecture, pas un `git cherry`

**Les 13 copies « diagnostic de sortie du modèle »** (`copie-run-*`,
`transport-exit-codes-20260806`). `main` porte `src/main/provider-failure-diagnosis.ts` en
311 lignes là où les copies en ont 192, avec `describeExitCode`, `isTransportExitCode` et
`describeProviderExit` réellement câblés dans `providers/claude.ts` (l. 56-59 et 1882-1895).
Les copies apportaient `crashExitCode` et `uncoveredSendSites` : deux noms que `main` n'a
pas, pour un travail que `main` fait autrement.

**Les 4 copies « mode clair »** (`theme-modes.css`, `ChatView.css`) sont le seul cas
DANGEREUX du lot. `main` a renommé le sélecteur `data-theme='clair'` en `data-base='clair'`
et en porte 110 règles contre 20 ; surtout, `src/renderer/src/theme-mode.test.ts` l. 82
INTERDIT désormais l'ancienne forme. Les refusionner rendrait `main` rouge. L'une d'elles
(`copie-command-edit-conv-21-chatview-css-1ktkiqs`) traîne en plus un `outline: 2px solid
#ff00ff` — un témoin de mesure du 2026-09-03 jamais retiré.

**`fix/fs-watch-short-path` et `sauvegarde/agent-run-8f96283bcb63`** portent le même
correctif du plantage libuv sur les chemins courts 8.3. `main` l'a, écrit autrement : la
canonisation `realpathSync.native` est posée DANS la clé de chemin plutôt qu'à côté du
watcher — donc les deux côtés de l'échange l'appliquent sans avoir à y penser.

**`feat/brain-inbox-fallback`** est une INTENTION EN CONFLIT, déjà tranchée. Sur un 404, la
branche écrivait le candidat dans un fichier de repli ; `main` a choisi l'inverse et le dit
en toutes lettres — « dépôt IMPOSSIBLE : la route est absente de ce serveur, c'est le
serveur qu'il faut corriger, pas le fait ». Décision postérieure (12/09 contre 02/08).

**`fix/identite-session-dossier` et `fix/session-key-workspace`** : `main` compose déjà la
clé de session avec le dossier de travail (`agent-pilot.ts` l. 1293) et porte
`agent-pilot.session-resume.test.ts`.

**`autowin/secours/pc-20260901/recu-ballants`** (43 commits, supprimée aujourd'hui) était un
commit à ARBRE VIDE : une ancre qui empêchait l'élagage, sans aucun contenu. La fusionner
aurait effacé 1892 fichiers.
