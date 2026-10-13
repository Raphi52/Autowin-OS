/**
 * Les deux commandes RÉELLES du 2026-10-13, recopiées mot pour mot des sessions du CLI, qui ont
 * retouché un fichier de test que le commit automatique du chat a ensuite laissé de côté.
 */

/** conv-932, tour 861aad09 : le test, créé par Write, est reformaté par prettier (d7af3730). */
export const COMMANDE_CONV_932 =
  'cd /d/AutoWinOS; npx prettier --write src/main/githooks-pre-push.test.ts >/dev/null; npx eslint src/main/githooks-pre-push.test.ts vitest.config.ts; echo "lint=$?"; npx tsc --noEmit -p tsconfig.node.json 2>&1 | grep -n "githooks-pre-push\\|vitest.config" | head; echo "tsc-fichiers-touches-erreurs=$(npx tsc --noEmit -p tsconfig.node.json 2>&1 | grep -c \'githooks-pre-push\\|vitest.config\')"'

/** conv-933, tour f24b1b7e : le test est complété par un here-document puis `sed -i` (dd0c3d6a). */
export const COMMANDE_CONV_933 = [
  "cat >> src/main/relance-auto-moteur.test.ts <<'EOF'",
  '',
  "describe('resumerErreurDeCompilation', () => {",
  "  // Sortie RÉELLE d'un `electron-vite build` en échec, capturée le 13/10 : picocolors force les",
  '  // couleurs sous Windows même quand la sortie part dans un tube, et la ligne « Build failed »',
  '  // arrive AVANT le motif. Le bandeau affichait « □[31m□□[39m Build failed in 270ms ».',
  "  const ESC = '\\u001b'",
  '  const SORTIE_VITE = [',
  '    `${ESC}[31m✗${ESC}[39m Build failed in 72ms`,',
  '    `${ESC}[31merror during build:`,',
  '    `${ESC}[31m[vite:esbuild] Transform failed with 1 error:`,',
  '    `D:/AutoWinOS/src/main/x.ts:3:0: ERROR: Unexpected "}"${ESC}[31m`,',
  '    `file: ${ESC}[36mD:/AutoWinOS/src/main/x.ts:3:0${ESC}[31m`,',
  '    `${ESC}[33m`,',
  '    `${ESC}[33mUnexpected "}"${ESC}[33m`,',
  "    '3  |  }',",
  '    `${ESC}[31m`,',
  "    '    at failureErrorWithLog (D:\\\\AutoWinOS\\\\node_modules\\\\esbuild\\\\lib\\\\main.js:1748:15)'",
  "  ].join('\\n')",
  '',
  "  it('rend le MOTIF réel, sans code couleur ni la ligne « Build failed in … »', () => {",
  '    expect(resumerErreurDeCompilation(SORTIE_VITE)).toBe(',
  '      \'D:/AutoWinOS/src/main/x.ts:3:0: ERROR: Unexpected "}"\'',
  '    )',
  '  })',
  '',
  "  it('une erreur de résolution Rollup sans le mot « error » reste le motif rendu', () => {",
  '    const sortie = [',
  "      '✗ Build failed in 40ms',",
  "      'error during build:',",
  '      \'src/main/a.ts (1:9): "foo" is not exported by "src/main/b.ts", imported by "src/main/a.ts".\',',
  "      'file: D:/AutoWinOS/src/main/a.ts:1:9',",
  "      '    at getRollupError (D:\\\\AutoWinOS\\\\node_modules\\\\rollup\\\\dist\\\\shared\\\\parseAst.js:1:1)'",
  "    ].join('\\n')",
  '    expect(resumerErreurDeCompilation(sortie)).toBe(',
  '      \'src/main/a.ts (1:9): "foo" is not exported by "src/main/b.ts", imported by "src/main/a.ts".\'',
  '    )',
  '  })',
  '',
  "  it('sans aucune ligne parlante, le dit au lieu de rendre « Build failed »', () => {",
  "    expect(resumerErreurDeCompilation('✗ Build failed in 5ms\\nerror during build:')).toBe(",
  "      'motif non rapporté'",
  '    )',
  '  })',
  '})',
  'EOF',
  "sed -i 's/^  relanceAutoMoteurPermise,$/  relanceAutoMoteurPermise,\\n  resumerErreurDeCompilation,/' src/main/relance-auto-moteur.test.ts && sed -n 5,13p src/main/relance-auto-moteur.test.ts"
].join('\n')
