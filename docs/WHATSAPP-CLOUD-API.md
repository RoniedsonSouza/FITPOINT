# Configuração: WhatsApp Cloud API (Meta)

Guia passo a passo para conectar o FitPoint à **API oficial** da Meta e enviar, com **um botão** no admin, a mensagem de reativação aos clientes de fidelidade ausentes há mais de 3 dias.

Documentação oficial: [Get Started — WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/).

---

## O que o FitPoint espera

No arquivo `.env` (copie de `.env.example` se ainda não tiver):

| Variável | Obrigatória | Para quê |
|----------|-------------|----------|
| `WHATSAPP_TOKEN` | Sim | Token permanente (usuário de sistema) |
| `WHATSAPP_PHONE_NUMBER_ID` | Sim | ID do número que envia (não é o telefone `5511…`) |
| `WHATSAPP_TEMPLATE_NAME` | Não | Nome do template na Meta. Padrão: `reativacao_ausente` |
| `WHATSAPP_TEMPLATE_LANG` | Não | Idioma do template. Padrão: `pt_BR` |

Exemplo:

```env
WHATSAPP_TOKEN=EAAxxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_TEMPLATE_NAME=reativacao_ausente
WHATSAPP_TEMPLATE_LANG=pt_BR
```

Depois de salvar o `.env`, **reinicie o servidor**. Sem token e Phone Number ID, o botão no admin fica desabilitado.

O FitPoint chama:

```text
POST https://graph.facebook.com/v21.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
```

e envia o template com duas variáveis de corpo:

| Variável Meta | Conteúdo |
|---------------|----------|
| `{{1}}` | Primeiro nome do cliente |
| `{{2}}` | Dias sem visita |

O texto da mensagem **não se edita no admin**. Só muda se você criar outro template na Meta e apontar `WHATSAPP_TEMPLATE_NAME`.

---

## Antes de começar — leia isto

1. **Número dedicado.** Quando um telefone entra na Cloud API, ele **deixa de funcionar** no app WhatsApp / WhatsApp Business. Não use o celular pessoal do espaço. Use um número só para a API (chip, virtual ou linha fixa compatível).
2. **Conta Meta Business.** Precisa de um [portfólio / Business Manager](https://business.facebook.com/) e de um usuário admin.
3. **Mensagens de marketing têm custo.** A Cloud API não cobra mensalidade da Meta; cobra **por conversa/mensagem** na categoria Marketing. Confira a [tabela de preços](https://developers.facebook.com/docs/whatsapp/pricing) para o Brasil.
4. **Forma de pagamento.** Em produção a Meta exige método de pagamento no Business para enviar além da cota de teste.
5. **Template aprovado.** Reativação (você inicia a conversa) **exige** template. Texto livre só vale se o cliente já respondeu nas últimas 24 h.

---

## Passo 1 — Conta de desenvolvedor e Business

1. Acesse [https://developers.facebook.com](https://developers.facebook.com) e entre com o Facebook que administra o negócio.
2. Se pedir, registre-se como desenvolvedor.
3. Confirme que existe um **portfólio de negócios** em [https://business.facebook.com](https://business.facebook.com) (ex.: FitPoint).
4. Você precisa ser **admin** desse portfólio.

---

## Passo 2 — Criar o app Meta

A tela da Meta muda com frequência. Use o fluxo **mais próximo** disto:

1. Abra o [Painel de apps](https://developers.facebook.com/apps/).
2. Clique em **Criar app**.
3. Informe o **nome** (ex.: `FitPoint WhatsApp`) e um e-mail de contato.
4. Se aparecer casos de uso, escolha **Connect with customers through WhatsApp** (conectar com clientes pelo WhatsApp).
5. Vincule o app ao **portfólio de negócios** FitPoint.
6. Conclua a criação.

Se o assistente for o modelo antigo: crie um app do tipo **Business** e, no painel do app, em **Adicionar produto**, clique em **Configurar** em **WhatsApp**.

---

## Passo 3 — Conta WhatsApp Business (WABA) e número

1. No app, abra **WhatsApp** → **Configuração da API** (API Setup) ou **Começar a usar a API**.
2. Conecte uma **WhatsApp Business Account (WABA)** existente ou crie uma nova para o FitPoint.
3. Na mesma tela você verá:
   - um número de **teste** da Meta (`+1 555 …`), útil só para sandbox;
   - o **Phone number ID** (salve: vai para `WHATSAPP_PHONE_NUMBER_ID`);
   - o **WhatsApp Business Account ID** (guarde; não entra no `.env` do FitPoint).
4. Gere um **token temporário** e envie a mensagem de teste (`hello_world`) para o seu celular (adicione o número como destinatário de teste, se a Meta pedir).

O token desta tela **expira em cerca de 24 horas**. Não use em produção. Vá ao passo 5.

### Número real (produção)

1. Em **WhatsApp** → **Números de telefone** (Phone numbers), clique em **Adicionar número**.
2. Informe o DDI + DDD + número (Brasil: `55` + DDD + número).
3. Valide por **SMS** ou **voz**.
4. Defina o **nome de exibição** (FitPoint). A Meta pode pedir verificação da empresa.
5. Copie o **Phone number ID** do número **de produção** (não o de teste) para o `.env`.

Se o número já estiver no app WhatsApp Business, você precisará **migrá-lo** ou usar outro. Depois da Cloud API, **não reinstale** o app nesse chip.

---

## Passo 4 — Template `reativacao_ausente`

1. Abra o [WhatsApp Manager](https://business.facebook.com/latest/whatsapp_manager) (ou, no app: WhatsApp → **Gerenciador de contas** → **Modelos de mensagem**).
2. **Criar modelo**.
3. Preencha:

| Campo | Valor recomendado |
|-------|-------------------|
| Nome | `reativacao_ausente` (minúsculas, sem espaço; tem que bater com `WHATSAPP_TEMPLATE_NAME`) |
| Categoria | **Marketing** |
| Idioma | **Portuguese (BR)** → código `pt_BR` (tem que bater com `WHATSAPP_TEMPLATE_LANG`) |
| Cabeçalho | Nenhum (mais simples na aprovação) |
| Rodapé | Opcional |
| Botões | Nenhum no início |

4. **Corpo** (exemplo; as variáveis **precisam ser `{{1}}` e `{{2}}` nesta ordem**):

```text
Olá {{1}}, sentimos sua falta no FitPoint! Já faz {{2}} dias que não te vemos. Que tal voltar hoje?
```

Na pré-visualização da Meta:

- `{{1}}` = nome (ex.: Maria)
- `{{2}}` = número de dias (ex.: 5)

5. Envie para análise. Costuma levar de minutos a **1–2 dias úteis**.
6. Só use no FitPoint quando o status estiver **Aprovado** (Approved).

Se a Meta rejeitar: evite CAPS, links enganosos, “ganhe prêmio agora”, emojis excessivos. Reenvie uma versão mais neutra.

---

## Passo 5 — Token permanente (usuário de sistema)

O token do painel “API Setup” **não serve** para o servidor ficar ligado o dia todo.

1. Abra [Configurações do Business](https://business.facebook.com/settings) → **Usuários** → **Usuários do sistema**.
2. **Adicionar** → nome `fitpoint-whatsapp` → função **Admin**.
3. No usuário criado: **Atribuir ativos**:
   - o **app** FitPoint WhatsApp — controle total;
   - a **conta WhatsApp** (WABA) — controle total.
4. **Gerar novo token**:
   - selecione o app;
   - validade: **nunca expira** (ou o máximo permitido);
   - permissões:
     - `whatsapp_business_messaging`
     - `whatsapp_business_management`
     - `business_management` (se aparecer na lista)
5. **Copie o token na hora** (a Meta mostra uma vez) e cole em `WHATSAPP_TOKEN`.

Trate o token como senha. Não commite o `.env`.

---

## Passo 6 — Colar no FitPoint e testar

1. Preencha as quatro variáveis no `.env` (produção ou local).
2. Reinicie: `npm start` ou `npm run dev`.
3. Entre em `admin.html` → **Fidelidade**.
4. No card **WhatsApp — clientes ausentes**:
   - se aparecer “não configurado”, o servidor não leu o `.env` (reinicie; confira nomes das variáveis);
   - se aparecer “0 clientes ausentes”, use um cadastro de teste com última visita há mais de 3 dias.
5. Clique em **Enviar WhatsApp aos ausentes**, confirme e veja o toast (enviados / falhas / pulados).

**Cooldown:** o sistema não reenvia para o mesmo cliente com sucesso nos **7 dias** seguintes.

**Telefone no cadastro:** DDD + número (10 ou 11 dígitos). O FitPoint prefixa `55` sozinho.

---

## Passo 7 — Produção (checklist)

- [ ] Número de produção (não o `+1 555` de teste)
- [ ] Token de **usuário de sistema** (não o token de 24 h)
- [ ] Template `reativacao_ausente` **aprovado** em `pt_BR`
- [ ] Nome e idioma no `.env` iguais aos da Meta
- [ ] Método de pagamento no Business Manager
- [ ] Nome de exibição do WhatsApp aprovado
- [ ] App Meta em modo adequado para entregar mensagens (em desenvolvimento, só destinatários de teste recebem)
- [ ] Servidor reiniciado após alterar o `.env`
- [ ] Teste com **1** cliente ausente antes do lote real

Para o app sair do modo desenvolvimento: painel do app → **Publicar** / requisitos de verificação que a Meta pedir (política de privacidade, etc.).

---

## Problemas comuns

| Sintoma | Causa típica |
|---------|----------------|
| Botão desabilitado, texto “não configurado” | `.env` vazio ou servidor sem restart |
| Erro 401 da Graph API | Token expirado (usou o temporário) ou usuário de sistema sem o ativo WABA |
| Template não existe / não encontrado | Nome diferente (`Reativacao_Ausente` ≠ `reativacao_ausente`) ou idioma `pt_BR` vs `pt` |
| `(#132001) Template name does not exist in the translation` | Idioma do envio ≠ idioma aprovado |
| Mensagem não chega | Destinatário não está na lista de teste (app em Development); ou número ainda é o de sandbox |
| `(#131030)` / número não registrado | Phone Number ID errado ou número não registrado na Cloud API |
| Cobrança / limite | Sem cartão no Business; cota de teste esgotada |
| Cliente “pulado” | Telefone inválido ou já recebeu há menos de 7 dias |

Logs: o admin mostra a mensagem de erro da Meta no toast quando há falha. O histórico fica na tabela `loyalty_whatsapp_messages`.

---

## O que este guia não cobre

- Webhook de status (entregue / lido) — o FitPoint hoje só registra o aceite da API (`sent` / `failed`)
- Envio automático por cron (só o botão no admin)
- Z-API, Evolution ou WhatsApp Web não oficiais

---

## Links úteis

- [Começar — Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/)
- [Modelos de mensagem](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates)
- [Preços](https://developers.facebook.com/docs/whatsapp/pricing)
- [WhatsApp Manager](https://business.facebook.com/latest/whatsapp_manager)
- [Usuários do sistema](https://business.facebook.com/settings/system-users)
