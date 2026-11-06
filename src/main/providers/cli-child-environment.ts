/**
 * Environnement minimal commun aux CLI externes.
 * Aucun secret applicatif n'est transmis par défaut ; seules les variables nécessaires
 * à la résolution du binaire, aux dossiers de configuration et au transport TLS sont conservées.
 */
const CLI_ENVIRONMENT_ALLOWLIST = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'XDG_CONFIG_HOME',
  'GH_CONFIG_DIR',
  'GLAB_CONFIG_DIR',
  'AZURE_CONFIG_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'LANG',
  'LC_ALL',
  'TERM'
])

export function cliChildEnvironment(
  environment: Readonly<NodeJS.ProcessEnv> = process.env
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) => value !== undefined && CLI_ENVIRONMENT_ALLOWLIST.has(key.toUpperCase())
    )
  )
}
