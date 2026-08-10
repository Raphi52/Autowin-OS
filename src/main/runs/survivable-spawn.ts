import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  openStdoutJournal,
  openStderrJournal,
  survivableExitPath,
  tailJsonLines,
  writeSurvivableExit,
  type TailOptions,
  type TailResult
} from './stdout-journal'

/**
 * Lancement d'un CLI qui SURVIT à la fermeture de l'app.
 *
 * Pourquoi ici et pas dans chaque adaptateur : la survie était écrite À L'INTÉRIEUR de `claude.ts`.
 * Résultat mesuré — `codex` et `kimi` lançaient leurs processus en pipes non détachés, donc leur
 * travail mourait avec l'app, et un provider branché plus tard héritait de CE comportement-là sans
 * qu'aucun signal ne le dise. Une capacité transverse ne peut pas vivre dans une spécialité.
 *
 * Le mécanisme : sortie redirigée vers un JOURNAL fichier (au lieu d'un pipe mémoire perdu avec le
 * parent), relais `detached` + `unref()`. Sous Windows, ce relais crée le CLI avec `CREATE_NO_WINDOW`
 * et le garde dans un Job Object : le run survit à l'app, sans exposer ses consoles dans Alt+Tab.
 * L'app SUIT le journal et une instance ultérieure reprend depuis l'offset atteint.
 *
 * Dégradation assumée : sans racine de journal (ou si son ouverture échoue), on retombe sur des
 * pipes classiques et `survivable` vaut false — mieux vaut un run non survivable qu'un run refusé.
 */

export interface SurvivableSpawnInput {
  bin: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Identifie le journal sur disque. Un jeton unique par spawn évite d'écraser un run voisin. */
  runId?: string
  /** Racine des journaux. Défaut : `AUTOWIN_RUN_JOURNAL_ROOT` posée par l'app au démarrage. */
  journalRoot?: string
  /** Échappatoire historique : `AUTOWIN_DETACHED_RUNS=0` force le mode pipe. */
  detachedEnabled?: boolean
  /** Entrée complète remise au CLI. Nécessaire au relais Windows, dont les stdio sont matérialisés. */
  stdin?: string
  /**
   * Barrière durable appelée APRÈS création du journal mais AVANT tout spawn. Si elle échoue, aucun
   * provider n'est lancé. Sa présence rend le journal obligatoire : pas de dégradation silencieuse.
   */
  onJournalPrepared?: (journalPath: string) => void
}

export interface SurvivableRun {
  child: ChildProcess
  pid?: number
  /** Jeton de ce lancement — sert de nom de journal et de clé de lease worktree. */
  spawnToken: string
  /** Chemin du journal, ou undefined en mode dégradé (pipes). */
  journalPath?: string
  /** Diagnostics CLI séparés de stdout : ils ne peuvent pas devenir un faux résultat après crash. */
  diagnosticPath?: string
  /** Preuve de fermeture du relais, physiquement séparée des flux contrôlés par le provider. */
  completionPath?: string
  /** Vrai si ce run continue de produire même l'app fermée. */
  survivable: boolean
  /** Suit la sortie ligne par ligne. En mode dégradé, lit le pipe stdout. */
  tail(onLine: (line: string) => void, options?: TailOptions): Promise<TailResult>
  /** Referme le fd du journal côté parent (le processus garde le sien). */
  release(): void
}

function journalRootFrom(input: SurvivableSpawnInput): string | undefined {
  return input.journalRoot ?? process.env.AUTOWIN_RUN_JOURNAL_ROOT
}

function detachedAllowed(input: SurvivableSpawnInput): boolean {
  if (input.detachedEnabled !== undefined) return input.detachedEnabled
  return process.env.AUTOWIN_DETACHED_RUNS !== '0'
}

const WINDOWS_SURVIVAL_RELAY = String.raw`param(
  [Parameter(Mandatory = $true)][string]$ExecutableB64,
  [Parameter(Mandatory = $true)][string]$ArgumentsB64,
  [Parameter(Mandatory = $true)][string]$JournalPathB64,
  [Parameter(Mandatory = $true)][string]$DiagnosticPathB64,
  [Parameter(Mandatory = $true)][string]$CompletionPathB64,
  [Parameter(Mandatory = $true)][string]$InputPathB64,
  [Parameter(Mandatory = $true)][uint32]$RelayPid
)
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class AutowinHiddenRunner {
  const uint CREATE_SUSPENDED = 0x00000004;
  const uint CREATE_NO_WINDOW = 0x08000000;
  const uint STARTF_USESTDHANDLES = 0x00000100;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
  const int JobObjectExtendedLimitInformation = 9;
  const uint INFINITE = 0xFFFFFFFF;
  const uint SYNCHRONIZE = 0x00100000;
  const uint WAIT_OBJECT_0 = 0;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
    public uint dwFlags; public short wShowWindow; public short cbReserved2;
    public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IO_COUNTERS {
    public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
    public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcessW(string app, StringBuilder command, IntPtr processAttributes,
    IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd,
    ref STARTUPINFO startup, out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint milliseconds);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(
    IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target,
    uint access, bool inherit, uint options);

  static IntPtr InheritableHandle(IntPtr source) {
    IntPtr current = GetCurrentProcess(); IntPtr duplicate;
    if (!DuplicateHandle(current, source, current, out duplicate, 0, true, 2))
      throw new Win32Exception(Marshal.GetLastWin32Error());
    return duplicate;
  }

  static string Quote(string value) {
    if (value.Length > 0 && value.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
    var result = new StringBuilder("\"");
    int slashes = 0;
    foreach (char current in value) {
      if (current == '\\') { slashes++; continue; }
      if (current == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); slashes = 0; continue; }
      result.Append('\\', slashes); slashes = 0; result.Append(current);
    }
    result.Append('\\', slashes * 2); result.Append('"');
    return result.ToString();
  }

  public static int Run(string executable, string[] args, string cwd, string inputPath, string journalPath, string diagnosticPath, uint relayPid) {
    var command = new StringBuilder(Quote(executable));
    foreach (string arg in args) command.Append(' ').Append(Quote(arg ?? ""));
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    int limitsSize = Marshal.SizeOf(limits);
    IntPtr limitsPtr = Marshal.AllocHGlobal(limitsSize);
    try {
      Marshal.StructureToPtr(limits, limitsPtr, false);
      if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, limitsPtr, (uint)limitsSize))
        throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally { Marshal.FreeHGlobal(limitsPtr); }

    using (var input = new FileStream(inputPath, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
    using (var output = new FileStream(journalPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
    using (var diagnostic = new FileStream(diagnosticPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete)) {
      var startup = new STARTUPINFO();
      startup.cb = Marshal.SizeOf(startup); startup.dwFlags = STARTF_USESTDHANDLES;
      startup.hStdInput = InheritableHandle(input.SafeFileHandle.DangerousGetHandle());
      startup.hStdOutput = InheritableHandle(output.SafeFileHandle.DangerousGetHandle());
      startup.hStdError = InheritableHandle(diagnostic.SafeFileHandle.DangerousGetHandle());
      PROCESS_INFORMATION child;
      if (!CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true,
        CREATE_NO_WINDOW | CREATE_SUSPENDED, IntPtr.Zero, cwd, ref startup, out child)) {
        CloseHandle(startup.hStdInput); CloseHandle(startup.hStdOutput); CloseHandle(startup.hStdError);
        CloseHandle(job); throw new Win32Exception(Marshal.GetLastWin32Error());
    }
      CloseHandle(startup.hStdInput); CloseHandle(startup.hStdOutput); CloseHandle(startup.hStdError);
      try {
        if (!AssignProcessToJobObject(job, child.hProcess)) {
          TerminateProcess(child.hProcess, 1); throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        if (ResumeThread(child.hThread) == 0xFFFFFFFF) {
          TerminateProcess(child.hProcess, 1); throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        IntPtr relay = OpenProcess(SYNCHRONIZE, false, relayPid);
        if (relay == IntPtr.Zero) {
          TerminateJobObject(job, 1); throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        uint waitResult;
        try { waitResult = WaitForMultipleObjects(2, new IntPtr[] { child.hProcess, relay }, false, INFINITE); }
        finally { CloseHandle(relay); }
        if (waitResult == WAIT_OBJECT_0 + 1) { TerminateJobObject(job, 1); return 1; }
        if (waitResult != WAIT_OBJECT_0) { TerminateJobObject(job, 1); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        uint exitCode; if (!GetExitCodeProcess(child.hProcess, out exitCode)) throw new Win32Exception(Marshal.GetLastWin32Error());
        output.Flush(); return unchecked((int)exitCode);
      } finally { CloseHandle(child.hThread); CloseHandle(child.hProcess); CloseHandle(job); }
      }
  }
}
'@
Add-Type -TypeDefinition $source
$executable = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ExecutableB64))
$argumentsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgumentsB64))
$journalPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($JournalPathB64))
$diagnosticPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DiagnosticPathB64))
$completionPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($CompletionPathB64))
$inputPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($InputPathB64))
[string[]]$childArguments = @((ConvertFrom-Json $argumentsJson) | ForEach-Object { [string]$_ })
try {
  $childExitCode = [AutowinHiddenRunner]::Run($executable, $childArguments, (Get-Location).Path, $inputPath, $journalPath, $diagnosticPath, $RelayPid)
  $marker = '{"type":"autowin.survivable-exit","exit_code":' + [string]$childExitCode + '}'
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($completionPath, $marker, $utf8NoBom)
  exit $childExitCode
} finally {
  Remove-Item -LiteralPath $inputPath -Force -ErrorAction SilentlyContinue
}
`

const WINDOWS_SURVIVAL_NODE_RELAY = String.raw`const { spawn } = require('node:child_process')
const { closeSync, openSync } = require('node:fs')
const powershellArgs = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'))
const journalPath = Buffer.from(process.argv[3], 'base64').toString('utf8')
const diagnosticPath = Buffer.from(process.argv[4], 'base64').toString('utf8')
powershellArgs.push('-RelayPid', String(process.pid))
const childEnv = { ...process.env }
delete childEnv.ELECTRON_RUN_AS_NODE
const journalFd = openSync(journalPath, 'a')
const diagnosticFd = openSync(diagnosticPath, 'a')
const child = spawn('powershell.exe', powershellArgs, {
  shell: false,
  windowsHide: true,
  stdio: ['ignore', journalFd, diagnosticFd],
  env: childEnv
})
child.once('error', () => { closeSync(journalFd); closeSync(diagnosticFd); process.exit(1) })
child.once('exit', (code) => { closeSync(journalFd); closeSync(diagnosticFd); process.exit(code == null ? 1 : code) })
`

export function usesWindowsSurvivalRelay(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
}

function windowsSurvivalRelayPaths(root: string): { powershell: string; node: string } {
  const runtime = join(root, '.runtime')
  mkdirSync(runtime, { recursive: true })
  const powershell = join(runtime, 'windows-survivable-runner-v12.ps1')
  const node = join(runtime, 'windows-survivable-relay-v3.cjs')
  if (!existsSync(powershell))
    writeFileSync(powershell, WINDOWS_SURVIVAL_RELAY, { encoding: 'utf8', flag: 'wx' })
  if (!existsSync(node))
    writeFileSync(node, WINDOWS_SURVIVAL_NODE_RELAY, { encoding: 'utf8', flag: 'wx' })
  return { powershell, node }
}

export function backgroundSurvivalInvocation(
  bin: string,
  args: string[],
  journalRoot: string,
  journalPath: string,
  stdin = '',
  platform: NodeJS.Platform = process.platform,
  diagnosticPath = `${journalPath}.stderr.log`
): {
  bin: string
  args: string[]
  env?: NodeJS.ProcessEnv
  relay: boolean
  inputPath?: string
  completionPath: string
} {
  const completionPath = survivableExitPath(journalPath)
  if (!usesWindowsSurvivalRelay(platform)) return { bin, args, relay: false, completionPath }
  const inputPath = `${journalPath}.${randomUUID()}.stdin`
  writeFileSync(inputPath, stdin, { encoding: 'utf8', flag: 'wx' })
  const relayPaths = windowsSurvivalRelayPaths(journalRoot)
  const powershellArgs = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    relayPaths.powershell,
    '-ExecutableB64',
    Buffer.from(bin, 'utf8').toString('base64'),
    '-ArgumentsB64',
    Buffer.from(JSON.stringify(args), 'utf8').toString('base64'),
    '-JournalPathB64',
    Buffer.from(journalPath, 'utf8').toString('base64'),
    '-DiagnosticPathB64',
    Buffer.from(diagnosticPath, 'utf8').toString('base64'),
    '-CompletionPathB64',
    Buffer.from(completionPath, 'utf8').toString('base64'),
    '-InputPathB64',
    Buffer.from(inputPath, 'utf8').toString('base64')
  ]
  return {
    bin: process.execPath,
    args: [
      relayPaths.node,
      Buffer.from(JSON.stringify(powershellArgs), 'utf8').toString('base64'),
      Buffer.from(journalPath, 'utf8').toString('base64'),
      Buffer.from(diagnosticPath, 'utf8').toString('base64')
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    relay: true,
    inputPath,
    completionPath
  }
}

/** Lance un CLI de façon survivable. Ne jette jamais pour une raison de journal. */
export function spawnSurvivable(input: SurvivableSpawnInput): SurvivableRun {
  const spawnToken = input.runId ?? randomUUID()
  const root = journalRootFrom(input)
  let journal:
    | {
        path: string
        fd: number
        diagnosticPath: string
        diagnosticFd: number
        completionPath: string
      }
    | undefined
  if (detachedAllowed(input) && root) {
    let stdout: { path: string; fd: number } | undefined
    try {
      stdout = openStdoutJournal(root, spawnToken)
      const diagnostic = openStderrJournal(root, spawnToken)
      journal = {
        path: stdout.path,
        fd: stdout.fd,
        diagnosticPath: diagnostic.path,
        diagnosticFd: diagnostic.fd,
        completionPath: survivableExitPath(stdout.path)
      }
    } catch {
      if (stdout) {
        closeSync(stdout.fd)
        rmSync(stdout.path, { force: true })
      }
      journal = undefined // journal impossible → pipes, plutôt que d'échouer le lancement
    }
  }

  if (input.onJournalPrepared) {
    if (!journal) {
      throw new Error('Journal survivable indisponible — provider non lancé pour éviter un doublon')
    }
    try {
      input.onJournalPrepared(journal.path)
    } catch (error) {
      try {
        closeSync(journal.fd)
      } catch {
        /* déjà fermé */
      }
      try {
        closeSync(journal.diagnosticFd)
      } catch {
        /* déjà fermé */
      }
      rmSync(journal.path, { force: true })
      rmSync(journal.diagnosticPath, { force: true })
      rmSync(journal.completionPath, { force: true })
      throw error
    }
  }

  const invocation = journal
    ? backgroundSurvivalInvocation(
        input.bin,
        input.args,
        root!,
        journal.path,
        input.stdin ?? '',
        process.platform,
        journal.diagnosticPath
      )
    : { bin: input.bin, args: input.args, relay: false, completionPath: '' }
  const child = spawn(invocation.bin, invocation.args, {
    shell: false,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...((invocation.env ?? input.env) ? { env: invocation.env ?? input.env } : {}),
    windowsHide: true,
    ...(journal
      ? {
          detached: true,
          stdio: invocation.relay
            ? ('ignore' as const)
            : (['pipe', journal.fd, journal.diagnosticFd] as const)
        }
      : { stdio: ['pipe', 'pipe', 'pipe'] as const })
  })
  let inputCleaned = false
  const cleanupInput = (): void => {
    if (inputCleaned || !invocation.inputPath) return
    inputCleaned = true
    try {
      rmSync(invocation.inputPath, { force: true })
    } catch {
      /* le relais a pu supprimer le fichier juste avant sa fermeture */
    }
  }
  child.once('close', cleanupInput)
  // Hors Windows il n'y a pas encore de relais intermédiaire : tant que le main est vivant, il
  // écrit tout de même la preuve de sortie. Sous Windows, le relais l'écrit même après sa mort.
  if (journal && !invocation.relay) {
    child.once('close', (code) => {
      try {
        writeSurvivableExit(journal!.path, code == null ? 1 : code)
      } catch {
        /* preuve indisponible : le récupérateur restera prudemment inactif */
      }
    })
  }
  if (!journal && input.stdin !== undefined) child.stdin?.end(input.stdin)
  // `unref` : l'app peut mourir sans emporter le CLI. Absent sur les doubles de test.
  if (journal && typeof child.unref === 'function') child.unref()

  let released = false
  const release = (): void => {
    if (released || !journal) return
    released = true
    try {
      closeSync(journal.fd)
    } catch {
      /* fd déjà fermé : sans conséquence */
    }
    try {
      closeSync(journal.diagnosticFd)
    } catch {
      /* fd déjà fermé */
    }
  }

  /**
   * Supprime le journal s'il n'a JAMAIS rien reçu.
   *
   * Le journal est ouvert AVANT le spawn — son descripteur sert de stdio à l'enfant, on ne peut donc
   * pas l'ouvrir paresseusement. Quand le CLI n'écrit finalement rien (sortie immédiate, binaire
   * introuvable, signal déjà annulé), le fichier restait à 0 octet et rien ne l'effaçait. Mesuré le
   * 2026-08-06 : 18 journaux vides sur 242, dont aucun UUID n'apparaissait dans une seule trace.
   *
   * Le coût n'était pas le disque mais l'OBSERVABILITÉ : un journal à 0 octet est indiscernable d'un
   * sous-agent figé, et a fait partir un diagnostic sur une fausse piste.
   *
   * Accroché à la FERMETURE du processus, et nulle part ailleurs : c'est le seul instant où l'on sait
   * que plus rien n'arrivera. Le faire dans `release()` casserait la survie — l'app peut appeler
   * `release` à son extinction alors que le CLI détaché, lui, continue d'écrire.
   *
   * Sans risque pour un `tail` en cours : `readChunkFrom` traite un fichier absent comme vide, ce qui
   * est exactement ce qu'un journal vide aurait rendu.
   */
  const discardEmptyJournal = (): void => {
    if (!journal) return
    // Fermer le descripteur AVANT d'effacer : sous Windows, un fichier encore ouvert ne s'efface pas.
    release()
    try {
      const content = readFileSync(journal.path, 'utf8')
      const hasProviderOutput = Boolean(content.trim())
      if (!hasProviderOutput) {
        rmSync(journal.path, { force: true })
        rmSync(journal.completionPath, { force: true })
      }
      if (!readFileSync(journal.diagnosticPath, 'utf8').trim()) {
        rmSync(journal.diagnosticPath, { force: true })
      }
    } catch {
      /* déjà effacé, ou verrouillé par le relais : un journal vide de plus n'est pas un échec de run */
    }
  }
  child.once('close', discardEmptyJournal)
  child.once('error', discardEmptyJournal)

  return {
    child,
    pid: child.pid,
    spawnToken,
    journalPath: journal?.path,
    diagnosticPath: journal?.diagnosticPath,
    completionPath: journal?.completionPath,
    survivable: journal !== undefined,
    release,
    tail: async (onLine, options = {}) => {
      if (journal) return tailJsonLines(journal.path, onLine, options)
      // Mode dégradé : pas de fichier à suivre, on lit le pipe. Rien n'est récupérable après un
      // crash de l'app — c'est exactement ce que la survie évite.
      return await new Promise<TailResult>((resolve) => {
        let buffered = ''
        let offset = 0
        child.stdout?.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          offset += Buffer.byteLength(text)
          buffered += text
          const parts = buffered.split('\n')
          buffered = parts.pop() ?? ''
          for (const line of parts) if (line.trim()) onLine(line)
        })
        child.on('close', () => {
          if (buffered.trim()) onLine(buffered.trim())
          resolve({ offset, stopped: false })
        })
      })
    }
  }
}
