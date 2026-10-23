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
| `gemini.failed` / `gemini.network_error` | erro da API do Gemini (status e mensagem) |
| `vision.invalid_json` | resposta do Gemini que não virou JSON (trecho em `snippet`) |
| `vision.parsed` | datas e quantidade de linhas lidas por seção |
| `match.done` | quantos produtos/clientes casaram (`matched`/`ambiguous`/`missing`) |
| `request.done` / `request.failed` / `request.error` | resultado final |

## Campo `client` (preparação no celular)

| `action` | Significado |
|----------|-------------|
| `original` | foto já pequena (JPG/PNG/WebP ≤ 2,5 MB), enviada como está |
| `converted` | reduzida para no máx. 2560 px e convertida em JPEG (ex.: HEIC, fotos grandes) |
| `original-undecodable` | o navegador não abriu (ex.: RAW/DNG); o servidor extrai o JPEG embutido |
| `original-convert-failed` | falha ao converter; enviada como está (`convertError`) |

## Formatos aceitos

JPG, PNG, WebP, GIF, HEIC/HEIF e RAW baseado em TIFF (DNG do iPhone ProRAW). Do RAW é usado o
JPEG de prévia embutido no arquivo. Limite de upload: 100 MB.
