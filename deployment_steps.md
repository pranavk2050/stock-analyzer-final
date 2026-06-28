# Deployment Steps (Copy to Another Machine)

## 1) Requirements
- Node.js (LTS recommended)
- npm

## 2) Unzip the release
Unzip the provided archive into a folder, e.g. `ultimate-stock-optimizer/`.

## 3) Install dependencies
From the project root (where `package.json` is):

```bash
npm ci
```

> If you don’t have `npm ci`, you can run:
> ```bash
> npm install
> ```

## 4) Start the dev server
```bash
npm run dev
```

## 5) Build for production (optional)
```bash
npm run build
npm run preview
```

## Notes / Data
- This app uses only the bundled local CSVs under `jugaad_data_download/`.
- No external market-data API calls are made by the app.

