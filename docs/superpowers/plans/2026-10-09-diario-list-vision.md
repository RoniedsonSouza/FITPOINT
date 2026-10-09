# Importação de lista (Vision) no Diário — Implementation Plan

> Espelho do plano executado em 2026-10-09.

**Goal:** Foto de lista manuscrita → Gemini Vision → revisão editável → registro no Diário via batches por cliente.

**Architecture:** Multer memória → Gemini JSON → match catálogo → modal → `N × POST /api/daily-sales/batch`.

**Tech Stack:** Express, Multer, Gemini REST (`fetch`), admin vanilla.

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `services/listVisionParse.js` | Gemini + normalização |
| `services/listMatch.js` | Match fuzzy |
| `middleware/imageUpload.js` | `memoryImageUpload` |
| `routes/dailySales.js` | `POST /parse-list` |
| `js/database.js` | `parseDailySalesList` |
| `admin.html` / `js/admin/daily-sales.js` / `css/admin.css` | UI revisão |
| `.env.example` | `GEMINI_API_KEY`, `GEMINI_MODEL` |

## Tasks

1. Serviços Gemini + match + env
2. Rota `POST /parse-list`
3. UI importar + modal + confirmação agrupada
4. Docs em `docs/superpowers/`

## Operação

Definir no `.env` local (não commitado):

```
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash
```
