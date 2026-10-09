# Design: Importação de lista (Vision) no Diário

**Data:** 2026-10-09  
**Status:** Aprovado

## Problema

O admin registra vendas no Diário (`admin.html#/diario`) a partir de uma lista manuscrita (quantidade, produto, nome do cliente, valor). Digitar tudo é lento e sujeito a erro.

## Solução

Usar **Gemini Vision** (não OCR local) para extrair linhas da foto, fazer match com o catálogo, e exigir uma **tela de revisão editável** antes de qualquer `POST /api/daily-sales/batch`.

## Requisitos

- Fonte: foto de lista manuscrita
- Colunas: quantidade, produto, nome do cliente, valor (R$)
- Revisão obrigatória com edição (qtd, produto, cliente, valor) e remoção de linhas
- Sem registro automático
- v1: sem fiado; sem criar produto/cliente automaticamente
- Permissão: `vendas`
- Env: `GEMINI_API_KEY`, opcional `GEMINI_MODEL` (default `gemini-2.0-flash`)

## Arquitetura

1. UI: botão **Importar lista** → `input[type=file]` (câmera/arquivo)
2. `POST /api/daily-sales/parse-list` (multipart `image`, memória, sem persistir em `media`)
3. `services/listVisionParse.js` chama Gemini e normaliza JSON
4. `services/listMatch.js` faz match fuzzy com produtos e clientes ativos
5. Modal de revisão no admin
6. Confirmação agrupa linhas por `loyalty_customer_id` e chama `POST /batch` por grupo (API atual aceita um cliente por batch)

## Fora de escopo (v1)

- Fiado / `amount_pending`
- Criação automática de produto ou cliente
- Persistência da foto
- Opções/adicionais
- Tesseract / OCR local
