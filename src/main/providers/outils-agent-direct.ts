import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { OutilAgent } from './openai-compat'

/**
 * OUTILS D'AGENT DU MOTEUR DIRECT (conv-1502, lot 2 du plan-23013d9f).
 *
 * Le moteur HTTP `openai-compat.ts` mène lui-même la boucle d'agent : sans outils, un modèle Gemini,
 * Groq ou Ollama ne pouvait que parler. Ici : lire, écrire, éditer, commande shell, grep, glob —
 * exécutés dans le dossier de travail DU RUN (`execution.cwd`), jamais dans celui de l'app.
 *
 * PROTECTION : AUCUNE garde neuve. Chaque appel passe par le MÊME script que le hook PreToolUse du
 * moteur Claude (`scriptDesGardesCourant`, providers/claude.ts), lancé comme le CLI le lance : JSON
 * `{tool_name, tool_input, cwd}` sur stdin, refus = `permissionDecision: "deny"` ou code 2. Les noms
 * d'outils transmis sont ceux de Claude (Write, Edit, Bash…) pour que ses règles s'appliquent telles
 * quelles. Un refus est LEVÉ : la boucle du moteur le rend au modèle comme résultat d'outil.
 */

export interface OptionsOutilsAgentDirect {
  cwd: string
  /** `read-only` retire l'écriture et l'édition (même contrat que `execution.sandbox`). */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  /** Variables du run (`execution.agentEnv`) : vues par la garde ET par la commande shell. */
  agentEnv?: Record<string, string>
  /** Script de garde ; défaut = `scriptDesGardesCourant()` du moteur Claude (une seule source). */
  scriptGarde?: () => string | Promise<string>
  delaiCommandeMs?: number
}

const PLAFOND_SORTIE = 30_000
const DOSSIERS_IGNORES = new Set(['node_modules', '.git', '.autowin-data', 'out', 'dist'])

export function creerOutilsAgentDirect(o: OptionsOutilsAgentDirect): OutilAgent[] {
  const cwd = resolve(o.cwd)
  const env: NodeJS.ProcessEnv = { ...process.env, ...(o.agentEnv ?? {}) }
  let cheminGarde: Promise<string> | undefined
  const garde = async (outil: string, entree: Record<string, unknown>): Promise<void> => {
    cheminGarde ??= (async () => {
      const script = await (
        o.scriptGarde ?? (async () => (await import('./claude')).scriptDesGardesCourant())
      )()
      const fichier = join(mkdtempSync(join(tmpdir(), 'autowin-os-garde-direct-')), 'garde.mjs')
      writeFileSync(fichier, script, 'utf8')
      return fichier
    })()
    const r = spawnSync(process.execPath, [await cheminGarde], {
      input: JSON.stringify({ tool_name: outil, tool_input: entree, cwd }),
      encoding: 'utf8',
      // Sous Electron, process.execPath est l'exe de l'app : il doit se comporter en node.
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      cwd,
      windowsHide: true,
      timeout: 15_000
    })
    // Échec fermé, comme `onFailure: 'block'` côté Claude : une garde qui ne tourne pas refuse.
    if (r.error || r.status === null)
      throw new Error(`garde injoignable — action refusée (${r.error?.message ?? 'délai dépassé'})`)
    const motif = motifDeRefus(r.stdout)
    if (motif !== undefined) throw new Error(`refusé par la garde : ${motif}`)
    if (r.status === 2)
      throw new Error(`refusé par la garde : ${(r.stderr || '').trim() || 'sans motif'}`)
  }
  const chemin = (v: unknown): string => {
    if (typeof v !== 'string' || !v.trim()) throw new Error('argument « chemin » manquant')
    return isAbsolute(v) ? resolve(v) : resolve(cwd, v)
  }

  const lire: OutilAgent = {
    nom: 'lire_fichier',
    description: 'Lit un fichier texte (chemin relatif au dossier de travail ou absolu).',
    parametres: objet({ chemin: texte('Chemin du fichier') }, ['chemin']),
    async executer(a) {
      const f = chemin(a.chemin)
      await garde('Read', { file_path: f })
      return tronquer(await readFile(f, 'utf8'))
    }
  }
  const ecrire: OutilAgent = {
    nom: 'ecrire_fichier',
    description: 'Crée ou remplace entièrement un fichier texte.',
    parametres: objet({ chemin: texte('Chemin du fichier'), contenu: texte('Contenu complet') }, [
      'chemin',
      'contenu'
    ]),
    async executer(a) {
      const f = chemin(a.chemin)
      const contenu = String(a.contenu ?? '')
      await garde('Write', { file_path: f, content: contenu })
      await mkdir(dirname(f), { recursive: true })
      await writeFile(f, contenu, 'utf8')
      return `Fichier écrit : ${f} (${contenu.length} caractères).`
    }
  }
  const editer: OutilAgent = {
    nom: 'editer_fichier',
    description: 'Remplace un passage exact et UNIQUE d’un fichier par un autre texte.',
    parametres: objet(
      {
        chemin: texte('Chemin du fichier'),
        ancien: texte('Texte exact à remplacer'),
        nouveau: texte('Texte de remplacement')
      },
      ['chemin', 'ancien', 'nouveau']
    ),
    async executer(a) {
      const f = chemin(a.chemin)
      const ancien = String(a.ancien ?? '')
      const nouveau = String(a.nouveau ?? '')
      await garde('Edit', { file_path: f, old_string: ancien, new_string: nouveau })
      const avant = await readFile(f, 'utf8')
      const n = ancien ? avant.split(ancien).length - 1 : 0
      if (n !== 1)
        throw new Error(
          `le passage à remplacer apparaît ${n} fois (il doit être unique et non vide)`
        )
      await writeFile(
        f,
        avant.replace(ancien, () => nouveau),
        'utf8'
      )
      return `Fichier édité : ${f}.`
    }
  }
  const commande: OutilAgent = {
    nom: 'commande',
    description:
      'Lance une commande shell dans le dossier de travail ; rend le code de sortie et la sortie.',
    parametres: objet({ commande: texte('Commande à exécuter') }, ['commande']),
    async executer(a, ctx) {
      const cmd = String(a.commande ?? '').trim()
      if (!cmd) throw new Error('argument « commande » manquant')
      await garde('Bash', { command: cmd })
      return await lancer(cmd, cwd, env, o.delaiCommandeMs ?? 120_000, ctx.signal)
    }
  }
  const grep: OutilAgent = {
    nom: 'grep',
    description:
      'Cherche une expression régulière dans les fichiers (lignes « fichier:numéro: texte »).',
    parametres: objet(
      {
        motif: texte('Expression régulière'),
        dossier: texte('Dossier de départ (défaut : dossier de travail)')
      },
      ['motif']
    ),
    async executer(a) {
      const base = a.dossier ? chemin(a.dossier) : cwd
      await garde('Grep', { pattern: String(a.motif ?? ''), path: base })
      const re = new RegExp(String(a.motif ?? ''))
      const lignes: string[] = []
      for await (const f of parcourir(base)) {
        let contenu: string
        try {
          contenu = await readFile(f, 'utf8')
        } catch {
          continue
        }
        if (contenu.includes('\u0000')) continue
        contenu.split(/\r?\n/).forEach((l, i) => {
          if (lignes.length < 500 && re.test(l))
            lignes.push(`${relatif(cwd, f)}:${i + 1}: ${l.slice(0, 300)}`)
        })
        if (lignes.length >= 500) break
      }
      return lignes.length ? lignes.join('\n') : 'Aucune correspondance.'
    }
  }
  const glob: OutilAgent = {
    nom: 'glob',
    description:
      'Liste les fichiers qui correspondent à un motif (`**`, `*`, `?`), ex. `src/**/*.ts`.',
    parametres: objet(
      {
        motif: texte('Motif de chemin'),
        dossier: texte('Dossier de départ (défaut : dossier de travail)')
      },
      ['motif']
    ),
    async executer(a) {
      const base = a.dossier ? chemin(a.dossier) : cwd
      await garde('Glob', { pattern: String(a.motif ?? ''), path: base })
      const re = motifVersRegex(String(a.motif ?? ''))
      const trouves: string[] = []
      for await (const f of parcourir(base)) {
        if (re.test(relatif(base, f))) trouves.push(relatif(cwd, f))
        if (trouves.length >= 1000) break
      }
      return trouves.length ? trouves.join('\n') : 'Aucun fichier.'
    }
  }
  return o.sandbox === 'read-only'
    ? [lire, commande, grep, glob]
    : [lire, ecrire, editer, commande, grep, glob]
}

/** Motif de refus du hook, au format PreToolUse du CLI Claude ; `undefined` = autorisé. */
function motifDeRefus(stdout: string): string | undefined {
  const t = (stdout || '').trim()
  if (!t) return undefined
  try {
    const sortie = JSON.parse(t) as {
      hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
    }
    const h = sortie.hookSpecificOutput
    return h?.permissionDecision === 'deny' ? h.permissionDecisionReason || 'sans motif' : undefined
  } catch {
    return undefined
  }
}

function objet(props: Record<string, unknown>, requis: string[]): Record<string, unknown> {
  return { type: 'object', properties: props, required: requis }
}
function texte(description: string): Record<string, unknown> {
  return { type: 'string', description }
}
function tronquer(s: string): string {
  return s.length > PLAFOND_SORTIE
    ? `${s.slice(0, PLAFOND_SORTIE)}\n… (tronqué, ${s.length} caractères)`
    : s
}
function relatif(base: string, f: string): string {
  return relative(base, f).split(sep).join('/')
}

async function* parcourir(dossier: string): AsyncGenerator<string> {
  const infos = await stat(dossier)
  if (infos.isFile()) {
    yield dossier
    return
  }
  for (const e of await readdir(dossier, { withFileTypes: true })) {
    if (DOSSIERS_IGNORES.has(e.name)) continue
    const p = join(dossier, e.name)
    if (e.isDirectory()) yield* parcourir(p)
    else if (e.isFile()) yield p
  }
}

function motifVersRegex(motif: string): RegExp {
  let r = ''
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i]!
    if (c === '*' && motif[i + 1] === '*') {
      r += motif[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += motif[i + 2] === '/' ? 2 : 1
    } else if (c === '*') r += '[^/]*'
    else if (c === '?') r += '[^/]'
    else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${r}$`, process.platform === 'win32' ? 'i' : '')
}

function lancer(
  cmd: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  delaiMs: number,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((res) => {
    const enfant = spawn(cmd, { cwd, env, shell: true, windowsHide: true, signal })
    let sortie = ''
    const ajouter = (d: Buffer): void => {
      if (sortie.length < PLAFOND_SORTIE * 2) sortie += d.toString('utf8')
    }
    enfant.stdout?.on('data', ajouter)
    enfant.stderr?.on('data', ajouter)
    const minuteur = setTimeout(() => enfant.kill(), delaiMs)
    enfant.on('error', (e) => {
      clearTimeout(minuteur)
      res(`Code de sortie : inconnu (${e.message})\n${tronquer(sortie)}`)
    })
    enfant.on('close', (code) => {
      clearTimeout(minuteur)
      res(`Code de sortie : ${code ?? 'arrêté (délai ou annulation)'}\n${tronquer(sortie)}`)
    })
  })
}
