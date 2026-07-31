import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { appendConversationFileTrace } from '../src/main/activity/conversation-file-trace-spool'
import { readConversationGitState } from '../src/main/activity/conversation-git-state'
import { captureWorkspaceMutationSnapshot } from '../src/main/providers/workspace-mutation-evidence'

async function main(): Promise<void> {
  const [mode, workspaceRoot, spoolBase, path = 'dir/foo.ts'] = process.argv.slice(2)
  if (!mode || !workspaceRoot || !spoolBase) throw new Error('Arguments de probe incomplets')

  if (mode === 'trace') {
    const snapshot = await captureWorkspaceMutationSnapshot(workspaceRoot)
    const fingerprint = snapshot.get(path)
    const generationMarker = snapshot.generationMarkers.get(path)
    if (!fingerprint || !generationMarker) throw new Error('Suppression non observable')
    appendConversationFileTrace(
      {
        timestamp: new Date().toISOString(),
        conversationId: 'conv-restart-delete',
        workspaceRoot,
        source: 'subagent',
        paths: [path],
        pathFingerprints: { [path]: fingerprint },
        pathBaseFingerprints: { [path]: null },
        pathGenerationMarkers: { [path]: generationMarker },
        pathBaseGenerationMarkers: { [path]: null }
      },
      spoolBase
    )
    process.stdout.write(JSON.stringify({ fingerprint, generationMarker }))
  } else if (mode === 'verify') {
    const beforeRestartMutation = await readConversationGitState(
      'conv-restart-delete',
      workspaceRoot,
      spoolBase
    )
    execFileSync('git', ['restore', '--', path], { cwd: workspaceRoot })
    rmSync(resolve(workspaceRoot, path))
    const afterRestartMutation = await readConversationGitState(
      'conv-restart-delete',
      workspaceRoot,
      spoolBase
    )
    process.stdout.write(
      JSON.stringify({
        before: beforeRestartMutation.state?.changes.map((change) => change.path) ?? [],
        after: afterRestartMutation.state?.changes.map((change) => change.path) ?? []
      })
    )
  } else {
    throw new Error(`Mode inconnu: ${mode}`)
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
