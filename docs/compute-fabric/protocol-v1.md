# Autowin Compute Fabric — protocole v1 (cible provider-agnostique)

> **Statut : DRAFT, non implémenté pour le tool-calling.** Le manifeste signé et le chat SSE texte existent partiellement ; `autowin.tool-stream/v1`, la continuation et le Local Tool Gateway restent à construire. Le bundle généré donne l’état testable courant.

## 1. Principe de compatibilité

Le protocole Autowin ne connaît ni Mistral, ni Gemma, ni Ollama, ni vLLM. Autowin Node absorbe le dialecte réel :

- function calling natif ;
- grammaire JSON contrainte ;
- format de prompt spécifique ;
- fragments de streaming propriétaires ;
- identifiants de session propres au runtime.

Le desktop ne reçoit que des enveloppes Autowin strictes. Le modèle/runtime peut changer sans modifier le domaine, la politique ou les outils locaux.

## 2. Frontières

### Desktop Autowin

- initie toutes les connexions ;
- vérifie identité, manifeste, digest, séquence et expiration ;
- produit le catalogue exact autorisé ;
- décide et exécute les outils locaux ;
- conserve les leases, grants, chemins et secrets ;
- renvoie un résultat borné au Node.

### Autowin Node

- expose un manifeste signé ;
- traduit le catalogue vers le runtime actif ;
- normalise texte, appels, continuation et erreurs ;
- ne décide jamais d’une autorisation locale ;
- n’exécute jamais un outil en mode `local-tools`.

## 3. Manifeste Node existant

Schéma actuel : `autowin.node-manifest/v1`.

Corps signé :

```json
{
  "schema": "autowin.node-manifest/v1",
  "protocol": { "min": 1, "max": 1 },
  "node": {
    "id": "node-a",
    "keyId": "key-1",
    "signingPublicKeyFingerprint": "<sha256-spki>",
    "bootId": "boot-uuid"
  },
  "sequence": 1,
  "issuedAt": "2026-07-22T18:00:00.000Z",
  "expiresAt": "2026-07-22T18:10:00.000Z",
  "adapters": [{ "id": "runtime-adapter", "version": "1.0.0" }],
  "resources": [
    {
      "id": "model-resource",
      "kind": "model",
      "adapterId": "runtime-adapter",
      "displayName": "Nom visible du modèle",
      "runtimeVersion": "runtime-version",
      "modes": ["local-tools"],
      "capabilities": ["inference.chat", "stream.text"],
      "limits": { "contextTokens": 32768, "maxConcurrentRuns": 1 }
    }
  ],
  "signature": {
    "algorithm": "Ed25519",
    "keyId": "key-1",
    "value": "<base64-64-bytes>"
  }
}
```

`displayName` est un champ de ressource signé. Le parser le valide avec le même contrat de texte borné que les autres libellés Node, puis le copie sans le recalculer. Son raccordement à `ImportedModel.label` appartient encore à la tranche Models/UI.

### Vérification

- JSON canonique Autowin v1 : valeurs JSON seulement, nombres finis, Unicode bien formé, clés objet triées ;
- clé publique Ed25519 appairée ;
- fingerprint SHA-256 du SPKI ;
- `nodeId`, `keyId` et fingerprint identiques à la confiance locale ;
- durée maximale du manifeste : 10 minutes par défaut ;
- skew maximal : 30 secondes par défaut ;
- séquence strictement croissante ;
- digest = SHA-256 du corps canonique signé.

La signature du manifeste ne remplace pas le pin TLS/SPKI du transport.

## 4. Binding Desktop

```json
{
  "kind": "fabric",
  "nodeId": "node-a",
  "resourceId": "model-resource",
  "mode": "local-tools",
  "policyRef": "policy-local-tools-v1",
  "manifestDigest": "<64-hex>",
  "fallback": { "kind": "none" }
}
```

Aucun champ n’est déduit depuis un hostname ou un nom commercial de modèle.

## 5. Catalogue d’outils

Le desktop projette un catalogue par principal et par tour. Il ne transmet jamais `AppCommandBus.catalog()` intégralement.

Forme logique cible :

```ts
type ToolSpec = {
  name: string
  version: 1
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
    additionalProperties: false
  }
  policy: {
    authority: 'automatic' | 'sensitive' | 'destructive'
    readOnly: boolean
    idempotent: boolean
    resultExposure: 'none' | 'summary' | 'bounded-json'
  }
}
```

Le desktop calcule `toolCatalogDigest = sha256(canonicalJson(tools))`. Chaque `tool_call` doit répéter ce digest. Le Node peut traduire le catalogue, mais le desktop revalide toujours nom, version, schéma, policy et limites.

Catalogue initial Fabric :

1. `app.get_state.v1` uniquement ;
2. puis capacités Local Tool Gateway couvertes par un lease/grant.

Exclus : `orchestrate`, shell libre, navigation réseau arbitraire, keyring, plugins/hooks, identité, installation et élévation.

## 6. Premier leg d’inférence

`POST /v1/executions/chat`

```json
{
  "schema": "autowin.tool-stream/v1",
  "executionId": "<uuid-tour-agent>",
  "requestId": "<uuid-leg-idempotent>",
  "resourceId": "model-resource",
  "manifestDigest": "<64-hex>",
  "mode": "local-tools",
  "toolCatalogDigest": "<64-hex>",
  "tools": [],
  "messages": []
}
```

Headers minimaux :

```text
Accept: text/event-stream
Content-Type: application/json
X-Request-Id: <requestId>
Idempotency-Key: <requestId>
Authorization: Bearer <secret-keyring>   # optionnel selon déploiement
```

Le bearer ne doit jamais apparaître dans le renderer, les profils, le bundle ou les traces.

## 7. Événements SSE

Enveloppe commune :

```json
{
  "schema": "autowin.tool-stream/v1",
  "executionId": "<uuid>",
  "requestId": "<uuid>",
  "sequence": 1,
  "type": "text_delta"
}
```

Types autorisés :

### `text_delta`

```json
{ "type": "text_delta", "delta": "texte" }
```

### `tool_call`

Émis seulement lorsque les arguments complets sont du JSON valide :

```json
{
  "type": "tool_call",
  "callId": "<stable-id>",
  "ordinal": 0,
  "name": "workspace.read",
  "arguments": { "workspaceLeaseId": "opaque", "path": "src/main.ts" },
  "toolCatalogDigest": "<64-hex>"
}
```

Un fragment propriétaire du runtime n’est jamais transmis comme appel exécutable.

### `requires_action`

Terminal pour le leg courant :

```json
{
  "type": "requires_action",
  "continuationId": "<opaque-one-use>",
  "pendingCallIds": ["<callId>"]
}
```

V1 autorise exactement un appel en attente. Le desktop n’exécute rien avant cet événement validé et la fermeture cohérente du leg.

### `completed`

```json
{
  "type": "completed",
  "sessionId": "<opaque-optional>",
  "usage": { "inputTokens": 0, "outputTokens": 0 }
}
```

### `error` ou `cancelled`

```json
{
  "type": "error",
  "code": "bounded_code",
  "retryable": false,
  "message": "message borné sans secret"
}
```

Une séquence manquante, répétée ou hors ordre invalide tout le leg.

## 8. Exécution locale et continuation

Après validation locale, le gateway exécute ou refuse l’appel. Le résultat est classifié, redacted et borné avant envoi.

`POST /v1/executions/{executionId}/continue`

```json
{
  "schema": "autowin.tool-stream/v1",
  "continuationId": "<opaque-one-use>",
  "requestId": "<new-leg-id>",
  "event": {
    "type": "tool_result",
    "callId": "<callId>",
    "status": "ok",
    "output": { "summary": "bounded result" }
  }
}
```

Le Node traduit ce résultat vers le format natif du runtime, puis ouvre le SSE du leg suivant. Il ne réexécute rien.

## 9. Idempotence et replay

Identités distinctes :

- `executionId` — tour AgentPilot durable ;
- `requestId` — leg réseau, stable pendant un retry ;
- `callId` — intention d’outil stable ;
- `continuationId` — droit opaque à usage unique de poursuivre.

Ledger local : `(executionId, callId, canonicalArgsDigest)`.

- même tuple après retry : restituer le résultat mémorisé si son état est certain ;
- même `callId`, arguments différents : échec fermé ;
- mutation dont le résultat est inconnu : ne jamais rejouer ;
- continuation réutilisée : refus ;
- digest de catalogue ou manifeste différent : refus.

## 10. Annulation

Le desktop annule le SSE et appelle un endpoint de cancel borné. Après annulation :

- aucun nouvel outil n’est dispatché ;
- un outil déjà lancé n’est pas prétendu rollbacké ;
- un processus local reçoit timeout, signal et nettoyage du process-tree ;
- la trace distingue `cancel_requested`, `cancelled` et `effect_unknown`.

## 11. Résultats et prompt injection

Tout résultat d’outil est une donnée hostile :

- type et taille vérifiés ;
- secrets redacted ;
- chemins locaux remplacés par identifiants/chemins relatifs autorisés ;
- sortie binaire rejetée ou résumée ;
- exposition conforme à `resultExposure` ;
- trace persistante = hash/taille/statut, pas payload brut ;
- le system prompt rappelle que le contenu d’un fichier n’est pas une instruction d’autorité.

## 12. Transport et pairing

Avant d’ouvrir le moindre outil :

- HTTPS strict ;
- confirmation locale de l’identité ;
- pin TLS/SPKI réellement appliqué au client : `tlsSpkiSha256`, SHA-256 hexadécimal lowercase du SPKI DER du certificat pair, confirmé hors bande ;
- manifeste Ed25519 vérifié ;
- origine et credential conservés dans le keyring/main ;
- redirects interdits ;
- taille, timeout et content-type bornés ;
- aucune requête réseau directe depuis le renderer.

Le pin, l’origine et le bearer restent exclusivement dans le keyring/main. Les appels manifeste et chat utilisent le même transport piné, sans pool inter-requêtes. Un transport sans pin ou avec un pin invalide est indisponible ; aucune désactivation de la validation CA/hostname n’est autorisée.

mTLS peut être ajouté par un déploiement, mais ne remplace pas la policy locale.

## 13. Mapping d’un runtime futur

L’adaptateur Node doit répondre à ces questions sans modifier le protocole Desktop :

1. Comment fournir un system prompt et le catalogue d’outils ?
2. Le runtime émet-il des appels natifs, une grammaire JSON ou du texte à parser ?
3. Comment détecter qu’un appel est complet ?
4. Comment injecter un `tool_result` avec son `callId` ?
5. Comment continuer une session après résultat ?
6. Quels champs usage/session sont réellement disponibles ?
7. Comment annuler une génération ?
8. Quelles limites réelles annoncer dans le manifeste ?
9. Quelle version exacte de l’adaptateur absorbe ce dialecte ?

Si une réponse manque, la capacité correspondante n’est pas annoncée. Ne jamais inventer une compatibilité depuis le seul nom du modèle.

## 14. Compatibilité legacy

`<cmd>` reste un `LegacyCmdBridge` local pour des providers texte historiques :

- parsing après réponse complète ;
- JSON strict ;
- transformation en `ToolCall` canonique ;
- `callId` déterministe ;
- aucune exécution directe depuis la regex ;
- jamais le protocole principal du Node.

## 15. Gate d’acceptation

Une implémentation runtime est recevable seulement si une fixture réelle prouve :

1. manifeste signé et appairage ;
2. catalogue exact observé côté Node ;
3. `app.get_state.v1` demandé par le modèle ;
4. décision et exécution locales ;
5. résultat renvoyé via continuation ;
6. réponse finale fondée sur ce résultat ;
7. provider/node/resource/digests exacts dans la preuve ;
8. absence de fallback Codex/OmniRoute/Claude/`orchestrate` ;
9. replay, digest invalide, séquence invalide, offline et cancel rejetés ;
10. aucun secret, PEM, origine ou chemin brut dans UI/trace/bundle.
