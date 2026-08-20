import { execFile } from 'node:child_process'

export type DesktopAction =
  | { type: 'move'; x: number; y: number }
  | {
      type: 'click'
      x: number
      y: number
      button: 'left' | 'right' | 'middle'
      clicks: 1 | 2
    }
  | { type: 'scroll'; delta: number; x?: number; y?: number }
  | { type: 'type'; text: string }
  | { type: 'key'; keys: string[] }
  | { type: 'open'; target: string; args: string[] }
  | { type: 'wait'; ms: number }

export interface DesktopObservation {
  data: {
    width: number
    height: number
    sourceWidth: number
    sourceHeight: number
    originX: number
    originY: number
    mimeType: 'image/jpeg'
    scope: 'desktop' | 'foreground-window'
    /** Nombre de moniteurs detectes ; permet au modele de choisir `display`. */
    displays?: number
    /** Rang 1-base du moniteur capture seul ; absent quand la capture couvre tout le bureau. */
    display?: number
  }
  attachment: {
    name: 'desktop-current.jpg'
    mimeType: 'image/jpeg'
    size: number
    kind: 'image'
    content: string
  }
}

export interface DesktopObserveOptions {
  display?: number
}

export interface DesktopController {
  observe(options?: DesktopObserveOptions): Promise<DesktopObservation>
  act(actions: unknown): Promise<{ executed: number }>
}

type Platform = NodeJS.Platform | string
type PowerShellRunner = (encodedCommand: string) => Promise<string>
type DesktopCapture = (options?: {
  forceForegroundWindow?: boolean
  display?: number
}) => Promise<DesktopObservation>

const MAX_ACTIONS = 20
const MAX_TEXT_CHARS = 20_000
const MAX_OPEN_ARGS = 20
const MAX_OPEN_ARG_CHARS = 4_000
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024

const KEY_CODES: Record<string, number> = {
  BACKSPACE: 0x08,
  TAB: 0x09,
  ENTER: 0x0d,
  SHIFT: 0x10,
  CTRL: 0x11,
  ALT: 0x12,
  ESC: 0x1b,
  SPACE: 0x20,
  PAGEUP: 0x21,
  PAGEDOWN: 0x22,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  DELETE: 0x2e,
  WIN: 0x5b
}

for (let code = 0x30; code <= 0x39; code += 1) KEY_CODES[String.fromCharCode(code)] = code
for (let code = 0x41; code <= 0x5a; code += 1) KEY_CODES[String.fromCharCode(code)] = code
for (let index = 1; index <= 24; index += 1) KEY_CODES[`F${index}`] = 0x6f + index

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Chaque action desktop doit etre un objet')
  }
  return value as Record<string, unknown>
}

function finiteInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} doit etre un entier entre ${minimum} et ${maximum}`)
  }
  return value as number
}

function normalizedCoordinate(value: unknown, label: string): number {
  return finiteInteger(value, `${label} normalise`, 0, 1000)
}

function normalizedKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new Error('keys doit contenir entre 1 et 8 touches')
  }
  return value.map((raw) => {
    if (typeof raw !== 'string') throw new Error('Chaque touche doit etre une chaine')
    const key = raw.trim().toUpperCase()
    if (!(key in KEY_CODES)) throw new Error(`Touche desktop inconnue: ${raw}`)
    return key
  })
}

export function parseDesktopActions(input: unknown): DesktopAction[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ACTIONS) {
    throw new Error(`actions doit contenir entre 1 et ${MAX_ACTIONS} gestes`)
  }
  return input.map((raw, index) => {
    const action = record(raw)
    const type = action.type
    if (typeof type !== 'string') throw new Error(`actions[${index}].type est requis`)
    switch (type) {
      case 'move':
        return {
          type,
          x: normalizedCoordinate(action.x, `actions[${index}].x`),
          y: normalizedCoordinate(action.y, `actions[${index}].y`)
        }
      /**
       * `double_click` est un ALIAS de `click` avec `clicks: 2` — pas une capacite nouvelle.
       *
       * MESURE le 2026-08-15 sur les 40 dernieres conversations : `desktop_act` est la commande qui
       * echoue le PLUS (4 echecs), et son motif est litteral — « Type d'action desktop inconnu:
       * double_click ». Le double-clic etait pourtant deja possible ici meme, via `clicks: 2` ; seul
       * le NOM manquait. Un agent qui ecrit le nom le plus naturel se heurtait a un refus.
       *
       * Refuser un synonyme evident ne protege rien : cela transforme une action realisable en echec,
       * et l'agent part alors cliquer a l'aveugle ailleurs — ce qui a ete observe.
       */
      case 'double_click':
      case 'click': {
        const button = action.button ?? 'left'
        if (button !== 'left' && button !== 'right' && button !== 'middle') {
          throw new Error(`actions[${index}].button est invalide`)
        }
        const clicks = (
          type === 'double_click'
            ? 2
            : finiteInteger(action.clicks ?? 1, `actions[${index}].clicks`, 1, 2)
        ) as 1 | 2
        return {
          // Normalise en `click` : l'execution en aval ne connait qu'un seul geste, le nombre de
          // clics porte la difference. Laisser fuiter `double_click` ferait echouer un cran plus loin.
          type: 'click' as const,
          x: normalizedCoordinate(action.x, `actions[${index}].x`),
          y: normalizedCoordinate(action.y, `actions[${index}].y`),
          button,
          clicks
        }
      }
      case 'scroll': {
        const delta = finiteInteger(action.delta, `actions[${index}].delta`, -10_000, 10_000)
        if (delta === 0) throw new Error(`actions[${index}].delta ne peut pas etre nul`)
        const hasX = action.x !== undefined
        const hasY = action.y !== undefined
        if (hasX !== hasY) throw new Error(`actions[${index}] doit fournir x et y ensemble`)
        return {
          type,
          delta,
          ...(hasX
            ? {
                x: normalizedCoordinate(action.x, `actions[${index}].x`),
                y: normalizedCoordinate(action.y, `actions[${index}].y`)
              }
            : {})
        }
      }
      case 'type': {
        if (
          typeof action.text !== 'string' ||
          action.text.length === 0 ||
          action.text.length > MAX_TEXT_CHARS
        ) {
          throw new Error(`actions[${index}].text doit contenir 1 a ${MAX_TEXT_CHARS} caracteres`)
        }
        return { type, text: action.text }
      }
      case 'key':
        return { type, keys: normalizedKeys(action.keys) }
      case 'open': {
        if (typeof action.target !== 'string' || !action.target.trim()) {
          throw new Error(`actions[${index}].target est requis`)
        }
        const args = action.args ?? []
        if (!Array.isArray(args) || args.length > MAX_OPEN_ARGS) {
          throw new Error(`actions[${index}].args depasse ${MAX_OPEN_ARGS} elements`)
        }
        const normalizedArgs = args.map((arg) => {
          if (typeof arg !== 'string' || arg.length > MAX_OPEN_ARG_CHARS) {
            throw new Error(`Un argument open depasse ${MAX_OPEN_ARG_CHARS} caracteres`)
          }
          return arg
        })
        return { type, target: action.target.trim(), args: normalizedArgs }
      }
      case 'wait':
        return {
          type,
          ms: finiteInteger(action.ms, `actions[${index}].ms`, 0, 5_000)
        }
      default:
        throw new Error(`Type d'action desktop inconnu: ${type}`)
    }
  })
}

const NATIVE_INPUT_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;

public static class AutowinDesktopNative {
  private const uint INPUT_MOUSE = 0;
  private const uint INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  private const uint MOUSEEVENTF_WHEEL = 0x0800;
  private const uint MOUSEEVENTF_MOVE = 0x0001;
  private const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
  private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)]
  private struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags;
    public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags;
    public uint time; public UIntPtr dwExtraInfo;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetPhysicalCursorPos(int x, int y);

  private static void Send(INPUT input) {
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
  }
  private static INPUT Key(ushort vk, ushort scan, uint flags) {
    var input = new INPUT { type = INPUT_KEYBOARD };
    input.U.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
    return input;
  }
  private static INPUT Mouse(uint flags, uint data = 0, int dx = 0, int dy = 0) {
    var input = new INPUT { type = INPUT_MOUSE };
    input.U.mi = new MOUSEINPUT { dx = dx, dy = dy, dwFlags = flags, mouseData = data };
    return input;
  }
  public static void Move(int x, int y, int left, int top, int width, int height) {
    if (SetPhysicalCursorPos(x, y)) return;
    if (width <= 1 || height <= 1) throw new InvalidOperationException("Geometrie Windows invalide");
    int absoluteX = (int)Math.Round((x - left) * 65535.0 / (width - 1));
    int absoluteY = (int)Math.Round((y - top) * 65535.0 / (height - 1));
    Send(Mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_VIRTUALDESK | MOUSEEVENTF_ABSOLUTE, 0, absoluteX, absoluteY));
  }
  public static void Click(string button, int clicks) {
    uint down = button == "right" ? MOUSEEVENTF_RIGHTDOWN : button == "middle" ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_LEFTDOWN;
    uint up = button == "right" ? MOUSEEVENTF_RIGHTUP : button == "middle" ? MOUSEEVENTF_MIDDLEUP : MOUSEEVENTF_LEFTUP;
    for (int i = 0; i < clicks; i++) { Send(Mouse(down)); Send(Mouse(up)); }
  }
  public static void Scroll(int delta) { Send(Mouse(MOUSEEVENTF_WHEEL, unchecked((uint)delta))); }
  public static void TypeText(string text) {
    foreach (char ch in text) { Send(Key(0, ch, KEYEVENTF_UNICODE)); Send(Key(0, ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)); }
  }
  public static void Chord(int[] codes) {
    foreach (int code in codes) Send(Key((ushort)code, 0, 0));
    for (int i = codes.Length - 1; i >= 0; i--) Send(Key((ushort)codes[i], 0, KEYEVENTF_KEYUP));
  }
}
`

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function defaultPowerShellRunner(encodedCommand: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 12 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message).trim()))
          return
        }
        resolve(String(stdout).trim())
      }
    )
  })
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    return record(parsed)
  } catch (error) {
    throw new Error(
      `${label} a rendu un JSON invalide: ${error instanceof Error ? error.message : error}`
    )
  }
}

function outputInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} invalide dans la reponse Windows`)
  return value as number
}

function inputScript(actions: DesktopAction[], geometry?: DesktopObservation['data']): string {
  const prepared = actions.map((action) => {
    if (action.type !== 'move' && action.type !== 'click' && action.type !== 'scroll') {
      if (action.type === 'key') {
        return { ...action, codes: action.keys.map((key) => KEY_CODES[key]), keys: undefined }
      }
      return action
    }
    if (action.type === 'scroll' && action.x === undefined) return action
    if (!geometry) {
      throw new Error('Une observation desktop est requise avant une action pointeur')
    }
    const mapX = (x: number): number =>
      geometry.originX + Math.round((x / 1000) * Math.max(0, geometry.sourceWidth - 1))
    const mapY = (y: number): number =>
      geometry.originY + Math.round((y / 1000) * Math.max(0, geometry.sourceHeight - 1))
    return {
      ...action,
      x: mapX(action.x!),
      y: mapY(action.y!),
      desktopLeft: geometry.originX,
      desktopTop: geometry.originY,
      desktopWidth: geometry.sourceWidth,
      desktopHeight: geometry.sourceHeight
    }
  })
  const payload = Buffer.from(JSON.stringify(prepared), 'utf8').toString('base64')
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${NATIVE_INPUT_SOURCE}
'@
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))
$actions = $json | ConvertFrom-Json
$executed = 0
foreach ($action in $actions) {
  switch ($action.type) {
    'move' { [AutowinDesktopNative]::Move([int]$action.x, [int]$action.y, [int]$action.desktopLeft, [int]$action.desktopTop, [int]$action.desktopWidth, [int]$action.desktopHeight) }
    'click' {
      [AutowinDesktopNative]::Move([int]$action.x, [int]$action.y, [int]$action.desktopLeft, [int]$action.desktopTop, [int]$action.desktopWidth, [int]$action.desktopHeight)
      [AutowinDesktopNative]::Click([string]$action.button, [int]$action.clicks)
    }
    'scroll' {
      if ($null -ne $action.x) { [AutowinDesktopNative]::Move([int]$action.x, [int]$action.y, [int]$action.desktopLeft, [int]$action.desktopTop, [int]$action.desktopWidth, [int]$action.desktopHeight) }
      [AutowinDesktopNative]::Scroll([int]$action.delta)
    }
    'type' { [AutowinDesktopNative]::TypeText([string]$action.text) }
    'key' { [AutowinDesktopNative]::Chord([int[]]$action.codes) }
    'open' {
      if (@($action.args).Count -gt 0) {
        Start-Process -FilePath ([string]$action.target) -ArgumentList ([string[]]$action.args) | Out-Null
      } else { Start-Process -FilePath ([string]$action.target) | Out-Null }
    }
    'wait' { Start-Sleep -Milliseconds ([int]$action.ms) }
    default { throw "Action preparee inconnue: $($action.type)" }
  }
  $executed += 1
}
[Console]::Out.Write((@{ executed = $executed } | ConvertTo-Json -Compress))
`
}

export class WindowsDesktopController implements DesktopController {
  private readonly platform: Platform
  private readonly run: PowerShellRunner
  private readonly capture?: DesktopCapture
  private lastObservation?: DesktopObservation['data']

  constructor(
    options: { platform?: Platform; run?: PowerShellRunner; capture?: DesktopCapture } = {}
  ) {
    this.platform = options.platform ?? process.platform
    this.run = options.run ?? defaultPowerShellRunner
    this.capture = options.capture
  }

  private assertWindows(): void {
    if (this.platform !== 'win32') {
      throw new Error('Le controle desktop Autowin est disponible uniquement sous Windows')
    }
  }

  async observe(options: DesktopObserveOptions = {}): Promise<DesktopObservation> {
    this.assertWindows()
    if (!this.capture) throw new Error('Capture desktop Electron indisponible')
    const observed = await this.capture({ display: options.display })
    const { data, attachment } = observed
    if (data.mimeType !== 'image/jpeg' || attachment.mimeType !== 'image/jpeg') {
      throw new Error('Format de capture desktop inattendu')
    }
    const base64 = attachment.content
    if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new Error('Image desktop absente ou invalide')
    }
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length === 0 || bytes.length > MAX_CAPTURE_BYTES) {
      throw new Error(`Capture desktop hors limite: ${bytes.length} octets`)
    }
    if (data.scope !== 'desktop' && data.scope !== 'foreground-window') {
      throw new Error('Portee de capture desktop invalide')
    }
    for (const [label, value] of Object.entries(data)) {
      if (label !== 'mimeType' && label !== 'scope') outputInteger(value, label)
    }
    if (data.width <= 0 || data.height <= 0 || data.sourceWidth <= 0 || data.sourceHeight <= 0) {
      throw new Error('Geometrie de capture desktop invalide')
    }
    this.lastObservation = data
    return {
      data,
      attachment: {
        name: 'desktop-current.jpg',
        mimeType: 'image/jpeg',
        size: bytes.length,
        kind: 'image',
        content: base64
      }
    }
  }

  async act(input: unknown): Promise<{ executed: number }> {
    this.assertWindows()
    const actions = parseDesktopActions(input)
    const output = parseJsonObject(
      await this.run(encodePowerShell(inputScript(actions, this.lastObservation))),
      'Controle desktop'
    )
    const executed = outputInteger(output.executed, 'executed')
    if (executed !== actions.length) {
      throw new Error(`Controle desktop partiel: ${executed}/${actions.length} gestes executes`)
    }
    return { executed }
  }
}
