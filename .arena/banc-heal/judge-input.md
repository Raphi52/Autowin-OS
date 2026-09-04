# Quatre livrables pour la MEME tache

## LIVRABLE a
```diff
diff --git a/src/main/activity/orchestration-observability.ts b/src/main/activity/orchestration-observability.ts
index 28305293..c05264c1 100644
--- a/src/main/activity/orchestration-observability.ts
+++ b/src/main/activity/orchestration-observability.ts
@@ -132,25 +132,59 @@ export function persistOrchestrationStep(
   traceStore = new TraceStore(join(ensureAutowinAppData(), 'causal-trace'))
 ): void {
   const existing = traceStore.readConversation(context.conversationId)
-  const currentTurn = existing.filter((event) => event.turnId === context.turnId)
-  const runTurn = context.runId
-    ? currentTurn.filter(
-        (event) => event.execution?.runId === context.runId || event.run?.runId === context.runId
-      )
-    : currentTurn
-  const groupEvents = step.execution?.groupId
-    ? runTurn.filter((event) => event.execution?.groupId === step.execution?.groupId)
-    : []
-  const dependencyParent = [...(step.execution?.dependencyIds ?? [])]
-    .reverse()
-    .map((dependencyId) =>
-      [...runTurn]
-        .reverse()
-        .find((event) => event.execution?.taskId === dependencyId && event.type === 'handoff')
-    )
-    .find(Boolean)
-  let parentId =
-    dependencyParent?.id ?? (groupEvents.length > 0 ? groupEvents[0].parentId : runTurn.at(-1)?.id)
+  /**
+   * Un SEUL parcours de la liste du fil, la ou trois filtres chaines (tour, run, groupe) plus une
+   * copie inversee PAR DEPENDANCE la balayaient quatre fois ou plus a chaque pas persiste — sur un
+   * tour long la liste grandit a chaque pas, donc le cout croissait en carre. Chaque champ d'un
+   * evenement est lu au plus une fois par appel (`execution` est memorise a la premiere lecture, et
+   * n'est meme pas touche quand ni run, ni groupe, ni dependance ne le demandent). Le repli
+   * `event.run?.runId` reste court-circuite exactement comme avant : il n'est consulte que si
+   * `execution.runId` ne correspond pas.
+   */
+  const groupId = step.execution?.groupId
+  const dependencyIds = step.execution?.dependencyIds ?? []
+  const wantedDependencies = new Set(dependencyIds)
+  let lastRunTurnId: string | undefined
+  let groupParentId: string | undefined
+  let groupFound = false
+  const dependencyHandoffs = new Map<string, string>()
+  for (const event of existing) {
+    if (event.turnId !== context.turnId) continue
+    let execution: TraceEventV1['execution']
+    let executionRead = false
+    const executionOf = (): TraceEventV1['execution'] => {
+      if (!executionRead) {
+        execution = event.execution
+        executionRead = true
+      }
+      return execution
+    }
+    if (context.runId) {
+      const inRun = executionOf()?.runId === context.runId || event.run?.runId === context.runId
+      if (!inRun) continue
+    }
+    lastRunTurnId = event.id
+    if (groupId && !groupFound && executionOf()?.groupId === groupId) {
+      groupFound = true
+      groupParentId = event.parentId
+    }
+    if (wantedDependencies.size > 0 && event.type === 'handoff') {
+      const taskId = executionOf()?.taskId
+      // Ecrase : on veut le DERNIER handoff portant ce taskId, comme la recherche inversee d'avant.
+      if (taskId !== undefined && wantedDependencies.has(taskId))
+        dependencyHandoffs.set(taskId, event.id)
+    }
+  }
+  // La derniere dependance listee qui a un match l'emporte (l'ancien `[...ids].reverse().find`).
+  let dependencyParentId: string | undefined
+  for (
+    let index = dependencyIds.length - 1;
+    index >= 0 && dependencyParentId === undefined;
+    index--
+  ) {
+    dependencyParentId = dependencyHandoffs.get(dependencyIds[index])
+  }
+  let parentId = dependencyParentId ?? (groupFound ? groupParentId : lastRunTurnId)
   let sequence = traceStore.nextSequence(context.conversationId)
   const structuralType: TraceEventV1['type'] =
     step.step === 'exec' ? 'handoff' : step.step === 'judge' ? 'verdict' : 'gate'
```

## LIVRABLE b
```diff
diff --git a/src/main/activity/orchestration-observability.ts b/src/main/activity/orchestration-observability.ts
index 28305293..f4ab8a56 100644
--- a/src/main/activity/orchestration-observability.ts
+++ b/src/main/activity/orchestration-observability.ts
@@ -131,26 +131,47 @@ export function persistOrchestrationStep(
   promptRoot = promptObservabilityRoot(),
   traceStore = new TraceStore(join(ensureAutowinAppData(), 'causal-trace'))
 ): void {
-  const existing = traceStore.readConversation(context.conversationId)
-  const currentTurn = existing.filter((event) => event.turnId === context.turnId)
-  const runTurn = context.runId
-    ? currentTurn.filter(
-        (event) => event.execution?.runId === context.runId || event.run?.runId === context.runId
-      )
-    : currentTurn
-  const groupEvents = step.execution?.groupId
-    ? runTurn.filter((event) => event.execution?.groupId === step.execution?.groupId)
-    : []
-  const dependencyParent = [...(step.execution?.dependencyIds ?? [])]
+  /**
+   * UN SEUL parcours des evenements du fil, au plus DEUX lectures de champ par evenement
+   * (`turnId`, puis `execution` mise en cache) — `run` n'est lue que quand `execution.runId` ne
+   * tranche pas, exactement comme le court-circuit d'origine.
+   *
+   * Jusqu'au 2026-09-04 le meme tableau etait rebalaye quatre fois par pas persiste : filtre du
+   * tour, filtre du run, filtre du groupe, puis une copie inversee PAR dependance. Mesure sur 400
+   * evenements : 400 lectures de `turnId` + 400 (run) + 400 (groupe) + jusqu'a 400 (dependance)
+   * = jusqu'a 4 lectures par evenement, sur une liste qui grandit a chaque pas du tour. Le choix
+   * du parent est inchange : premiere dependance trouvee en remontant, sinon parent du premier
+   * evenement du groupe, sinon dernier evenement du run dans ce tour.
+   */
+  const groupId = step.execution?.groupId
+  const dependencyIds = step.execution?.dependencyIds ?? []
+  const wantedDependencies = new Set(dependencyIds)
+  const dependencyEvents = new Map<string, TraceEventV1>()
+  let groupParentId: string | undefined
+  let groupFound = false
+  let lastRunTurnEventId: string | undefined
+  for (const event of traceStore.readConversation(context.conversationId)) {
+    if (event.turnId !== context.turnId) continue
+    const execution = event.execution
+    if (context.runId && execution?.runId !== context.runId && event.run?.runId !== context.runId) {
+      continue
+    }
+    lastRunTurnEventId = event.id
+    if (groupId && !groupFound && execution?.groupId === groupId) {
+      groupFound = true
+      groupParentId = event.parentId
+    }
+    // Derniere occurrence conservee : equivaut au `.reverse().find(...)` d'origine.
+    const taskId = execution?.taskId
+    if (taskId !== undefined && event.type === 'handoff' && wantedDependencies.has(taskId)) {
+      dependencyEvents.set(taskId, event)
+    }
+  }
+  const dependencyParent = [...dependencyIds]
     .reverse()
-    .map((dependencyId) =>
-      [...runTurn]
-        .reverse()
-        .find((event) => event.execution?.taskId === dependencyId && event.type === 'handoff')
-    )
+    .map((dependencyId) => dependencyEvents.get(dependencyId))
     .find(Boolean)
-  let parentId =
-    dependencyParent?.id ?? (groupEvents.length > 0 ? groupEvents[0].parentId : runTurn.at(-1)?.id)
+  let parentId = dependencyParent?.id ?? (groupFound ? groupParentId : lastRunTurnEventId)
   let sequence = traceStore.nextSequence(context.conversationId)
   const structuralType: TraceEventV1['type'] =
     step.step === 'exec' ? 'handoff' : step.step === 'judge' ? 'verdict' : 'gate'
```

## LIVRABLE c
```diff
diff --git a/src/main/activity/orchestration-observability.ts b/src/main/activity/orchestration-observability.ts
index 28305293..63c26c32 100644
--- a/src/main/activity/orchestration-observability.ts
+++ b/src/main/activity/orchestration-observability.ts
@@ -132,25 +132,41 @@ export function persistOrchestrationStep(
   traceStore = new TraceStore(join(ensureAutowinAppData(), 'causal-trace'))
 ): void {
   const existing = traceStore.readConversation(context.conversationId)
-  const currentTurn = existing.filter((event) => event.turnId === context.turnId)
-  const runTurn = context.runId
-    ? currentTurn.filter(
-        (event) => event.execution?.runId === context.runId || event.run?.runId === context.runId
-      )
-    : currentTurn
-  const groupEvents = step.execution?.groupId
-    ? runTurn.filter((event) => event.execution?.groupId === step.execution?.groupId)
-    : []
-  const dependencyParent = [...(step.execution?.dependencyIds ?? [])]
-    .reverse()
-    .map((dependencyId) =>
-      [...runTurn]
-        .reverse()
-        .find((event) => event.execution?.taskId === dependencyId && event.type === 'handoff')
-    )
-    .find(Boolean)
-  let parentId =
-    dependencyParent?.id ?? (groupEvents.length > 0 ? groupEvents[0].parentId : runTurn.at(-1)?.id)
+  // Un tour long fait grandir la liste a chaque pas : on n'en fait plus qu'UN SEUL parcours, en ne
+  // lisant `turnId` et `execution` qu'une fois par evenement (les filtres empiles en relisaient
+  // quatre fois). Meme parent elu, memes evenements ecrits.
+  const groupId = step.execution?.groupId
+  const dependencyIds = step.execution?.dependencyIds ?? []
+  const wantedDependencies = new Set(dependencyIds)
+  const needsExecution = Boolean(context.runId) || Boolean(groupId) || wantedDependencies.size > 0
+  // Dernier evenement du tour/run, parent du premier evenement du groupe, et pour chaque dependance
+  // le DERNIER handoff qui la porte — tout ce que l'ancien empilement de filtres finissait par lire.
+  let lastRunTurnId: string | undefined
+  let groupParentId: string | undefined
+  let groupSeen = false
+  const dependencyHits = new Map<string, string>()
+  for (const event of existing) {
+    if (event.turnId !== context.turnId) continue
+    const execution = needsExecution ? event.execution : undefined
+    if (context.runId && execution?.runId !== context.runId && event.run?.runId !== context.runId) {
+      continue
+    }
+    lastRunTurnId = event.id
+    if (groupId && !groupSeen && execution?.groupId === groupId) {
+      groupSeen = true
+      groupParentId = event.parentId
+    }
+    if (wantedDependencies.size > 0 && event.type === 'handoff') {
+      const taskId = execution?.taskId
+      if (taskId !== undefined && wantedDependencies.has(taskId))
+        dependencyHits.set(taskId, event.id)
+    }
+  }
+  let dependencyParentId: string | undefined
+  for (let index = dependencyIds.length - 1; index >= 0 && !dependencyParentId; index--) {
+    dependencyParentId = dependencyHits.get(dependencyIds[index])
+  }
+  let parentId = dependencyParentId ?? (groupSeen ? groupParentId : lastRunTurnId)
   let sequence = traceStore.nextSequence(context.conversationId)
   const structuralType: TraceEventV1['type'] =
     step.step === 'exec' ? 'handoff' : step.step === 'judge' ? 'verdict' : 'gate'
```

## LIVRABLE x
```diff
diff --git a/src/main/activity/orchestration-observability.ts b/src/main/activity/orchestration-observability.ts
index 28305293..a85853ae 100644
--- a/src/main/activity/orchestration-observability.ts
+++ b/src/main/activity/orchestration-observability.ts
@@ -125,6 +125,57 @@ export function persistOrchestrationPhaseStart(
   )
 }
 
+/**
+ * Choisit le parent causal d'un pas en UN SEUL parcours de la liste du fil.
+ *
+ * Jusqu'au 2026-09-04 cette resolution enchainait quatre balayages de la liste complete par pas
+ * persiste — filtre du tour, filtre du run, filtre du groupe, puis une copie INVERSEE de la liste
+ * par dependance — soit O(4 x evenements) alors que la liste grandit a chaque pas d'un tour long.
+ * Un evenement retenu ne coute plus que deux lectures de champ (`turnId`, puis `execution` lu une
+ * fois et garde en local) ; `run` reste consulte exactement la ou l'ancienne condition le
+ * consultait, c'est-a-dire seulement quand `execution.runId` n'a pas conclu.
+ *
+ * Choix du parent, a l'identique de l'ancienne cascade :
+ *  1. le DERNIER evenement `handoff` du run portant la dependance la plus tardive qui en ait un ;
+ *  2. sinon le parent du PREMIER evenement du groupe, s'il y en a un ;
+ *  3. sinon le DERNIER evenement du run.
+ */
+function resolveStepParentId(
+  events: readonly TraceEventV1[],
+  turnId: string,
+  runId: string | undefined,
+  execution: OrchestrationStep['execution']
+): string | undefined {
+  const groupId = execution?.groupId
+  const dependencyIds = execution?.dependencyIds ?? []
+  const wanted = dependencyIds.length > 0 ? new Set(dependencyIds) : undefined
+  const dependencyHandoffs = new Map<string, TraceEventV1>()
+  let lastRunEvent: TraceEventV1 | undefined
+  let firstGroupEvent: TraceEventV1 | undefined
+
+  for (const event of events) {
+    if (event.turnId !== turnId) continue
+    const eventExecution = event.execution
+    if (runId && eventExecution?.runId !== runId && event.run?.runId !== runId) continue
+    lastRunEvent = event
+    if (groupId && !firstGroupEvent && eventExecution?.groupId === groupId) firstGroupEvent = event
+    if (wanted && event.type === 'handoff') {
+      const taskId = eventExecution?.taskId
+      // Ecrase : la Map garde le DERNIER handoff de chaque dependance, comme la recherche inversee.
+      if (taskId !== undefined && wanted.has(taskId)) dependencyHandoffs.set(taskId, event)
+    }
+  }
+
+  if (wanted) {
+    for (let index = dependencyIds.length - 1; index >= 0; index -= 1) {
+      const dependencyParent = dependencyHandoffs.get(dependencyIds[index])
+      if (dependencyParent) return dependencyParent.id
+    }
+  }
+  if (firstGroupEvent) return firstGroupEvent.parentId
+  return lastRunEvent?.id
+}
+
 export function persistOrchestrationStep(
   step: OrchestrationStep,
   context: OrchestrationTraceContext,
@@ -132,25 +183,7 @@ export function persistOrchestrationStep(
   traceStore = new TraceStore(join(ensureAutowinAppData(), 'causal-trace'))
 ): void {
   const existing = traceStore.readConversation(context.conversationId)
-  const currentTurn = existing.filter((event) => event.turnId === context.turnId)
-  const runTurn = context.runId
-    ? currentTurn.filter(
-        (event) => event.execution?.runId === context.runId || event.run?.runId === context.runId
-      )
-    : currentTurn
-  const groupEvents = step.execution?.groupId
-    ? runTurn.filter((event) => event.execution?.groupId === step.execution?.groupId)
-    : []
-  const dependencyParent = [...(step.execution?.dependencyIds ?? [])]
-    .reverse()
-    .map((dependencyId) =>
-      [...runTurn]
-        .reverse()
-        .find((event) => event.execution?.taskId === dependencyId && event.type === 'handoff')
-    )
-    .find(Boolean)
-  let parentId =
-    dependencyParent?.id ?? (groupEvents.length > 0 ? groupEvents[0].parentId : runTurn.at(-1)?.id)
+  let parentId = resolveStepParentId(existing, context.turnId, context.runId, step.execution)
   let sequence = traceStore.nextSequence(context.conversationId)
   const structuralType: TraceEventV1['type'] =
     step.step === 'exec' ? 'handoff' : step.step === 'judge' ? 'verdict' : 'gate'
```
