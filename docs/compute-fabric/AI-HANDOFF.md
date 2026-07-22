# Passation IA — adapter un runtime à Autowin Compute Fabric

Ce document est destiné à être remis avec `artifacts/compute-fabric-context.md` à une IA qui devra intégrer un runtime encore inconnu aujourd’hui.

## Ce que la future IA doit recevoir

1. Le bundle fraîchement généré :

   ```bash
   npm run context:compute-fabric
   npm run context:compute-fabric -- --check
   ```

   Le second appel doit confirmer le même `sourceFingerprint`. Si le frontmatter indique `DRAFT_DIRTY`, traiter le bundle comme un snapshot vérifiable du worktree, pas comme une publication reconstruisible depuis `HEAD`.

2. Les informations propres au serveur, fournies séparément et sans secret dans le chat :

   - OS et architecture ;
   - runtime choisi et version exacte ;
   - modèle exact et format de poids ;
   - endpoint/API réellement disponible ;
   - mode de déploiement d’Autowin Node ;
   - méthode d’authentification prévue ;
   - accès réseau et certificat public ;
   - capacités voulues : texte, tool-calling, agent distant éventuel.

3. Si possible, une capture ou réponse brute **redacted** d’un appel chat et d’un appel d’outil natif. Une documentation commerciale ne remplace pas une sonde sur le runtime réellement installé.

## Prompt de passation prêt à copier

```text
Tu dois adapter le runtime [NOM + VERSION] et le modèle [NOM EXACT] à Autowin Compute Fabric.

Lis d’abord `workspaceStatus`, `sourceFingerprint`, la provenance Git par fichier et le résultat de tests du bundle joint. Distingue strictement :
- IMPLEMENTED : observé dans les sources/tests ;
- TARGET : contrat à construire ;
- BLOCKED/UNKNOWN : non prouvé.

Contraintes non négociables :
1. Le desktop Autowin garde la boucle et exécute les outils locaux.
2. Le Node ne reçoit aucun accès direct au PC et n’exécute rien en mode local-tools.
3. Le domaine Autowin reste indépendant du runtime : toute particularité [runtime] vit dans un adaptateur Node.
4. Le principal Fabric ne voit jamais AppCommandBus.catalog() complet, orchestrate ou un shell libre.
5. Aucun fallback vers Codex, OmniRoute, Claude ou un autre agent.
6. Le contrat cible est autowin.tool-stream/v1 : SSE typé + continuation HTTP.
7. Toute capacité annoncée doit être reliée à une sonde ou documentation exacte de la version installée.
8. Ne jamais inventer un champ externe, une limite, un rôle de message ou un format tool-call.

Mission :
A. Sonde en lecture seule l’API réelle du runtime.
B. Produis une matrice source → champ Autowin pour manifeste, chat, stream, tool_call, tool_result, session, usage et cancel.
C. Nomme chaque divergence ou information inconnue.
D. Propose l’adaptateur Node minimal ; ne modifie le contrat Desktop que si une impossibilité est démontrée par un cas reproductible.
E. Fournis des fixtures redacted et des tests négatifs : événement incomplet, replay, mauvais digest, mauvais ordre, cancel et outil inconnu.
F. Ne déclare pas l’intégration terminée sans un cycle réel modèle → tool_call → outil local → continuation → réponse finale et sans preuve d’absence de fallback.

Commence par un rapport de compatibilité, pas par du code. Cite chaque fait par source/version/sonde.
```

## Questions auxquelles la future IA doit répondre

### Identité et déploiement

- Autowin Node tourne-t-il sur la même machine que le runtime ?
- Quel processus possède la clé Ed25519 ?
- Comment la clé et le certificat sont-ils provisionnés/rotés ?
- Quelle origine HTTPS exacte est exposée ?
- Le pin SPKI peut-il être affiché et confirmé hors bande ?

Le Desktop attend `tlsSpkiSha256` : SHA-256 hexadécimal lowercase du SPKI DER du certificat TLS pair. Le pin doit être copié depuis cette source hors bande ; il n’est jamais déduit de la clé Ed25519 du manifeste.

### Chat

- Endpoint et schéma réels ?
- System prompt séparé ou message système ?
- Streaming SSE, JSONL, WebSocket ou autre ?
- Identifiant de session stable ?
- Usage tokens remonté ou non ?
- Timeout et annulation disponibles ?

### Tool-calling

- Function calling natif réellement supporté par ce modèle précis ?
- Template/tokenizer attendu par le runtime ?
- Appels parallèles possibles et désactivables ?
- Arguments garantis JSON complets ?
- Format du résultat et rôle attendu ?
- Reprise après résultat ?
- Comportement si le modèle produit du texte et un appel dans le même tour ?

### Limites

- Contexte réel du modèle chargé, pas valeur marketing ?
- Limite de sortie ?
- Concurrence réelle du serveur ?
- Taille maximale du catalogue ?
- Backpressure et files ?

## Livrables attendus côté adaptateur Node

- mapping de manifeste avec sources de chaque champ ;
- adaptateur runtime isolé et versionné ;
- conversion `ToolSpec Autowin → dialecte runtime` ;
- normalisation des fragments en événement complet `tool_call` ;
- conversion `tool_result → dialecte runtime` ;
- continuation et annulation ;
- erreurs bornées sans fuite ;
- fixture reproductible ;
- contrôles négatifs ;
- matrice des capacités annoncées/non supportées.

## Ce que la future IA ne doit pas faire

- ajouter `if (modelName.includes('mistral'))` dans le desktop ;
- déduire `contextTokens` depuis un nom commercial ;
- exposer directement Ollama/vLLM/Open WebUI au renderer ;
- réutiliser `orchestrate` comme preuve que le modèle distant sait utiliser les outils ;
- passer `NODE_TLS_REJECT_UNAUTHORIZED=0` ;
- envoyer un chemin absolu ou un `cwd` au modèle ;
- parser et exécuter un fragment de stream ;
- stocker bearer/PEM dans le manifeste, un profil ou le bundle ;
- transformer un test écrit le même jour en preuve d’absence de la classe de bug.

## Premier jalon universel

Quel que soit le modèle choisi, le premier oracle est identique :

```text
modèle distant
  → tool_call(app.get_state.v1)
  → validation/projection locale
  → exécution AppCommandBus locale redacted
  → tool_result via continuation
  → réponse finale utilisant le résultat
```

Ce jalon n’accorde aucun accès fichier. Il valide le protocole, l’identité, l’ordre, l’autorité et l’absence de fallback avant d’ouvrir un `WorkspaceLease`.

## Jalon workspace

Ensuite seulement :

```text
WorkspaceLease read-only créé localement
  → workspace.read
  → workspace.search
  → résultats bornés/redacted
```

Mutation et processus forment une tranche distincte avec `LocalToolGrant`, précondition SHA-256, approbation, timeout et contrôle négatif.

## Autorité de clôture

Un rapport ou un score produit par l’IA n’est pas une preuve. Exiger :

- tests déterministes avec exit code ;
- requêtes/réponses redacted capturées ;
- hashes des artefacts ;
- runtime/model/version exacts ;
- capture UI fraîche si la promesse est visible ;
- confirmation humaine pour les décisions d’infrastructure ou de droits.
