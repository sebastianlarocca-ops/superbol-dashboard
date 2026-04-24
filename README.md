# Superbol Dashboard

Dashboard contable mensual para Superbol. Reemplaza el flujo actual de n8n + Google Sheets + Looker Studio por una app web propia con upload de Excels, procesamiento server-side y reportes interactivos.

## Stack

- **Backend:** Node 22 + Express + TypeScript + Mongoose + Zod
- **Frontend:** React 18 + TypeScript + Vite + TailwindCSS + React Query + React Router
- **DB:** MongoDB Atlas
- **Deploy:** Railway (backend), Render (frontend)

## Empresas

Se consolidan los mayores de 4 empresas: SUPERBOL, PRUEBAS, SUSTEN, POINT.

## Estructura

```
.
├── src/                # backend
│   ├── app.ts
│   ├── config/
│   ├── routes/
│   └── middleware/
├── client/             # frontend
│   ├── src/
│   ├── vite.config.ts
│   └── tailwind.config.js
├── render.yaml         # Render (frontend)
└── .github/workflows/  # CI
```

## Setup local

1. Clonar el repo y entrar al directorio.
2. Crear `.env` en la raíz a partir de `.env.example` y completar `MONGO_URI`.
3. Instalar dependencias:
   ```bash
   npm install
   cd client && npm install
   ```
4. Levantar backend (puerto 5001):
   ```bash
   npm run dev
   ```
5. En otra terminal, levantar frontend (puerto 5173):
   ```bash
   cd client && npm run dev
   ```
6. Abrir `http://localhost:5173`. El dashboard debería mostrar el estado del backend.

## Roadmap

- [x] Fase 0 — Scaffold + CI/CD
- [ ] Fase 1 — Modelos Mongo + seed de reglas (reimputaciones, anulaciones, subrubros)
- [ ] Fase 2 — `LedgerParser` (parser stateful de mayores `.xls/.xlsx`)
- [ ] Fase 3 — Reimputator + AnulacionTagger + SubrubroEnricher + CMVCalculator
- [ ] Fase 4 — Endpoint de ingesta + página Ingesta (upload de 4 mayores + 1 inventario)
- [ ] Fase 5 — Endpoints de reportes + Dashboard + Estado de resultados
- [ ] Fase 6 — Movimientos + ABM de reglas
- [ ] Fase 7 — Balance + CMV detalle + UI con Claude Design

## Deploy

- Push a `main` → CI corre tests/build → Railway redeploya backend, Render redeploya frontend.
- Variables de entorno se configuran en cada plataforma (no se commitean).
