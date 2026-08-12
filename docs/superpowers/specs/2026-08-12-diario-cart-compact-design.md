# Design: Diário — carrinho compacto

**Data:** 2026-08-12
**Status:** aprovado

## Problema

Em `admin.html#/diario`, o card de cada item do carrinho e a caixa "Resumo do pedido" (desconto/subtotal/total) ocupam espaço vertical excessivo, prejudicando a usabilidade em uma tela pensada para uso rápido em celular. Causa raiz identificada no código:

- `.daily-diario-cart-field` usa `gap: 1rem` entre o rótulo (Qtd/Desc./Desc. compra) e o input — 3–4× maior que o necessário.
- Cada item do carrinho é renderizado em 3 blocos empilhados (nome+excluir / campos / total), inflando a altura por linha.
- O botão de excluir do carrinho reaproveita a classe global `.btn-icon` (min. 36×36px), pensada para toolbars, não para um botão repetido em toda linha de uma lista compacta.

## Objetivos

1. Item do carrinho em **linha única** compacta: nome (+ variação) truncando com reticências, inputs de qtd/desconto inline, total, botão de excluir discreto.
2. Caixa "Resumo do pedido" compacta: "Desc. compra R$" + Subtotal + Total como linhas empilhadas enxutas, sem o bug de `gap`.
3. Botão de excluir compacto (`.diario-remove-btn`, ~24×24px, cinza → vermelho no hover/foco), reaproveitado tanto no carrinho quanto nos cards da lista "Vendas do dia" (histórico).

## Não objetivos

- Busca/combobox de produto e cliente — inalterados.
- Botão "Registrar" (submit) — inalterado.
- Modal de seleção de opções/variações do produto — inalterado.
- Estrutura geral do card da lista "Vendas do dia" — só o botão de excluir muda lá, o resto do card fica como está.
- Lógica de cálculo (JS de totais, desconto, fidelidade) — permanece idêntica; a mudança é só de apresentação/markup.
- `.btn-icon` / `.btn-sm` globais — não são tocados, para não afetar outras telas do admin (Produtos, Eventos, Distribuidores, etc.) que os reusam.

## Decisões

| Tema | Decisão |
|------|---------|
| Densidade do item do carrinho | Linha única (nome trunca, controles inline) |
| Linha "Unit.: R$X" do item | Removida do card compacto — o Total já reflete o cálculo |
| Rótulos "Qtd"/"Desc." acima dos inputs | Removidos visualmente; mantidos via `aria-label` para acessibilidade |
| Quebra em telas muito estreitas | `flex-wrap` como rede de segurança (fallback), não layout padrão |
| Escopo do botão de excluir compacto | Carrinho ativo **e** lista "Vendas do dia" (histórico) |
| Ícones do botão de excluir | Mantidos como hoje: `x` no carrinho (descarta item não salvo), `trash` no histórico (apaga registro salvo) — só o container/tamanho muda |
| Resumo do pedido | Troca do grid 2 colunas (com bug de gap) por 3 linhas empilhadas `space-between` |

## Componentes de código

| Arquivo | Mudança |
|---------|---------|
| `css/admin.css` | Reescreve regras `.daily-diario-cart-row*`, `.daily-diario-cart-field*`, `.daily-diario-cart-summary*`; adiciona `.diario-remove-btn`; remove media query específica de mobile para o resumo (não precisa mais, já é stack simples) |
| `js/admin/daily-sales.js` | `renderDiarioCart()`: novo template de linha única por item; `renderDailyDiarioList()`: troca a classe do botão de excluir para `.diario-remove-btn` |
| `admin.html` | Markup estático de `#daily-diario-cart-summary` reestruturado em 3 linhas |

## Verificação

Sem framework de teste automatizado para UI neste projeto — verificação manual no navegador:

- Adicionar produto sem variação, produto com variação, e produto criado via "Cadastrar novo produto".
- Editar quantidade e desconto inline em uma linha e confirmar que o total da linha e o Subtotal/Total do resumo recalculam.
- Aplicar desconto na compra (`Desc. compra R$`) e confirmar o Total final.
- Remover uma linha do carrinho (botão `✕`) e confirmar que o resumo atualiza.
- Registrar a venda e confirmar que ela aparece na lista "Vendas do dia" com o botão de excluir compacto; excluir um lançamento existente.
- Conferir em largura desktop (~448px, max-width do componente) e em largura estreita (~360px) que nada estoura horizontalmente.
