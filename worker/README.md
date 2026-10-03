# Radar ML API

Backend seguro para o fluxo de busca e cadastro de produtos do Radar ML.

## O que ele faz

- `GET /health`: valida se o Worker está ativo.
- `GET /search?q=...`: pesquisa o catálogo do Mercado Livre e devolve variantes, atributos e imagens.
- `GET /product/:id`: lê um produto específico do catálogo.
- `POST /watchlist`: grava o produto escolhido em `data/watchlist.json`, incluindo capa, galeria e política de origem.
- `DELETE /watchlist/:id`: remove um produto da watchlist.

As rotas administrativas exigem o header `x-admin-key`.

## Segredos do Worker

Configure no Cloudflare Worker, sem versionar os valores:

- `ADMIN_KEY`: chave privada usada pelo navegador do proprietário do radar.
- `ML_ACCESS_TOKEN`: access token OAuth do Mercado Livre.
- `GITHUB_TOKEN`: fine-grained token com acesso somente ao repositório `valmiroliveirajr/radar-garmin` e permissão **Contents: Read and write**.

As variáveis não secretas já estão em `wrangler.toml`:

- `ALLOWED_ORIGIN=https://valmiroliveirajr.github.io`
- `GITHUB_REPOSITORY=valmiroliveirajr/radar-garmin`
- `ML_SITE_ID=MLB`

## Publicação

Há um workflow manual em `.github/workflows/deploy-worker.yml`. Para usá-lo, configure no GitHub:

- secret `CLOUDFLARE_API_TOKEN`
- secret `CLOUDFLARE_ACCOUNT_ID`

Depois execute **Actions → Deploy Radar ML API → Run workflow**.

Após a publicação, copie a URL `https://<worker>.workers.dev` e informe no botão **Configurar API** do Radar ML. A URL e a `ADMIN_KEY` ficam apenas no `localStorage` do navegador. Opcionalmente, a URL pública do Worker pode ser gravada em `data/config.json` no campo `admin_api`.

## Fluxo final

1. Digitar o produto na busca do Radar ML.
2. Escolher a variante correta no catálogo.
3. Escolher a imagem de capa e as imagens da galeria.
4. Escolher `Nacional + internacional` ou `Somente compra nacional`.
5. Clicar em **Adicionar ao Radar**.
6. O Worker atualiza `data/watchlist.json`.
7. O push dispara automaticamente a Action `Coleta diaria Radar de Precos`.
8. O front-end consulta `data/latest.json` até aparecer a primeira coleta do novo produto.
