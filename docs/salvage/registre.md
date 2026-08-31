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
