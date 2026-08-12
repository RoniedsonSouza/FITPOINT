# Diário — Carrinho Compacto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compactar o carrinho e o resumo do pedido em `admin.html#/diario` (item em linha única, resumo em 3 linhas, botão de excluir pequeno e discreto reaproveitado no carrinho e no histórico do dia).

**Architecture:** Refatoração pura de apresentação — CSS (`css/admin.css`), template-string HTML gerado em `js/admin/daily-sales.js` e markup estático em `admin.html`. Nenhuma função de cálculo (`computeDiarioLineTotal`, `computeDiarioSubtotal`, `computeDiarioSaleTotal`, etc.) muda; os seletores `data-cart-qty`, `data-cart-discount`, `data-remove-line` e os IDs usados por `getElementById` permanecem idênticos, então os handlers de evento existentes (`onDiarioCartInput`, `onDiarioCartBlur`, `onDiarioCartClick`, `onDiarioCartDiscountInput/Blur`) continuam funcionando sem alteração — com uma única exceção documentada na Task 2 (seletor de `updateDiarioCartRowTotal`).

**Tech Stack:** HTML/CSS/JS vanilla (sem build step), ícones via `lucide.createIcons()` (chamado por `refreshIcons()` em `js/admin/ui.js`). Sem framework de teste de UI no repo — verificação é manual no navegador (`http://localhost:3000/admin.html#/diario`), como já é o padrão deste projeto para telas admin.

## Global Constraints

- Não alterar `.btn-icon` / `.btn-sm` / `.btn-danger` globais (usados em Produtos, Eventos, Distribuidores, Fidelidade, etc.) — só classes novas ou escopadas a `daily-diario-*` / `diario-*`.
- Não alterar nenhuma função de cálculo, validação ou submissão (`computeDiario*`, `buildDiarioPayloadItems`, `submitDailyDiario`, `addProductToDiarioCart`, etc.).
- Preservar exatamente: IDs `daily-diario-cart`, `daily-diario-cart-summary`, `daily-diario-cart-discount`, `daily-diario-subtotal`, `daily-diario-total`; atributos `data-cart-line`, `data-cart-qty`, `data-cart-discount`, `data-remove-line`.
- Não tocar no card da lista "Vendas do dia" além do botão de excluir (resto do card, badges, layout — inalterado).
- Não tocar em combobox de produto/cliente, modal de opções, botão "Registrar".
- Spec: [docs/superpowers/specs/2026-08-12-diario-cart-compact-design.md](../specs/2026-08-12-diario-cart-compact-design.md).

---

## File Structure

| Arquivo | Papel |
|---------|-------|
| `css/admin.css` | Regras `.daily-diario-cart-row*`, `.daily-diario-cart-field*` → `.daily-diario-cart-title/-qty/-discount`, `.daily-diario-cart-summary*`, nova `.diario-remove-btn`; remove regras mortas |
| `js/admin/daily-sales.js` | `renderDiarioCart()` (linha única por item), `updateDiarioCartRowTotal()` (seletor do total), `renderDailyDiarioList()` (botão de excluir compacto) |
| `admin.html` | Markup estático de `#daily-diario-cart-summary` (3 linhas em vez de grid 2 colunas) |

Ordem das tasks: o botão compartilhado (Task 1) vai primeiro porque a Task 2 já o usa no novo template da linha do carrinho. A Task 3 (resumo do pedido) vai por último porque só ela pode remover com segurança as regras `.daily-diario-cart-field` / `span` / `input` que, até lá, ainda estilizam o campo de desconto do resumo em `admin.html`.

---

### Task 1: Botão de excluir compacto compartilhado

**Files:**
- Modify: `css/admin.css` (nova regra, inserida depois de `.daily-diario-sale-badge--loyalty` e antes do `@media (max-width: 768px)`)
- Modify: `js/admin/daily-sales.js` (`renderDailyDiarioList`)

**Interfaces:**
- Produces: classe CSS `.diario-remove-btn` (~24×24px, ícone ~14px, cinza → vermelho no hover/focus) — consumida pela Task 2 no novo template do carrinho.

- [ ] **Step 1: Adicionar a regra CSS**

Em `css/admin.css`, logo depois da regra `.daily-diario-sale-badge--loyalty` (linha ~2717-2720) e antes de `@media (max-width: 768px)`, adicionar:

```css
/* Botão de excluir compacto (carrinho e lista "Vendas do dia") */
.diario-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  color: rgba(14, 31, 22, 0.4);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

.diario-remove-btn:hover,
.diario-remove-btn:focus-visible {
  background: rgba(220, 38, 38, 0.12);
  color: #dc2626;
  outline: none;
}

.diario-remove-btn svg {
  width: 0.875rem;
  height: 0.875rem;
}
```

- [ ] **Step 2: Trocar a classe do botão na lista "Vendas do dia"**

Em `js/admin/daily-sales.js`, dentro de `renderDailyDiarioList()`, o botão atual é:

```js
            <div class="daily-diario-sale-head-actions">
              <button type="button" onclick="deleteDailySaleEntry(${item.id})" class="btn btn-danger btn-sm btn-icon" title="Excluir" aria-label="Excluir venda">
                <i data-lucide="trash"></i>
              </button>
            </div>
```

Trocar para:

```js
            <div class="daily-diario-sale-head-actions">
              <button type="button" onclick="deleteDailySaleEntry(${item.id})" class="diario-remove-btn" title="Excluir" aria-label="Excluir venda">
                <i data-lucide="trash"></i>
              </button>
            </div>
```

(Só a classe muda — `onclick`, `title`, `aria-label` e o ícone `trash` continuam iguais.)

- [ ] **Step 3: Verificar manualmente**

1. Com o servidor rodando (`npm run dev` ou já ativo em `:3000`), abrir `http://localhost:3000/admin.html#/diario`.
2. Garantir que existe ao menos um lançamento no dia (registrar um produto qualquer se a lista "Vendas do dia" estiver vazia).
3. Confirmar visualmente: o botão de excluir na lista "Vendas do dia" agora é pequeno (~24px), cinza, sem fundo vermelho sólido.
4. Passar o mouse/tocar: fundo fica vermelho claro e o ícone fica vermelho.
5. Clicar: o `confirm()` nativo ainda aparece ("Excluir este lançamento?...") e, ao confirmar, o lançamento some da lista.

- [ ] **Step 4: Commit**

```bash
git add css/admin.css js/admin/daily-sales.js
git commit -m "style(admin): botão de excluir compacto no histórico do diário"
```

---

### Task 2: Item do carrinho em linha única

**Files:**
- Modify: `js/admin/daily-sales.js` (`renderDiarioCart`, `updateDiarioCartRowTotal`)
- Modify: `css/admin.css` (`.daily-diario-cart-row` e vizinhas)

**Interfaces:**
- Consumes: `.diario-remove-btn` (Task 1).
- Produces: classes `.daily-diario-cart-title`, `.daily-diario-cart-qty`, `.daily-diario-cart-discount` no item do carrinho; `.daily-diario-cart-total` agora é o próprio `<strong>` (sem wrapper `<div><span>Total</span><strong>` de antes) — relevante para quem for mexer nessa linha depois.

- [ ] **Step 1: Reescrever `renderDiarioCart()`**

Em `js/admin/daily-sales.js`, a função atual (por volta da linha 625) é:

```js
function renderDiarioCart() {
  const container = document.getElementById('daily-diario-cart');
  if (!container) return;

  if (diarioCart.length === 0) {
    container.innerHTML = '<p class="daily-diario-cart-empty">Nenhum produto adicionado.</p>';
    updateDiarioCartSummary();
    return;
  }

  container.innerHTML = diarioCart.map(line => {
    const lineTotal = computeDiarioLineTotal(line);
    const key = getDiarioCartLineKey(line);
    const optionHint = line.optionName
      ? `<span class="daily-diario-cart-option">${escapeHtml(line.optionName)}</span>`
      : '';
    return `
      <div class="daily-diario-cart-row" data-cart-line="${escapeAttr(key)}">
        
        <div class="daily-diario-cart-row-name-header">
          <div class="daily-diario-cart-row-name">
            <span class="daily-diario-cart-title">${escapeHtml(line.name)}</span>
            ${optionHint}
            <span class="daily-diario-cart-base">Unit.: ${formatCurrency(line.basePrice)}</span>
          </div>
          <div>
            <button type="button" class="btn btn-danger btn-sm btn-icon daily-diario-cart-remove" data-remove-line="${escapeAttr(key)}" title="Remover" aria-label="Remover produto">
              <i data-lucide="x"></i>
            </button>
          </div>
        </div>
        <div class="daily-diario-cart-row-fields">
          <label class="daily-diario-cart-field daily-diario-cart-field--qty">
            <span>Qtd</span>
            <input type="number" min="1" step="1" value="${line.quantity}" data-cart-qty inputmode="numeric">
          </label>
          <label class="daily-diario-cart-field daily-diario-cart-field--discount">
            <span>Desc.</span>
            <input type="number" min="0" step="0.01" value="${formatDecimalInput(line.discount, MONEY_DECIMALS)}" data-cart-discount inputmode="decimal" title="Desconto por unidade (R$)">
          </label>
        </div>
        <div class="daily-diario-cart-total">
          <span>Total &nbsp;</span>
          <strong>${formatCurrency(lineTotal)}</strong>
        </div>
      </div>
    `;
  }).join('');
  updateDiarioCartSummary();
  refreshIcons();
}
```

Trocar para:

```js
function renderDiarioCart() {
  const container = document.getElementById('daily-diario-cart');
  if (!container) return;

  if (diarioCart.length === 0) {
    container.innerHTML = '<p class="daily-diario-cart-empty">Nenhum produto adicionado.</p>';
    updateDiarioCartSummary();
    return;
  }

  container.innerHTML = diarioCart.map(line => {
    const lineTotal = computeDiarioLineTotal(line);
    const key = getDiarioCartLineKey(line);
    const label = line.optionName ? `${line.name} · ${line.optionName}` : line.name;
    return `
      <div class="daily-diario-cart-row" data-cart-line="${escapeAttr(key)}">
        <span class="daily-diario-cart-title" title="${escapeAttr(label)}">${escapeHtml(label)}</span>
        <input type="number" min="1" step="1" value="${line.quantity}" data-cart-qty inputmode="numeric" class="daily-diario-cart-qty" aria-label="Quantidade">
        <input type="number" min="0" step="0.01" value="${formatDecimalInput(line.discount, MONEY_DECIMALS)}" data-cart-discount inputmode="decimal" class="daily-diario-cart-discount" aria-label="Desconto por unidade (R$)">
        <strong class="daily-diario-cart-total">${formatCurrency(lineTotal)}</strong>
        <button type="button" class="diario-remove-btn" data-remove-line="${escapeAttr(key)}" title="Remover" aria-label="Remover produto">
          <i data-lucide="x"></i>
        </button>
      </div>
    `;
  }).join('');
  updateDiarioCartSummary();
  refreshIcons();
}
```

(A dica de variação/opção — `line.optionName` — que antes era uma linha separada agora entra junto do nome, ex. "Whey Protein · Chocolate", truncando com reticências se não couber; o `title` no `<span>` mostra o texto completo ao passar o mouse. A linha "Unit.: R$X" sai do card, conforme aprovado na spec — o Total já reflete o cálculo.)

- [ ] **Step 2: Corrigir o seletor em `updateDiarioCartRowTotal()`**

O template antigo tinha `.daily-diario-cart-total` como uma `<div>` com um `<strong>` filho; o novo template faz `.daily-diario-cart-total` ser o próprio `<strong>`. Em `js/admin/daily-sales.js`, a função atual (por volta da linha 176) é:

```js
function updateDiarioCartRowTotal(lineKey) {
  const row = Array.from(document.querySelectorAll('[data-cart-line]'))
    .find(el => el.dataset.cartLine === lineKey);
  const line = diarioCart.find(l => getDiarioCartLineKey(l) === lineKey);
  if (!row || !line) return;

  const qtyInput = row.querySelector('[data-cart-qty]');
  const discInput = row.querySelector('[data-cart-discount]');
  const preview = getDiarioLinePreview(
    line,
    qtyInput?.value,
    discInput?.value
  );
  const totalEl = row.querySelector('.daily-diario-cart-total strong');
  if (totalEl) totalEl.textContent = formatCurrency(computeDiarioLineTotal(preview));
  updateDiarioCartSummary();
}
```

Trocar a linha do `totalEl` para:

```js
  const totalEl = row.querySelector('.daily-diario-cart-total');
  if (totalEl) totalEl.textContent = formatCurrency(computeDiarioLineTotal(preview));
```

(Sem essa correção, editar quantidade/desconto pararia de atualizar o total exibido na linha — a busca por `strong` dentro de `.daily-diario-cart-total` não encontraria mais nada, já que agora é o próprio elemento.)

- [ ] **Step 3: Atualizar o CSS da linha do carrinho**

Em `css/admin.css`, substituir o bloco de `.daily-diario-cart-row` (linha ~2389) até `.daily-diario-cart-total strong` (linha ~2503) — ou seja, todas as regras `.daily-diario-cart-row*`, `.daily-diario-cart-title`, `.daily-diario-cart-base`, `.daily-diario-cart-total*` e o modificador `--qty`/`--discount` de `.daily-diario-cart-field` — pelo seguinte (a base `.daily-diario-cart-field`, `.daily-diario-cart-field span` e `.daily-diario-cart-field input...` **não** entram aqui — ainda são usadas pelo resumo do pedido até a Task 3):

```css
.daily-diario-cart-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 0.625rem;
  padding: 0.5rem 0.625rem;
}

.daily-diario-cart-title {
  flex: 1 1 6rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 0.8125rem;
  line-height: 1.3;
}

.daily-diario-cart-qty,
.daily-diario-cart-discount {
  flex: 0 0 auto;
  min-width: 0;
  height: 1.75rem;
  padding: 0.15rem 0.25rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  text-align: center;
  box-sizing: border-box;
  -moz-appearance: textfield;
  appearance: textfield;
}

.daily-diario-cart-qty::-webkit-outer-spin-button,
.daily-diario-cart-qty::-webkit-inner-spin-button,
.daily-diario-cart-discount::-webkit-outer-spin-button,
.daily-diario-cart-discount::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.daily-diario-cart-qty {
  width: 2.25rem;
}

.daily-diario-cart-discount {
  width: 3.5rem;
}

.daily-diario-cart-total {
  flex: 0 0 auto;
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.2;
  color: var(--fp-green);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
```

Também remover, por ficarem mortas (nada mais as usa depois deste passo):
- `.daily-diario-cart-option` (linha ~2182-2187, no bloco de estilos do combobox — busque por esse seletor no arquivo, fica antes do comentário "Carrinho multi-produto")
- `.daily-diario-cart-field--qty` e `.daily-diario-cart-field--discount` (os modificadores de largura — a base `.daily-diario-cart-field` continua)

No `@media (max-width: 768px)` no fim do arquivo, remover as regras que não fazem mais sentido (o card já nasce compacto, não precisa de um segundo ajuste mobile):

```css
  .daily-diario-cart-row {
    gap: 0.5rem;
    padding: 12px;
  }

  .daily-diario-cart-field--qty {
    width: 3.25rem;
    flex-basis: 3.25rem;
  }

  .daily-diario-cart-field--discount {
    width: 4.75rem;
    flex-basis: 4.75rem;
  }

  .daily-diario-cart-field input,
  .daily-diario-cart-field input[type="number"] {
    min-height: 1.875rem;
    height: 1.875rem;
    padding: 0.1rem 0.3rem;
    font-size: 0.75rem;
  }

  .daily-diario-cart-total strong {
    font-size: 0.875rem;
  }
```

(As regras de `.daily-diario-cart-summary*` que estão logo depois, no mesmo media query, ficam — são da Task 3.)

- [ ] **Step 4: Verificar manualmente**

1. Abrir `http://localhost:3000/admin.html#/diario`.
2. Adicionar um produto sem variação — confirmar que aparece como uma linha única: nome, campo de qtd pequeno, campo de desconto pequeno, total em negrito, `✕` discreto à direita.
3. Adicionar um produto com variação/opção (se houver algum cadastrado com `options`) — confirmar que o nome mostra "Produto · Variação" truncando se necessário, e passando o mouse aparece o texto completo (tooltip nativo).
4. Editar a quantidade de uma linha (digitar e sair do campo) — confirmar que o total da linha e o "Subtotal"/"Total" do resumo abaixo recalculam.
5. Editar o desconto de uma linha — mesma verificação.
6. Clicar no `✕` de uma linha — confirmar que ela some e o resumo recalcula.
7. Redimensionar a janela para ~360px de largura (ou usar as ferramentas de dispositivo móvel do navegador) — confirmar que nada estoura horizontalmente; em nomes muito longos, a linha pode quebrar (`flex-wrap`), o que é esperado como rede de segurança.

- [ ] **Step 5: Commit**

```bash
git add css/admin.css js/admin/daily-sales.js
git commit -m "style(admin): item do carrinho do diário em linha única compacta"
```

---

### Task 3: Resumo do pedido em 3 linhas

**Files:**
- Modify: `admin.html` (`#daily-diario-cart-summary`)
- Modify: `css/admin.css` (`.daily-diario-cart-summary*`, remoção final de `.daily-diario-cart-field*`)

**Interfaces:**
- Consumes: nada de outras tasks (IDs `daily-diario-cart-discount`, `daily-diario-subtotal`, `daily-diario-total` já existem e não mudam).
- Produces: nada consumido por outra task — última do plano.

- [ ] **Step 1: Reescrever o markup do resumo em `admin.html`**

O bloco atual (por volta da linha 385) é:

```html
            <div id="daily-diario-cart-summary" class="daily-diario-cart-summary hidden">
              <label class="daily-diario-cart-field daily-diario-cart-discount-field">
                <span>Desc. compra R$</span>
                <input type="number" id="daily-diario-cart-discount" min="0" step="0.01" value="0" inputmode="decimal"
                  aria-label="Desconto na compra">
              </label>
              <div class="daily-diario-cart-summary-totals">
                <p class="daily-diario-cart-summary-line">
                  <span>Subtotal</span>
                  <strong id="daily-diario-subtotal">R$&nbsp;0,00</strong>
                </p>
                <p class="daily-diario-cart-summary-line daily-diario-cart-summary-line--total">
                  <span>Total</span>
                  <strong id="daily-diario-total">R$&nbsp;0,00</strong>
                </p>
              </div>
            </div>
```

Trocar para:

```html
            <div id="daily-diario-cart-summary" class="daily-diario-cart-summary hidden">
              <div class="daily-diario-cart-summary-row">
                <span>Desc. compra R$</span>
                <input type="number" id="daily-diario-cart-discount" min="0" step="0.01" value="0" inputmode="decimal"
                  aria-label="Desconto na compra">
              </div>
              <div class="daily-diario-cart-summary-row">
                <span>Subtotal</span>
                <strong id="daily-diario-subtotal">R$&nbsp;0,00</strong>
              </div>
              <div class="daily-diario-cart-summary-row daily-diario-cart-summary-row--total">
                <span>Total</span>
                <strong id="daily-diario-total">R$&nbsp;0,00</strong>
              </div>
            </div>
```

(IDs iguais aos de antes — `updateDiarioCartSummary()`, `onDiarioCartDiscountInput`/`Blur` e `clearDiarioFormState()` continuam funcionando sem mudança nenhuma no JS.)

- [ ] **Step 2: Atualizar o CSS do resumo**

Em `css/admin.css`, substituir todo o bloco de `.daily-diario-cart-summary` (linha ~2505) até `.daily-diario-cart-summary-line--total strong` (linha ~2556) por:

```css
.daily-diario-cart-summary {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.625rem 0.75rem;
  background: rgba(29, 107, 58, 0.05);
  border: 1px solid rgba(29, 107, 58, 0.12);
  border-radius: 0.75rem;
}

.daily-diario-cart-summary.hidden {
  display: none;
}

.daily-diario-cart-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8125rem;
  color: rgba(14, 31, 22, 0.55);
}

.daily-diario-cart-summary-row input {
  width: 5.5rem;
  min-height: 1.75rem;
  height: 1.75rem;
  padding: 0.15rem 0.4rem;
  font-size: 0.8125rem;
  text-align: right;
  border-radius: 0.5rem;
  box-sizing: border-box;
  -moz-appearance: textfield;
  appearance: textfield;
}

.daily-diario-cart-summary-row input::-webkit-outer-spin-button,
.daily-diario-cart-summary-row input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.daily-diario-cart-summary-row strong {
  font-size: 0.875rem;
  color: rgba(14, 31, 22, 0.75);
  font-weight: 600;
}

.daily-diario-cart-summary-row--total {
  padding-top: 0.375rem;
  border-top: 1px solid rgba(29, 107, 58, 0.15);
  font-size: 0.8125rem;
  color: rgba(14, 31, 22, 0.7);
}

.daily-diario-cart-summary-row--total strong {
  font-size: 1.0625rem;
  color: var(--fp-green);
}
```

Agora que nada mais usa `.daily-diario-cart-field` (a linha do carrinho já não usa desde a Task 2, e o resumo acabou de deixar de usar), remover também:
- `.daily-diario-field` **não** — atenção, esse é de outro formulário (busca de produto/cliente), não remover.
- `.daily-diario-cart-field`, `.daily-diario-cart-field span`, `.daily-diario-cart-field input, .daily-diario-cart-field input[type="number"]`, `.daily-diario-cart-field input::-webkit-outer-spin-button, .daily-diario-cart-field input::-webkit-inner-spin-button`, `.daily-diario-cart-discount-field` — todas essas, sim, remover.

No `@media (max-width: 768px)` no fim do arquivo, remover o que restou específico do resumo antigo:

```css
  .daily-diario-cart-summary {
    grid-template-columns: 1fr;
  }

  .daily-diario-cart-summary-totals {
    text-align: left;
  }

  .daily-diario-cart-summary-line {
    justify-content: space-between;
  }
```

(O resumo novo já é uma coluna simples em qualquer largura — não precisa de override mobile.)

- [ ] **Step 3: Verificar manualmente**

1. Abrir `http://localhost:3000/admin.html#/diario` com o carrinho vazio — confirmar que o resumo continua escondido (`hidden`).
2. Adicionar um produto — confirmar que o resumo aparece como 3 linhas compactas: "Desc. compra R$" com o campo à direita, "Subtotal" à direita, "Total" em destaque com uma linha divisória acima.
3. Editar "Desc. compra R$" — confirmar que "Subtotal" não muda e "Total" diminui corretamente (testar um valor maior que o subtotal e confirmar que é limitado ao subtotal, igual ao comportamento atual).
4. Remover todos os produtos do carrinho — confirmar que o resumo volta a ficar escondido e o campo de desconto volta a `0,00`.
5. Registrar a venda — confirmar que o submit funciona normalmente e a lista "Vendas do dia" atualiza.
6. Conferir em ~360px de largura que as 3 linhas continuam legíveis e nada estoura.

- [ ] **Step 4: Commit**

```bash
git add admin.html css/admin.css
git commit -m "style(admin): resumo do pedido do diário em 3 linhas compactas"
```

---

## Verificação final (depois das 3 tasks)

Repetir o roteiro completo da spec em uma sessão só: adicionar múltiplos produtos (com e sem variação, incluindo um cadastrado na hora via "Cadastrar novo produto"), editar qtd/desconto de mais de uma linha, aplicar desconto na compra, remover uma linha, registrar a venda, conferir que ela aparece no histórico com o botão compacto, excluir um lançamento do histórico — tudo em largura desktop (~448px) e estreita (~360px).
