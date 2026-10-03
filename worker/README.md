# Radar ML API

Backend seguro para o fluxo de busca, cadastro e coleta de produtos do Radar ML.

## O que ele faz

- `GET /health`: valida de verdade o acesso ao Mercado Livre e a leitura do GitHub; não apenas a existência dos secrets.
- `GET /search?q=...`: pesquisa o catálogo do Mercado Livre e devolve variantes, atributos e imagens.
- `GET /product/:id`: lê um produto específico do catálogo em formato normalizado para o painel.
- `GET /catalog/:id`: devolve o produto bruto do catálogo para a coleta automatizada.
- `GET /offers/:id`: devolve as ofertas reais do produto para a coleta automatizada.
- `GET /seller/:id`: devolve os dados do vendedor para a coleta automatizada.
- `POST /watchlist`: grava o produto escolhido em `data/watchlist.json`, incluindo capa, galeria e política de origem.
- `DELETE /watchlist/:id`: remove um produto da watchlist.

Todas as rotas, exceto `/health`, exigem o header `x-admin-key`.

## Segredos do Worker

Configure no Cloudflare Worker, sem versionar os valores:

- `ADMIN_KEY`: chave privada usada pelo navegador do proprietário do radar e pela Action de coleta.
- `ML_ACCESS_TOKEN`: token atual; permanece como fallback durante a migração.
- `ML_CLIENT_ID`: Client ID/App ID da aplicação Mercado Livre.
- `ML_CLIENT_SECRET`: Client Secret da aplicação Mercado Livre.
- `ML_REFRESH_TOKEN`: Refresh Token inicial com `offline_access`; ele é usado apenas para semear a rotação.
- `GITHUB_TOKEN`: fine-grained token com acesso somente ao repositório `valmiroliveirajr/radar-garmin` e permissão **Contents: Read and write**.

## KV para rotação dos tokens

Crie um namespace Cloudflare KV e vincule-o ao Worker com o nome de binding:

`ML_TOKEN_STORE`

O Worker usa o KV para guardar, de forma mutável:

- `access_token`
- `access_token_expires_at`
- `refresh_token`

Quando o access token expira, o Worker usa o último refresh token, recebe um novo par de tokens do Mercado Livre e grava o novo refresh token no KV. Isso é necessário porque o refresh token do Mercado Livre é de uso único e muda a cada renovação.

Sem o binding `ML_TOKEN_STORE`, o Worker continua funcionando com `ML_ACCESS_TOKEN`, mas volta a depender do token estático de curta duração.

## Variáveis não secretas

As variáveis abaixo já estão em `wrangler.toml`:

- `ALLOWED_ORIGIN=https://valmiroliveirajr.github.io`
- `GITHUB_REPOSITORY=valmiroliveirajr/radar-garmin`
- `ML_SITE_ID=MLB`

## GitHub Action

A Action de coleta usa o Worker quando o secret abaixo existir no repositório:

- `RADAR_API_ADMIN_KEY`: deve ser exatamente a mesma chave configurada como `ADMIN_KEY` no Worker.

A URL pública do Worker já está configurada na Action:

`https://radar-ml-api.valmirvalray.workers.dev`

Se `RADAR_API_ADMIN_KEY` ainda não existir, o coletor mantém o fallback para `ML_ACCESS_TOKEN` para não interromper a operação durante a migração.

## Publicação

Há um workflow manual em `.github/workflows/deploy-worker.yml`. Para usá-lo, configure no GitHub:

- secret `CLOUDFLARE_API_TOKEN`
- secret `CLOUDFLARE_ACCOUNT_ID`

Depois execute **Actions → Deploy Radar ML API → Run workflow**.

A URL pública atual é:

`https://radar-ml-api.valmirvalray.workers.dev`

Ela também está gravada em `data/config.json`, portanto o painel já encontra o backend automaticamente. A `ADMIN_KEY` continua somente no navegador do proprietário.

## Fluxo final

1. Digitar o produto na busca do Radar ML.
2. Escolher a variante correta no catálogo.
3. Escolher a imagem de capa e as imagens da galeria.
4. Escolher `Nacional + internacional` ou `Somente compra nacional`.
5. Clicar em **Adicionar ao Radar**.
6. O Worker atualiza `data/watchlist.json`.
7. O push dispara automaticamente a Action `Coleta diaria Radar de Precos`.
8. A Action consulta catálogo, ofertas e vendedores através do Worker autenticado.
9. O front-end consulta `data/latest.json` até aparecer a primeira coleta do novo produto.
10. Com `ML_TOKEN_STORE` + `offline_access`, o token Mercado Livre é renovado automaticamente sem intervenção manual.
