# Registre de salvage — 2026-08-31

Toute branche locale portant du travail absent de `main` est ici, avec un VERDICT.
L'oracle `node scripts/salvage-audit.mjs` echoue tant qu'une branche porte du contenu
absent de main sans ligne dans ce fichier. Aucune branche n'est supprimee : le verdict
« deja sur main » ou « ecartee » ne detruit rien, il trace une decision revocable.

## Fusionnees sur main (11 + arbre de travail)

- Travail non commite de l'arbre principal (trace-store, model-quotas, gel-main, ChatMosaic cout-stream) : commit `4d3206aa`, 35/35 tests verts.
- `autowin/secours/pc-20260831/agent__command-edit-25deec80-5aef-470d-b613-ba89cba05e68` — fusionnee sans conflit.
- `autowin/secours/pc-20260831/agent__command-edit-2c64e0b4-dbee-4b0c-871e-0ff548ab0c93` — fusionnee sans conflit.
- `autowin/secours/pc-20260831/agent__command-edit-a6c61bac-cb67-4aa0-81be-a982215ab937` — fusionnee sans conflit.
- `autowin/secours/pc-20260831/agent__command-edit-conv-1546-chatview-css-1ktkiqs` — fusionnee sans conflit.
- `autowin/secours/pc-20260831/agent__command-edit-conv-1553-chatview-css-1ktkiqs` — fusionnee sans conflit.
- `autowin/secours/pc-20260831/agent__command-edit-conv-1567-chatmessagerow-reasoning-18404zq` — fusionnee sans conflit.
- `autowin/secours/pc-20260831/agent__command-edit-conv-1567-chatview-parts-tsx-0aggx8w` — fusionnee sans conflit.
- `autowin/secours/pc-20260831/arbre-principal` — fusionnee sans conflit.
- `autowin/secours/pc-20260831/arbre-travail-20260831` — fusionnee sans conflit.
- `autowin/travail/decor-3d-global` — fusionnee sans conflit.
- `autowin/travail/transfert-pc` — fusionnee sans conflit.

## Ecartee — modifierait le nuage valide a l'oeil par l'utilisateur

- `autowin/recovery/run-88a9f19d24be-1` — touche `home-decor-scene.ts` (le shader du nuage). L'utilisateur a valide l'etat `a6b06f53` (« garde celui-la »). Preuve du respect : `git diff a6b06f53 main -- src/renderer/src/components/home-decor-scene.ts` est VIDE. A rapatrier seulement si la performance du nuage redevient un sujet.
- `autowin/travail/decor-3d-resolu`, `autowin/secours/pc-20260831/stash0` — anciens etats du decor (DecorDeFond/HomeView/theme.css), anterieurs a la version validee. Conserves comme archive.

## Deja representee sur main — conflit purement textuel

Verifie ligne a ligne : les lignes ajoutees par ces branches sont deja presentes dans les
fichiers de `main` (snapshot d'editeur pris avant que le meme travail soit commite autrement).
Fusionner reintroduirait un etat ANTERIEUR : ecarte pour non-regression.

- `autowin/recovery/command-edit-3234765a-d276-4ea4-accf-5d3c2d949623`
- `autowin/recovery/command-edit-539f5f4c-10ec-4523-960d-8522b12a8847`
- `autowin/recovery/command-edit-76da8974-9c25-4d55-8771-b318981eb6d2`
- `autowin/recovery/command-edit-conv-1482-conversation-router-ts-1kzml7i`
- `autowin/recovery/command-edit-conv-1489-commands-ts-0v7d7e1`
- `autowin/recovery/command-edit-conv-1516-chatview-css-1ktkiqs`
- `autowin/recovery/command-edit-conv-1541-chatview-tsx-0g3xo38`
- `autowin/recovery/command-edit-d6df2bf4-cdcf-4982-98c9-addbd8ee4cda`
- `autowin/recovery/run-0be31590f330-1`
- `autowin/recovery/run-5c9269cc6200-1`
- `autowin/recovery/run-657c4a3633fe-1`
- `autowin/recovery/run-8d635514414c-1`
- `autowin/recovery/run-ab6587930ace-1`
- `autowin/recovery/run-eef2669db7a1-1`
- `autowin/recovery/salvage-20260829-agent__run-2c8dbdf9d036-1`
- `autowin/recovery/salvage-20260829-agent__run-e2aad43e639d-1`
- `autowin/secours/pc-20260831/agent__command-edit-1958265d-8705-4d02-bae9-eb08114a05ee`
- `autowin/secours/pc-20260831/agent__command-edit-76da8974-9c25-4d55-8771-b318981eb6d2`
- `autowin/secours/pc-20260831/agent__command-edit-7e51e262-f2a4-4dd4-9c82-a713c0f8e720`
- `autowin/secours/pc-20260831/agent__command-edit-87528fb8-8c6c-4607-98b4-e0d1e67d5c81`
- `autowin/secours/pc-20260831/agent__command-edit-conv-1541-chatview-tsx-0g3xo38`
- `autowin/secours/pc-20260831/agent__command-edit-conv-1547-chatview-tsx-0g3xo38`
- `autowin/secours/pc-20260831/agent__command-edit-conv-1550-chatview-tsx-0g3xo38`
- `autowin/secours/pc-20260831/agent__command-edit-conv-1562-chatview-css-1ktkiqs`
- `autowin/secours/pc-20260831/agent__run-6be4b61d8869-1`
- `autowin/secours/pc-20260831/agent__run-99ca4f84d05c-1`
- `salvage/artifact-provenance`
- `salvage/lecture-encodage`

## A rapatrier separement — feature reelle non cablee

- `autowin/secours/pc-20260831/agent__command-edit-732c4a48-b494-4822-a79b-fed70081708e` et son doublon `autowin/secours/pc-20260831/agent__command-edit-b593c6c3-6da0-4176-b832-bbf9701f08a9` : portent la **vue mosaique des conversations** (`ConversationMosaic`, boutons `conv-view-list` / `conv-view-mosaic`). Le composant `ConversationMosaic.tsx` N'EXISTE PAS sur main : le snapshot ne contient que le cablage dans un `ChatView.tsx` devenu obsolete. Le fusionner regresserait ChatView de 156 lignes. Verdict : conserve, a re-implementer sur le ChatView courant si l'utilisateur veut cette vue.
- `autowin/recovery/run-17de86c7b881-1` — fusionnee sans conflit (memoisation mosaique pendant le stream).

## Tri du 2026-09-07 — les 5 travaux non publies du bandeau

Sweep complet (`git status --porcelain`, `--ignored`, `git stash list`, `git worktree list`,
`git branch --no-merged`, `git log --all --not --remotes`, `git for-each-ref` hors
heads/tags/remotes) : rien d'autre que ces 5 porteurs et le travail du banc, deja entre.
Aucun stash. Aucun objet detache hors main : `e99969a9` (bench/preuves) est devenu main
pendant le tri.

Verdict par CONTENU, avec l'oracle du candidat (ses propres fichiers de test rejoues sur main) :

| Porteur (branche `autowin/recovery/…`) | SHA consigne | Verdict | Preuve |
|---|---|---|---|
| `command-verify-conv-31` | `8b880fb22b44c1af816b1886f6a81734ef44f8f6` | DUPLICATE | `run-progress-model.test.ts` du candidat : 1 fichier / vert sur main (exit 0). La deduplication `new Set(...)` est en place, `run-progress-model.ts:117`. |
| `command-verify-conv-38` | `e611419e743cfd8b10725e04807a04248837bc24` | DUPLICATE | `outlook-model.test.ts` du candidat : vert sur main (exit 0). `outlook-model.ts` IDENTIQUE octet pour octet. Le porteur ajoute en plus `.vs/` (1016 lignes de config Visual Studio) : residu, jamais a fusionner. |
| `run-242f2ecb420d-1` | `26936f69471ef2df5b7366e305f85a1f6b98bf0f` | SUPERSEDED | `outlook-local-marquer-lu.ps1` IDENTIQUE a main ; `outlook-local.ts` du porteur est un SOUS-ENSEMBLE strict de main (0 ligne exclusive, 139 lignes en plus sur main). Ses tests : 3/4 fichiers verts ; le 4e (`security-critical-fixes.test.ts`) echoue sur un COMPTEUR perime (`toHaveLength(167)` alors que main en attend 174, ligne 371) — pas sur du contenu absent. Ses lignes exclusives de `src/preload/index.ts` sont l'ancien `workflowBench`, retire de main a dessein (`63c67761`). |
| `run-99bdb888b3fc-1` | `5269edcaa7449cda90961e8786c690b1c2a424dc` | SUPERSEDED | `outlook-local-reply.ps1` IDENTIQUE a main. Ses 2 fichiers de test : 61 tests verts sur main (exit 0). `sortByName` est sur main (`outlook-model.ts:514`), `home-threads` aussi (26 occurrences dans `HomeView.css`). |
| `run-a229741a8742-1` | `972aa4f2ce04013a223c346fa7bf14745b06bc2c` | SUPERSEDED | Chaque apport retrouve sur main : `parleDesQuatre` (`arena-protocole-check.mjs`), `avantLaReponseEnCours: false` (`directive-dans-le-fil.ts:54`), les filtres `ANNOTATION`/`LIGNE_MUSICALE`/`GENERIQUE` (`whisper-local.ts:259/312/322`, version evoluee), le brief build « au SITE D'APPEL » (`phase-briefs.ts`), le kaizen `/arena` « ne se demande pas » (`skills/arena/SKILL.md`). Ses tests : 4/5 fichiers verts ; `arena-protocole-check.test.mjs` echoue parce que son GABARIT de banc est anterieur aux points P16-P22 ajoutes depuis — la version de main du meme fichier passe 53/53. |

Action : les 5 porteurs sont supprimes (copies de travail retirees, branches effacees). Rien
n'est perdu : `git branch <nom> <sha>` avec les SHA du tableau les fait revenir tant que
`git gc` n'a pas passe. Aucun `gc`, aucun `reflog expire`, aucun `worktree prune` lance.

Le correctif D3 (`ChatComposer.tsx` — le ref ecrit pendant le rendu) etait deja entre dans le
depot par `03d7e38a` : `npx eslint --no-cache src/renderer/src/components/ChatComposer.tsx`
sort 0 erreur (exit 0). Il n'y avait donc rien a rapatrier de la copie du run bloque
(`889095b4`, deja ancetre de main).
