# ai-config-provider

`ai-config` が選んだ `tool_id` を受け取り、local provider bundle 上の実体をロードして返す provider runtime です。Cloud Run では `ai-config` を selector/control plane、`ai-config-provider` を actual loader plane として分離して使います。

## Runtime Flow

1. agent が `ai-config` の `search_tools` / `get_tool_detail` で候補を選ぶ
2. `ai-config-provider` に選ばれた `tool_id` を渡す
3. provider は `AI_CONFIG_SELECTOR_BASE_URL` の `/catalog/tool-detail` か local `.index/records.json` で record を解決する
4. provider bundle にある `source_path` を読み、skill content を返すか、downstream MCP を起動して proxy する

## MCP Surface

- endpoint: `/mcp`
- health: `/healthz`
- readiness: `/readyz`

提供 tool:

- `resolve_selected_tool`
- `read_skill_content`
- `list_loaded_mcp_tools`
- `execute_mcp_tool`
- `npm_manage_dependency`

## Environment Variables

- `AI_CONFIG_PROVIDER_DIR`
  provider bundle root。デフォルトは `./provider-bundle`
- `AI_CONFIG_RECORDS_PATH`
  local fallback 用 records.json。デフォルトは `<provider-root>/.index/records.json`
- `AI_CONFIG_SELECTOR_BASE_URL`
  `ai-config-selector-serving` の base URL。例: `https://ai-config-selector-xxxxx.run.app`
- `AI_CONFIG_SELECTOR_MCP_URL`
  base URL の代わりに `/mcp` endpoint を渡したい場合の互換 env。末尾 `/mcp` は自動で取り除く
- `AI_CONFIG_SELECTOR_TOOL_DETAIL_URL`
  provider 向け detail lookup endpoint override
- `AI_CONFIG_SELECTOR_READY_URL`
  selector readiness endpoint override
- `AI_CONFIG_SELECTOR_BEARER_TOKEN`
  selector 呼び出し時の Bearer token

## Materialize Bundle

Cloud Run image に actual files を含めるため、先に bundle を作ります。

```bash
cd ai-config-provider
npm install
npm run bundle:from-ai-config -- --ai-config-dir ../ai-config --output-dir provider-bundle
```

この script は `../ai-config/.index/records.json` を読み、`source_path` に出てくる file / directory を `provider-bundle/` にそのまま写します。

## Local Run

```bash
cd ai-config-provider
npm install
npm run bundle:from-ai-config -- --ai-config-dir ../ai-config --output-dir provider-bundle
AI_CONFIG_SELECTOR_BASE_URL=http://127.0.0.1:8080 npm start
```

`ai-config` 側は別途:

```bash
cd ../ai-config
PORT=8080 .venv/bin/ai-config-selector-serving --repo-root . --index-dir ./.index
```

## Cloud Run

build:

```bash
docker build -t ai-config-provider:local .
```

deploy:

```bash
gcloud run deploy ai-config-provider \
  --image REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/ai-config-provider:TAG \
  --region REGION \
  --platform managed \
  --port 8080 \
  --set-env-vars AI_CONFIG_PROVIDER_DIR=/app/provider-bundle,AI_CONFIG_SELECTOR_BASE_URL=https://ai-config-selector-xxxxx.run.app
```

Cloud Run readiness は provider bundle の存在と selector 接続状態を見ます。selector が一時的に落ちても local `records.json` があれば fallback できます。
