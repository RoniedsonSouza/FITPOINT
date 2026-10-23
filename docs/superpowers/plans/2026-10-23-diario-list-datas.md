# Importação de lista — datas e duplicados — Implementation Plan

> Espelho do plano executado em 2026-10-23.

**Goal:** Ler a data (dia/mês) acima de cada bloco da lista, revisar por data em etapas e evitar lançar itens já registrados.

## Decisões

- Datas dd/mm; sem ano → ano atual; se cair no futuro → ano anterior.
- Datas iguais na imagem são unidas; sem data → data selecionada no Diário + aviso.
- Duplicado = produto + cliente + quantidade + valor (±R$ 0,01); cada lançamento existente cobre 1 linha.
- Linhas duplicadas: cinza, bloqueadas, botão "Registrar mesmo assim".
- Dia completo: etapa aparece em cinza ("Já registrado"), nada é lançado.
- Revalida duplicados antes de salvar; se mudou, volta para a etapa e avisa.

## Arquivos

| Arquivo | Papel |
|---------|--------|
| `services/listVisionParse.js` | Prompt com `sections`, `resolveListDate`, `parseDateText`, `normalizeExtractedSections` |
| `routes/dailySales.js` | `POST /parse-list` devolve `sections` (+ `lines` p/ compatibilidade) |
| `js/admin/list-review-dedupe.js` | `findDuplicates`, `sectionStatus` (browser + Node) |
| `js/admin/daily-sales.js` | Etapas, data editável, Próxima/Voltar/Confirmar, salvamento por data |
| `admin.html` / `css/admin.css` | Markup e estilos da revisão |
| `scripts/test-list-dates.js` | Testes (`node scripts/test-list-dates.js`) |
