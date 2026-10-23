# Logs da análise de imagem (OCR)

Fluxos: lista do Diário (`POST /api/daily-sales/parse-list`, `flow: "diario"`) e ficha de cliente
(`POST /api/loyalty/customers/parse-image`, `flow: "cliente"`).

Cada evento é uma linha `[OCR] {json}` nos logs do servidor (Render → Logs). Filtre por `[OCR]`
e, para seguir uma análise do início ao fim, pelo valor de `"req"`.

| step | O que mostra |
|------|--------------|
| `request.start` | usuário, rota, tamanho da requisição, navegador |
| `upload.received` | nome, mimetype e bytes recebidos + `client` (o que o celular fez antes de enviar) |
| `upload.rejected` | upload recusado (ex.: `LIMIT_FILE_SIZE`, sem arquivo) |
| `image.normalized` | formato real detectado (`jpeg`, `heic`, `dng`…), se converteu, dimensões da prévia RAW |
| `image.rejected` | formato não suportado + primeiros bytes do arquivo (`firstBytes`) |
| `gemini.request` / `gemini.response` | modelo, bytes, tempo (`gemMs`), `finishReason`, tokens |
| `gemini.model_unavailable` | modelo aposentado/restrito para a chave; mostra o próximo modelo tentado (`nextModel`) |
| `gemini.config_rejected` | API recusou raciocínio/resolução; repetiu sem eles (e não usa mais nesse modelo) |
| `gemini.skip_unavailable` | modelos pulados por já terem falhado neste processo |
| `gemini.failed` / `gemini.network_error` | erro da API do Gemini (status e mensagem) |
| `vision.invalid_json` | resposta do Gemini que não virou JSON (trecho em `snippet`) |
| `vision.parsed` | datas e quantidade de linhas lidas por seção |
| `match.done` | quantos produtos/clientes casaram (`matched`/`ambiguous`/`missing`) |
| `request.done` / `request.failed` / `request.error` | resultado final |

## Campo `client` (preparação no celular)

| `action` | Significado |
|----------|-------------|
| `original` | foto já pequena (JPG/PNG/WebP ≤ 1,5 MB), enviada como está |
| `converted` | reduzida para no máx. 1600 px e convertida em JPEG (ex.: HEIC, fotos grandes) |
| `original-undecodable` | o navegador não abriu (ex.: RAW/DNG); o servidor extrai o JPEG embutido |
| `original-convert-failed` | falha ao converter; enviada como está (`convertError`) |

## Formatos aceitos

JPG, PNG, WebP, GIF, HEIC/HEIF e RAW baseado em TIFF (DNG do iPhone ProRAW). Do RAW é usado o
JPEG de prévia embutido no arquivo. Limite de upload: 100 MB.

## Modelo do Gemini

- `GEMINI_MODEL` (padrão `gemini-3.5-flash-lite`).
- `GEMINI_FALLBACK_MODELS`: reservas separadas por vírgula (padrão `gemini-3.8-flash`; `none` desativa).
- Os modelos 2.x foram desligados ou restritos pelo Google a projetos que já os usavam. Se o principal
  responder "no longer available", o servidor tenta o próximo e registra `gemini.model_unavailable`.

## Desempenho

- `GEMINI_THINKING_LEVEL`: `minimal` (padrão no Flash-Lite/3.6), `low` (padrão no 3.8 Flash, que não aceita minimal), `medium`, `high` ou `off`.
- `GEMINI_MEDIA_RESOLUTION`: `low` (280 tokens), `medium` (padrão, 560), `high` (1120) ou `off`. Se a leitura da letra piorar, use `high`.
- Resposta com formato fixo (`responseSchema`) e chaves curtas; catálogo do banco carregado em paralelo com o Gemini.
- Compare `gemMs` em `gemini.response` antes/depois de mudar essas variáveis.
