# Autowin OS

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

Pour la version locale à ouvrir depuis le Bureau, utilise toujours :

```bash
$ npm run build:desktop
```

Cette commande reconstruit le paquet canonique dans `dist\win-unpacked\autowin-os.exe` puis met à jour `Autowin OS.lnk` sur le Bureau vers ce même exécutable. Ne crée pas de build final dans un sous-dossier `dist\*` et ne pointe jamais le raccourci vers un ancien sous-dossier de validation.

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
