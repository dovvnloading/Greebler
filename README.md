# Greebler

Greebler is a procedural sci-fi surface and PBR material generator built with React, Vite, and Three.js.

## Local development

Requirements: Node.js 24 and npm 11 or newer.

```bash
npm ci
npm run dev
```

The development server runs at `http://localhost:3000/`.

## Production build

```bash
npm run lint
npm run build
npm run preview
```

## GitHub Pages

The deployment workflow builds the app with the repository project path and publishes `dist/` through GitHub Pages whenever `main` changes.

Repository setup:

1. Open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Merge a validated change to `main`, or run **Deploy GitHub Pages** manually from the Actions tab.

The project site URL is:

`https://dovvnloading.github.io/Greebler/`

GitHub Free requires the repository to be public. Private-repository Pages requires GitHub Pro, Team, or Enterprise.
