# Autowin Compute Fabric — contexte stable pour humains et IA

> Point d’entrée canonique, indépendant du modèle et du runtime. Mistral, Gemma, Ollama, vLLM, Open WebUI ou un produit futur sont des **adaptateurs du Node**, jamais le contrat métier d’Autowin.

## Utilisation rapide

Pour produire un fichier autonome à remettre à une autre IA :

```bash
npm run context:compute-fabric
npm run context:compute-fabric -- --check
```

Le résultat est écrit dans `artifacts/compute-fabric-context.md`. Ce bundle contient :

- ce dossier de conception ;
- les sources et tests qui font autorité, complets ou bornés par plages ;
- les SHA-256 calculés sur les octets bruts ;
- l’état Git et le blob HEAD de chaque fichier ;
- un `sourceFingerprint` stable, indépendant du timestamp ;
- un statut `CLEAN` ou `DRAFT_DIRTY` ;
- un replay frais des suites Compute Fabric.

`--check` refuse un artefact absent ou dont le fingerprint ne correspond plus aux fichiers courants. Le générateur refuse aussi tout nouveau fichier sous `src/main/compute-fabric/` absent de l’allowlist, ainsi que tout test exécuté mais invisible dans le bundle.

Un bundle `DRAFT_DIRTY` reste vérifiable par ses hashes, mais ne doit pas être présenté comme reproductible depuis `HEAD`.

Ne transmettre ni `.env`, ni keyring, ni token, ni certificat privé. Le générateur n’en dépend pas.

## Hiérarchie de vérité

En cas de divergence :

1. exécution et tests frais ;
2. parseurs/types réellement présents dans `src/` ;
3. bundle généré et ses hashes ;
4. documents de ce dossier ;
5. notes historiques ou conversationnelles.

Une affirmation datée n’est jamais une preuve de l’état courant. Régénérer le bundle avant chaque passation.

## Problème réel

Autowin doit pouvoir utiliser une ressource d’IA située sur une autre machine sans :

- coupler le desktop à un fournisseur ou runtime précis ;
- donner au serveur un accès direct au PC ;
- confondre l’IA qui raisonne avec l’agent qui exécute ;
- basculer silencieusement vers Codex, OmniRoute, Claude ou `orchestrate` ;
- exposer origine, bearer, clés, chemins locaux ou primitives d’exécution au renderer.

Deux placements explicites existent :

- `local-tools` : le modèle raisonne sur le Node, mais la boucle, les décisions et les outils restent sur le PC ;
- `remote-agent` : un agent s’exécute sur le serveur sous lease borné et avec preuves signées. Ce mode reste séparé et read-only dans la première tranche.

## Architecture cible

```text
Runtime futur (Mistral/Gemma/Ollama/vLLM/...)
                │ adaptateur privé au serveur
                ▼
        Autowin Node appairé
        manifeste signé + chat/tool stream
                │ HTTPS sortant depuis le PC
                ▼
   FabricControlPlane / FabricResourceAdapter
                │ intention tool_call seulement
                ▼
            AgentPilot local
                │
          ActionRouter projeté
          ├─ app.get_state.v1 redacted
          └─ LocalToolGateway
             ├─ workspace.read
             ├─ workspace.search
             ├─ workspace.patch
             └─ process.run-task
```

Le serveur **propose** un appel ; le main process local **décide et exécute**. Le renderer affiche et recueille une décision humaine, mais n’est jamais une autorité de sécurité.

## Responsabilités stables

| Composant          | Responsabilité                                             | Ne doit jamais faire                          |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------- |
| Autowin Desktop    | pairing, policy, leases, boucle, exécution locale, preuves | adapter son domaine à Mistral/Gemma           |
| Autowin Node       | identité, manifeste, normalisation du runtime, streaming   | exécuter un outil `local-tools`               |
| Adaptateur runtime | traduire prompt/catalogue/appels/résultats                 | modifier le contrat Autowin                   |
| Modèle distant     | raisonner et proposer des `tool_call`                      | choisir ses permissions ou chemins locaux     |
| Renderer           | UX, consentement, observabilité redacted                   | recevoir secrets, racines ou exécuteurs bruts |

## État courant honnête

### Présent dans le code

- contrat fermé `autowin.node-manifest/v1` ;
- `displayName` de ressource copié depuis le manifeste signé et borné par le parser ;
- modes `local-tools` et `remote-agent` ;
- binding Fabric pinné sur `nodeId`, `resourceId`, mode, `policyRef`, digest et `fallback:none` ;
- canonicalisation JSON restreinte, signature Ed25519, TTL et anti-rejeu ;
- transport HTTPS/bearer/pin `tlsSpkiSha256` séparé dans le keyring ;
- pin TLS/SPKI réellement appliqué au manifeste et au chat, après validation CA/hostname ;
- store de confiance atomique et fail-closed sur tout fichier existant illisible ou invalide ;
- control plane pair/refresh/list et snapshot offline ;
- adaptateur d’inférence SSE borné, séquencé, idempotent et `supportsExecution=false` ;
- registre capable d’accepter un transport `fabric:*` déjà enregistré ;
- boucle locale AgentPilot et décisions `plan|ask|auto` existantes.

### Présent mais incomplet ou dangereux pour les outils

- `policyRef`, limites et capacités signées ne sont pas encore appliqués par le chemin d’exécution ;
- les traces Pilot peuvent persister arguments et résultats bruts ;
- `AppCommandBus.catalog()` contient `orchestrate`, qui peut demander `danger-full-access` ;
- `ProviderRegistry` peut substituer un exécuteur local à un provider non-exécuteur.

### Non implémenté

- raccordement du control plane au composition root et au catalogue Models ;
- sélection/persistance complète du binding Fabric dans runtime/profils/IPC/UI ;
- `autowin.tool-stream/v1` ;
- catalogue projeté par principal et `toolCatalogDigest` ;
- `ActionRouter`, `LocalToolGateway`, `WorkspaceLease`, `LocalToolGrant` ;
- continuation, ledger anti-rejeu d’outil et annulation process-tree ;
- unpair/revoke complet ;
- fixture Node HTTPS E2E et preuve CDP finale.

Un transport keyring antérieur dépourvu de `tlsSpkiSha256` est volontairement refusé et exige un réappairage. Un fichier d’état Fabric existant mais corrompu reste intact et lève `FabricStateCorruptionError` avec le code stable `FABRIC_STATE_CORRUPT` : le control plane ne démarre pas sur un état de confiance vide de substitution.

## Invariants non négociables

1. La boucle agentique et l’autorité d’outil restent sur le PC en mode `local-tools`.
2. Le Node ne possède aucun endpoint de callback entrant vers le PC.
3. Un principal Fabric ne reçoit jamais le catalogue complet d’`AppCommandBus`.
4. `orchestrate`, shell libre, keyring, réseau arbitraire, plugins/hooks et élévation sont absents du catalogue Fabric.
5. Aucun fallback d’exécution : l’échec de la ressource choisie reste un échec explicite.
6. `authorityMode=auto` ne crée ni n’élargit un droit machine.
7. Le modèle ne fournit jamais une racine, un `cwd` ou un chemin absolu local.
8. Lecture et mutation sont des scopes séparés ; une lecture ne donne aucun droit d’écriture.
9. Un appel n’est exécuté qu’après réception complète et validation d’un événement terminal `requires_action`.
10. Les résultats d’outil sont hostiles : validation, taille, redaction et exposition minimale avant réinjection.
11. Arguments/résultats sensibles ne sont pas persistés ; les preuves portent hashes, tailles, décisions et statuts.
12. Signature du manifeste et TLS protègent des frontières différentes : les deux sont requis avant les outils.

## Autorité locale cible

### `WorkspaceLease`

Créé localement depuis une racine choisie par l’utilisateur :

- identifiant opaque transmis à la boucle ;
- racine canonique conservée seulement dans le main process ;
- mode `read` ou `write` ;
- expiration et budget ;
- refus de traversal, chemin absolu externe, symlink/junction/reparse point sortant, UNC et changement de volume.

### `LocalToolGrant`

Requis en plus pour mutation ou processus, lié à :

```text
conversationId + nodeId + resourceId + manifestDigest
+ workspaceLeaseId + scopes + expiresAt + maxCalls
```

Changement de binding/digest, révocation, expiration ou quota épuisé invalident le grant en échec fermé.

## Capacités par étapes

1. `app.get_state.v1` — projection fixe et redacted, sans fichiers.
2. `workspace.read` et `workspace.search` — lease read-only.
3. `workspace.patch` — grant, approbation et SHA-256 de précondition.
4. `process.run-task` — table locale `test|lint|typecheck|build`, argv construit localement, aucun shell libre.
5. MCP éventuel — adaptateur derrière le même gateway, jamais nouvelle autorité ni serveur générique exposé au Node.

Bornes initiales du frame : un appel en vol par conversation, 8 appels par tour, 20 par conversation, arguments ≤ 4 KiB, résultat réinjecté ≤ 64 KiB, budget cumulé ≤ 30 s avant nouvelle décision.

## Ordre d’implémentation

1. **Fermé** — appliquer le pin TLS/SPKI et rendre le store corrompu visible/fail-closed.
2. Introduire les contrats purs `ToolSpec`, `ToolCall`, `ToolResult`, continuation et ledger.
3. Prouver `app.get_state.v1` avec une fixture Node, sans accès fichier.
4. Ajouter le lease read-only et `workspace.read/search`.
5. Ajouter patch optimiste et tâches locales bornées.
6. Raccorder `displayName` et les bindings Fabric à Models, profils, IPC/UI, puis produire l’E2E frais.
7. Lancer une revue adversariale avant commit/push d’une frontière d’exécution.

## Cartographie des sources

Le fichier `context-sources.json` définit les documents, sources, plages et tests inclus dans le bundle. Les points d’entrée principaux sont :

- `src/shared/compute-fabric.ts` — contrat wire et binding ;
- `src/main/compute-fabric/manifest.ts` — canonicalisation et vérification Ed25519 ;
- `src/main/compute-fabric/fabric-http-client.ts` — HTTPS main-owned, CA/hostname et pin SPKI ;
- `src/main/compute-fabric/control-plane.ts` — pairing/refresh/projection ;
- `src/main/compute-fabric/resource-adapter.ts` — transport d’inférence actuel ;
- `src/main/providers/types.ts` — frontière provider à étendre de façon additive ;
- `src/main/providers/registry.ts` — routage et fallback à isoler ;
- `src/main/agent-pilot.ts` — boucle locale existante ;
- `src/main/commands.ts` — commandes applicatives, pas gateway machine ;
- `src/main/conversation-capabilities.ts` — sémantique d’autorité à conserver ;
- `src/main/bounded-file-read.ts` — primitives de confinement à généraliser.

## Règles pour une future IA

- Commencer par lire le frontmatter du bundle et son résultat de tests.
- Ne pas déclarer une suite verte si le bundle indique un exit code non nul.
- Ne pas renommer ou remplacer le contrat pour épouser une API Mistral/Gemma : écrire un adaptateur Node.
- Ne jamais transformer `<cmd>` en protocole réseau canonique ; il reste un bridge legacy local.
- Ne pas déduire une capacité depuis le nom du modèle/runtime ; la lire dans le manifeste signé.
- Ne pas inventer de champ externe : le copier depuis le manifeste, la configuration ou une réponse tracée.
- Préserver `supportsExecution=false` pour toute ressource `local-tools`.
- Ajouter chaque capacité par RED→GREEN avec un contrôle négatif qui prouve que la frontière peut échouer.

Voir aussi :

- [`protocol-v1.md`](./protocol-v1.md) — contrat cible Node ↔ Desktop ;
- [`AI-HANDOFF.md`](./AI-HANDOFF.md) — consigne prête à remettre à une IA chargée d’un runtime précis.
