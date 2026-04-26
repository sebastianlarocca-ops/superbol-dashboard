# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

Two-package monorepo (no workspaces — they're independent npm projects):

- **Backend** (root, `src/`) — Node 22 + Express + TypeScript + Mongoose + Zod. Runs on port `5001`.
- **Frontend** (`client/`) — React 18 + Vite + TailwindCSS + React Query + React Router. Runs on port `5173`, proxies `/api` → `localhost:5001` (see [vite.config.ts](client/vite.config.ts)).

Install dependencies separately in each: `npm install` in root, `cd client && npm install`.

## Common commands

Backend (run from repo root):

```bash
npm run dev          # ts-node-dev with respawn on port 5001
npm run build        # tsc → ./dist
npm start            # node dist/app.js (uses built output)
npm run lint         # eslint src --ext .ts
npm run seed:rules   # idempotent sync of src/seed/data/*.json → Mongo (see seedRules.ts)
```

Frontend (run from `client/`):

```bash
npm run dev          # vite dev server on 5173
npm run build        # tsc -b && vite build
npm run preview      # preview the production build
```

There is no test suite. CI ([.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml)) only runs `npm run build` for both packages.

`MONGO_URI` is required (see [.env.example](.env.example)). The backend will not start without it.

## scratch/ — local dev sandbox

`scratch/` is gitignored and contains:
- Real ledger/inventory `.xls`/`.xlsx` files for testing the parser against production-shaped data.
- One-off TypeScript scripts (`dry-run-parser.ts`, `dry-run-cmv.ts`, `dry-run-full.ts`, `inspect-mayor.ts`, `inspect-inventory.ts`, `delete-batch.ts`, `check-sept.ts`).

Run scratch scripts with `npx ts-node --transpile-only scratch/<name>.ts`. **Never commit anything in `scratch/`** except the README — it contains real accounting data.

## Big-picture architecture

The product replaces an n8n + Google Sheets + Looker pipeline. The interesting code is server-side: parsing four monthly `libro mayor` Excel exports plus one inventory file, enriching the rows, computing CMV (cost of merchandise sold), and persisting a normalized ledger that the frontend queries.

### Domain primitives ([src/types/empresa.ts](src/types/empresa.ts))

- **Empresas** (4 hardcoded): `SUPERBOL`, `PRUEBAS`, `SUSTEN`, `POINT`. Reports consolidate across all four; `empresa` query param scopes to one.
- **Periodo** is always the string `"MM/YYYY"`. The parser infers it from the first valid date cell in the ledger; ingestion rejects batches whose ledgers disagree on periodo.
- **Rubro** classification is a pure function of `numeroCuenta`: `1000–2999 → Activo`, `3000–3999 → Pasivo`, `6000–6999 → Resultado negativo`, `7000–7999 → Resultado positivo`, anything else (including non-numeric codes like `f001`, `z001`) → `Cuentas puentes`. There's a small `NON_NUMERIC_RUBRO_OVERRIDES` map for known non-numeric codes.

### Ingestion pipeline ([src/services/ingestion/IngestionService.ts](src/services/ingestion/IngestionService.ts))

`POST /api/v1/ingesta` accepts 1–4 ledger files (one per empresa, no duplicates) plus an optional inventory file. The orchestrator:

1. Loads the 3 rule collections from Mongo (reimputaciones, anulaciones, subrubro maps).
2. For each ledger: `parseLedger` (state-machine parser over the Bejerman-shaped Excel — see [LedgerParser.ts](src/services/parser/LedgerParser.ts)) → `enrichMovements` (3-step pipeline, see below).
3. Validates all parsed periodos agree. The sentinel `"00/0000"` means "file had zero movimientos" (legitimate for `POINT`, an "empresa pantalla").
4. **Idempotency:** if a successful batch already exists for the period, reject with HTTP 409 unless `force=true` is sent. `force` cascade-deletes the prior batch's `Movement`s, `InventoryItem`s, and the batch row before re-ingesting.
5. Creates an `IngestionBatch` (`status='processing'`).
6. If an inventory was provided, runs `parseInventory` + `calculateCMV` and appends the resulting **CMV pseudo-movements** to the movement docs (attributed to `SUPERBOL` — the other 3 entities are "medio pantalla").
7. Bulk-inserts all `Movement` and `InventoryItem` docs (`ordered: false`).
8. Updates the batch with stats + `status='success'`. On error, marks `status='failed'` with the message; does not delete partial data so the failed batch can be inspected (and is re-rejected on retry).

There is no Mongo transaction wrapping the inserts — by design, to keep the code simple. The idempotency check is the recovery mechanism.

### Enrichment ([src/services/enrichment/pipeline.ts](src/services/enrichment/pipeline.ts))

Three stages run in this order, **and the order matters**:

1. **Reimputator** — looks up `(nombreCuenta, nombreSubcuenta)` in `reimputation_rules` and writes `numeroCuentaReimputada` / `nombreCuentaReimputada`. If no rule matches, the reimputed fields fall back to the originals.
2. **AnulacionTagger** — sets `anulacion: boolean` based on `anulacion_rules` matching `(nombreCuenta, nombreSubcuenta)` on the **original** (pre-reimputation) names.
3. **SubrubroEnricher** — looks up `nombreCuentaReimputada` (post-reimputation) in `subrubro_map` to assign a `subrubro`. If no mapping is found and the rubro is `Resultado *`, emit a `SUBRUBRO_NOT_FOUND` warning. Patrimoniales (`Activo`/`Pasivo`) don't need subrubros.

Warnings are deduplicated by case key with an `occurrences` counter — never emit one warning per movement. A `Cuentas puentes` rubro after reimputation also produces an `UNCLASSIFIED_REIMPUTACION` warning prompting the user to add a rule.

### Reports ([src/routes/reports.ts](src/routes/reports.ts), [src/services/reports/queries.ts](src/services/reports/queries.ts))

Endpoints: `/reports/pnl`, `/reports/balance`, `/reports/cmv`, `/reports/movements`. Conventions across all of them:

- `periodo` (`MM/YYYY`) is required.
- `empresa` is optional; omitted = consolidated.
- **All filters operate on the reimputed fields** (`numeroCuentaReimputada`, `rubroReimputada`, `subrubro`), never the raw ledger fields.
- **Anulaciones are excluded from P&L by default** (Sebastián tags dueño retiros as anuladas to keep them out of the P&L while preserving the data); pass `includeAnulados=true` to include them.
- `Cuentas puentes` is hidden from P&L — unclassified movs surface only as warnings during ingestion.

### CMV ([src/services/cmv/CMVCalculator.ts](src/services/cmv/CMVCalculator.ts))

- "Compras" comes from movements on accounts `1600`, `1620`, `6200` matched **pre-reimputation** (`numeroCuenta`, not `numeroCuentaReimputada`), so the calculation stays deterministic regardless of rule state.
- The calculator emits four pseudo-movements (CMV bruto, ajuste de stock, costo financiero RP, costo financiero RN) attached to virtual cuentas `6200`, `6900`, `7900`. These are stored as `Movement` docs with `sourceType: 'cmv-calc'` so they appear in P&L alongside ledger movs.

### Models ([src/models/](src/models/))

`Movement`, `IngestionBatch`, `InventoryItem`, `ReimputationRule`, `AnulacionRule`, `SubrubroMap`, `DolarCotizacion`. Every `Movement` carries `ingestionBatchId` (FK to `IngestionBatch`) and `sourceType: 'ledger' | 'cmv-calc' | 'manual'`.

### Rules are sourced from JSON

`src/seed/data/{reimputations,anulaciones,subrubros}.json` is the source of truth. `npm run seed:rules` upserts every row by natural key **and prunes** any DB rows whose key is not in the JSON. Editing rules in the DB directly will be reverted on the next seed run.

### Frontend pages ([client/src/pages/](client/src/pages/))

Routes wired in [App.tsx](client/src/App.tsx): Dashboard, Ingesta (drag-drop with auto file-type detection via the `/sniff` endpoint), Resultados (P&L), CMV, Movimientos (ledger browser with Excel-style filters), Movimientos manuales, Cotizaciones (ARS/USD dólar bolsa), Reglas (rule ABM). `CurrencyContext` toggles ARS/USD across the app.

## Deploy

Push to `main` → CI builds backend and frontend → Railway redeploys backend, Render redeploys the frontend static site (config in [render.yaml](render.yaml)). Env vars are set per-platform.
