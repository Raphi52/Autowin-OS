# Reçu de salvage — 2026-09-15

Consolidation sur `main` : toutes les autres branches ont été supprimées APRÈS tri par contenu.
Chaque ligne ci-dessous ressuscite sa branche : `git branch <nom> <sha>` (tant qu'aucun `git gc` n'a élagué l'objet).

## Travail UNIQUE retrouvé et greffé dans main

| Travail | Origine | Commit de greffe |
|---|---|---|
| Normalisation de chemin du contrôle fix-gate | sauvegarde/run-a7fc446f5430-mermaid-fixgate | 99c4b632, a6ef5c49 |
| Console Brain au démarrage (venv uv) + champs métier des fiches (6 commits, auteur emmanuel.heurtier) | origin/feat/themes-selecteur-et-voiles | jusqu'à 4bebfd40 |
| Libellé lisible des runs (`libelleRun`) | origin/autowin/secours/pc-20260831/orphelin-4 | 861aa94f |

## Travail UNIQUE archivé (arbitrage humain requis)

- Refonte `SourceControlPane` → `WorktreeOfficesHub` : étiquette `archive/worktree-offices-hub` (d9777c9a). Conflit d'intention avec le panneau actuel.

## Branches distantes — identifiants avant suppression

```
0c286f6081787a021ad1638751cc3abbe8f22af2 origin
204245100cb9e83475b94c3eaadde514b4cab284 origin/agent/describe-exit-code
65f2849ddf3199ba914b2c6172e72511f751b457 origin/autowin/recovery/run-5263656e8fa8-1
59b8141fb74e0d990ad8faeb5e182e79c73e36f8 origin/autowin/safety/main-dismiss-20260903
9e2fd8191e5106edcc1cd04032c63910352306a7 origin/autowin/secours/copie-command-edit-c1f99db0-b23d-446d-a222-c5c6e175a7e9
0cd50f310747cbc5d57489d4feb589aa8e2f768b origin/autowin/secours/copie-command-edit-c37ccae6-131c-4409-a190-54b46bbcd6ab
a39269ecfd8a2198a4a3183d07b8c1eb17e9cd54 origin/autowin/secours/copie-command-edit-conv-21-chatview-css-1ktkiqs
49ffae0ec3e9afc52c50b3b3a59e9f1e3b4b0e59 origin/autowin/secours/copie-command-edit-conv-21-chatview-parts-pipeline--1qg922y
2ea324c71f75ee82cf7a957f1b160ff065bb6ee7 origin/autowin/secours/copie-command-edit-conv-21-chatview-parts-tsx-0aggx8w
3a3a164917361d34c6cb83bddcc19baf6826106a origin/autowin/secours/copie-run-1509aba9e86b-1
c312e3a6808404a2da9eda37dd3a9583a937fb70 origin/autowin/secours/copie-run-2f92164b77eb-1
ab6b5e547134badc6f71feb970ee20089d809909 origin/autowin/secours/copie-run-47f09e7d1928-6
fbaeffd91605337ffc26d4d85af2527a80eb0f07 origin/autowin/secours/copie-run-4b7398c47f63-1
dec2c9a3a590e8f75cb764478fe7c1e021ef7813 origin/autowin/secours/copie-run-74480219d1c1-11
035fd6b62257c564fd4b96ef1e0edbaa11005ed6 origin/autowin/secours/copie-run-74480219d1c1-4
0d6232996d8d81fe0044a3893d8c27135d378eb1 origin/autowin/secours/copie-run-9110a116942d-1
8783223a943730510732ea2cf559e69d99addeba origin/autowin/secours/copie-run-b21d68a5f1a4-1
7ac77c040bf71c9d9f184c0e330255e47acdea03 origin/autowin/secours/copie-run-bf1c328269aa-1
a413b1fa9b4381adcf6bacf0e542bd7a924ff40d origin/autowin/secours/copie-run-cab532434a80-1
e9f6a03c35bd6d6b328fdf46ac1cc0c5878f9df6 origin/autowin/secours/copie-run-d386a227975e-1
323ad9e249f6ead3393618d3e84da4cbab0598da origin/autowin/secours/copie-run-fd8d6412055b-1
909064136f1b74c95b5e179633bc31f70c169c05 origin/autowin/secours/pc-20260831/agent__command-edit-1958265d-8705-4d02-bae9-eb08114a05ee
bd75389715de102faf570032bd4df6083ce68b98 origin/autowin/secours/pc-20260831/agent__command-edit-732c4a48-b494-4822-a79b-fed70081708e
a2a82067102b6813f09b28894ec7ca94790b3ec5 origin/autowin/secours/pc-20260831/agent__command-edit-7e51e262-f2a4-4dd4-9c82-a713c0f8e720
ea0034193fe5b6dd3376cd83808db6dc81b06169 origin/autowin/secours/pc-20260831/agent__command-edit-87528fb8-8c6c-4607-98b4-e0d1e67d5c81
88da622754c0510fca51eea8fc4f060aee0ef7a3 origin/autowin/secours/pc-20260831/agent__command-edit-conv-1547-chatview-tsx-0g3xo38
918b32e12e8e03581e4809eddd1f839f2b83826e origin/autowin/secours/pc-20260831/agent__command-edit-conv-1562-chatview-css-1ktkiqs
2c5fe50700a74f27e5acb23e28c763a88a84d9cc origin/autowin/secours/pc-20260831/agent__run-6be4b61d8869-1
4a94bf8199ab53cf2add7c58d02e34fe3df4ea5c origin/autowin/secours/pc-20260831/orphelin-10-agentrun-bb75e33660f8-1
8bd4b0869bdb479e11d2fd180099e04c2944e216 origin/autowin/secours/pc-20260831/orphelin-11-agentrun-6056bb184ecb-1
bd4bc71730573fe8f0b4f387b15aa22dd9ea192b origin/autowin/secours/pc-20260831/orphelin-13-salvagerun-2f99b52ced52-1snapshotdutrava
b30cfa4b78e3d133fa376096ac62a20b27907d8d origin/autowin/secours/pc-20260831/orphelin-14-salvagerun-26b950651ecd-1snapshotdutrava
70cc10535713783cb4db4508e66b9cde7ef29727 origin/autowin/secours/pc-20260831/orphelin-15-agentrun-0ff32a7ddf2a-1
e1b8fdec65eea21e69977fb195ab6d84483a1630 origin/autowin/secours/pc-20260831/orphelin-16-agentrun-c03f05f34b3d-1
876350b41d68e1cfabe983a901fbb239aa2a03f7 origin/autowin/secours/pc-20260831/orphelin-17-agentrun-0088c55a8f4b-1
073472985630cd986340aba281ea2cc5b3d45686 origin/autowin/secours/pc-20260831/orphelin-19-sauvegardedutravailnoncommittedecebureau
ee1688c0400bb3fbbdf3e810ce8d27760d1de452 origin/autowin/secours/pc-20260831/orphelin-2-featprovidersbrancheleCLIQwenCodesurAuto
f4a52bb3f52dff7d05f0fd105086e40091904045 origin/autowin/secours/pc-20260831/orphelin-20-agentcommand-edit-conv-1412-src-renderer
2a51ae87c25dab98ff457332ffb55237b3edd56e origin/autowin/secours/pc-20260831/orphelin-21-agentcommand-edit-conv-1412-src-renderer
6a1c3c14d5f152311c33de5d153c1f31b38d1510 origin/autowin/secours/pc-20260831/orphelin-4-agentrun-fc5392637720-1
b7fdb37b8dd1e2165800ce3da61d7305ccb47971 origin/autowin/secours/pc-20260831/orphelin-5-agentrun-9d66e3788edf-1
c3c1c84d1ce145b6f2b8a3dfcf39158ef1a4f80e origin/autowin/secours/pc-20260831/orphelin-6-agentrun-59624aa4eeee-1
08cf612c90171b4acfb218c88881325223badaec origin/autowin/secours/pc-20260831/orphelin-7-agentrun-4b878d41753f-1
4f0e2fee86e98a5f0187d4a76cfca0c880a4d466 origin/autowin/secours/pc-20260831/orphelin-8-agentcommand-edit-conv-1500-constitution
f32c0b30baac7b94de39b73d8620ccef795119d8 origin/autowin/secours/pc-20260831/orphelin-9-agentcommand-edit-conv-1500-constitution
8bce5b84e77fb2668aa59980a42538ed1e38f936 origin/autowin/secours/pc-20260831/stash0
7e8b38e359ef6771ed7371917c1bc2f26a0857fd origin/autowin/secours/pc-20260901/main-ahead-11
9542f6986d37fef52fda9340b2fba84db057dd2a origin/autowin/secours/pc-20260901/recu-ballants
1147a195f6a2a459bcfe59debc2784974b695d7a origin/autowin/secours/pc-20260901/run-7b106fd6c281-uncommitted
f10e813c0d5f69d3b3ce4fed36b15cea2cbc9060 origin/autowin/secours/transport-exit-codes-20260806
cdd5005b53f6c63ff1d423d9e52f010a1b17fd2c origin/autowin/travail/decor-3d-resolu
8cd3a12b37794ae928ab110e88bd44d74c33bcb0 origin/feat/brain-embarque
47a52d927b550d43b5b46a133a7bd96010ac7a22 origin/feat/brain-inbox-fallback
34c7ad3748b07deed030b475d3e4ec5d830126cf origin/feat/chat-menu-orthographe
945760b894ec1c8aaea739a298325147d994a309 origin/feat/prompt-envoye-ligne-de-phase
3391d7727195dd3c66cc8e319fdce3c00b006a7d origin/feat/sql-read
0e4e6c322824f947dc4bc5feccb1a7056e0d2548 origin/feat/themes-selecteur-et-voiles
244f2b03b8dfed3344819333462be5c30d4d0e6a origin/feat/ticket-create
d4bd3a026e566ef04860fc24b09e0177c5f2e035 origin/fix/bouton-demarrer-brain-reamorce
fa4f527010efd47b92fc135bb717094d6f374214 origin/fix/brain-origine-configuree
bfeb794956253ca0c32e9d20a74ee8c4a68d5e8e origin/fix/branding-fond-2d
9f89b4328e9317d6ec8080c62d64044bf9a2aaef origin/fix/edit-file-encoding
fc84a9a9150074b89c036ead882151fa6e09c92a origin/fix/fence-html-render
7ef090b31b19fd30badfb63e9477be3e6d083060 origin/fix/fs-watch-short-path
78e422ba32acb04225c30132e7774ddd89a1b01e origin/fix/identite-session-dossier
71b3a46eea523c02df1693b0c88fe4e70f3c9ae9 origin/fix/kaizen-leviers-injectes
7ddfbd70c7aff0bf011d56e2bca970061b9eecc4 origin/fix/preflight-install-cli-claude
80c7abaced1973cc78df418f1155763ee84df12d origin/fix/session-key-workspace
1fbdda8bba86692f184ebb96562aadb6466ae655 origin/fix/ticket-get
4beb5f91216d8a2e23bc2669a4f85bc6d47259af origin/fix/verdict-defaut-ferme-plus-en-vert
3f18acc77d5006f37a8d8d69309a78ba570201c8 origin/fix/watchdog-racine-et-purge-orphelins
0c286f6081787a021ad1638751cc3abbe8f22af2 origin/main
a02a59a0eba597d1502ffe44da8716899c52fefd origin/salvage/2026-09-07/journal-gc-reservation-active
4f0612814241c9f37f55876e938c6f6cd38adbff origin/salvage/2026-09-07/tri-5-travaux-non-publies
556e344582fb7f1f60c27b42be3992736f8c3eb3 origin/salvage/artifact-provenance
134dd7471c718064773b267750d886c9f924614d origin/sauvegarde/agent-run-8f96283bcb63
8ec2d6574a70dc1ce4eff18b56a29254665873fb origin/sauvegarde/main-local-20260906
```

## Branches locales — identifiants avant suppression

```
0a3f490911297c4707b7a3f6c91782c9cb8cd77f autowin/recovery/command-edit-conv-489-thinking-block-corps-ts-1qbz175
8dbfbac771ac75183c45e64108529dc76bdf0f5e autowin/recovery/command-edit-conv-499-chatview-behavior-test-t-1a5w6h6
0c404430d2fbfa0e0116242309991b1faeeb0184 autowin/recovery/command-edit-conv-502-chat-view-model-ts-12u4s9h
fde90bba38cd30290843f5ff382a6f6aa2f6aacc autowin/recovery/command-edit-conv-520-window-ts-0nutpjf
2a7ba7844c222ad7bfa4d53543de239f4bfa637b autowin/recovery/command-verify-conv-494
53524218a21b090ec38e0de1399ddb99e24db115 autowin/recovery/command-verify-conv-497
9db452712d90a96913fc88e35b27189bd64c0e40 autowin/recovery/command-verify-conv-500
ff7665a427e3deb15f38a18eb1bf411d5d9232a4 autowin/recovery/command-verify-conv-502
6dfdd14f3b4468119090cd7c33ce589e836f5cd9 autowin/recovery/command-verify-conv-507
09073c7bfcc2a07985c29531e079ff294527c859 autowin/recovery/command-verify-conv-517
8f529bad1d62521c48788302fe2aa868ec592885 autowin/recovery/command-verify-conv-520
f65f9f72a99cd512aa368c47f2544be9b2bd3107 autowin/recovery/command-verify-conv-528
e6c9353ecf299310bd59b02d7cbc514189dca1d1 autowin/recovery/run-01b29ec17db9-1
1fee237c817f3b820db7b04698012468b5567ce7 autowin/recovery/run-0e76c99a3021-1
0a64fbd34068e153794d65b430e31f487ed64bc2 autowin/recovery/run-315e68922bd7-1
ce4bd77070c861582b88460a976cb6cde677887c autowin/recovery/run-3a6292dc3ac7-1
d9777c9a2489d6621d04b3e6438bc4a5b4b4f66c autowin/recovery/run-4e60e1399847-1
5925808449182e8797b2f0061440f7ff72c0433f autowin/recovery/run-54b522be50f5-1
74bd8af4995edfe51b79d24f8bb8283a920f1107 autowin/recovery/run-e1f8b41817da-1
173062116e9ce39e3b032dbaab6f6004980aa798 autowin/recovery/run-fbdc8a6d2678-1
5890cc884eb68db9cf16012d18157551198b5bec autowin/recovery/run-febaa41f9647-1
82addba7a31220a1f1c6148f83bcb89dba870f59 autowin/salvage/run-0c100bbd7115-trois-correctifs
f20addb9ac4fab54f603a427ef09d25d15bb75bb feat/mermaid-dans-le-chat
61a043c327fc5c43c30546752baad1e1bb5046db salvage/trace-pistes-par-source-e77dd794
a28b1fcdc41917b04472d33860d32adf0ee1224c sauvegarde/run-a7fc446f5430-mermaid-fixgate
```
