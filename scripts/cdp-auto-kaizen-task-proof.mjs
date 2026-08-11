const value = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const port = Number(value('--port', process.env.AUTOWIN_CDP_PORT || '9223'))
const timeoutMs = Number(value('--timeout-ms', '120000'))
const reuseLatest = process.argv.includes('--reuse-latest')
const triggerEvent = process.argv.includes('--trigger-event')
const screenshotPath = value('--out', '')
const jsonOutputPath = value('--json-out', '')
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = pages.find((candidate) => candidate.type === 'page')
if (!page?.webSocketDebuggerUrl) throw new Error(`Aucune page CDP sur le port ${port}`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let sequence = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(message.error.message))
  else waiter.resolve(message.result)
})

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
    )
  }
  return response.result?.value
}

try {
  await send('Runtime.enable')
  await send('Page.enable')
  const proof = await evaluate(`new Promise(async (resolve, reject) => {
    const timeoutMs = ${JSON.stringify(timeoutMs)};
    const deadline = Date.now() + timeoutMs;
    const api = window.api;
    if (!api?.taskManagerSnapshot || !api?.taskManagerRunNow || !api?.pilotChat) {
      return reject(new Error('API Task Manager indisponible'));
    }
    const before = await api.taskManagerSnapshot();
    const task = before.tasks.find((candidate) =>
      candidate.title === 'Auto-kaizen — orchestration rouge ou workflow douteux'
    );
    if (!task) return reject(new Error('Tâche Auto-kaizen absente'));
    const previousIds = new Set(before.occurrences.map((entry) => entry.id));
    let sourceConversationId;
    if (!${JSON.stringify(reuseLatest)}) {
      if (${JSON.stringify(triggerEvent)}) {
        const source = await api.conversationsCreate({
          title: 'Preuve événementielle Auto-kaizen',
          category: 'codex',
          provider: 'codex'
        });
        sourceConversationId = source.id;
        await api.pilotChat(
          [{ role: 'user', content: '[[autowin-fixture-auto-kaizen-error]]' }],
          source.id
        );
      } else {
        const started = await api.taskManagerRunNow(task.id);
        if (!started?.started) return reject(new Error('Lancement manuel refusé'));
      }
    }

    const poll = async () => {
      const snapshot = await api.taskManagerSnapshot();
      const occurrence = snapshot.occurrences.find((entry) => {
        const expectedTrigger = ${JSON.stringify(triggerEvent)} ? 'watchdog' : 'manual';
        const triggerMatches = entry.trigger === expectedTrigger ||
          (!${JSON.stringify(triggerEvent)} && entry.id.includes('@manual-'));
        const eligible = ${JSON.stringify(reuseLatest)} || !previousIds.has(entry.id);
        return entry.taskId === task.id && triggerMatches && eligible;
      });
      if (occurrence && ['completed', 'failed', 'cancelled'].includes(occurrence.status)) {
        return resolve({
          task: {
            id: task.id,
            destination: task.destination,
            action: task.watchdog?.action,
            guards: task.watchdog?.guards
          },
          occurrence,
          sourceConversationId
        });
      }
      if (Date.now() >= deadline) {
        const recent = snapshot.occurrences
          .filter((entry) => entry.taskId === task.id)
          .slice(-3);
        return reject(new Error('Occurrence non terminale avant timeout: ' + JSON.stringify(recent)));
      }
      setTimeout(poll, 250);
    };
    poll();
  })`)

  const ui = await evaluate(`new Promise((resolve) => {
    document.querySelector('[data-testid="nav-task-manager"]')?.click();
    setTimeout(() => {
      const title = 'Auto-kaizen — orchestration rouge ou workflow douteux';
      const row = [...document.querySelectorAll('.task-manager-row')]
        .find((candidate) => candidate.textContent?.includes(title));
      row?.click();
      setTimeout(() => resolve({
        viewVisible: Boolean(document.querySelector('[data-testid="task-manager-view"]')),
        taskVisible: document.body.innerText.includes(title),
        occurrenceVisible: document.body.innerText.includes(${JSON.stringify(triggerEvent ? 'Réveil' : 'Manuel')}),
        visibleText: document.querySelector('[data-testid="task-manager-view"]')?.textContent?.slice(0, 4000)
      }), 400);
    }, 400);
  })`)

  if (screenshotPath) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true })
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(screenshotPath), { recursive: true })
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  }

  const payload = { ...proof, ui, screenshotPath }
  if (jsonOutputPath) {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(jsonOutputPath), { recursive: true })
    writeFileSync(jsonOutputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
} finally {
  socket.close()
}
