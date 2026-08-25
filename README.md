# llmaudit-mcp

Servidor MCP de [llmaudit.app](https://llmaudit.app). Deja que el asistente de
cualquier persona mida si una marca aparece cuando los compradores le piden una
recomendacion a una IA.

Spec completa: `specs/features/geo-13-mcp-server.md` en el repo privado
llm-rank-tracker.

## Lo que expone

- `start_visibility_check` arranca la medicion y devuelve un `runId`.
- `get_visibility_check` la cobra. Devuelve `running` hasta que los proveedores
  contestan.
- `llmaudit://methodology` explica como se mide.

Son dos tools y no una porque la medicion tarda hasta dos minutos: el audit son
15 a 60s y el mapa medido otro tanto.

## Lo que devuelve, y lo que NO

Devuelve el **mapa medido**: las preguntas del comprador consultadas en vivo y
quien se llevo cada respuesta. Nunca el autoreporte de los proveedores, que es
lo que cada modelo CREE de la marca. Los dos numeros se separan muchisimo en la
practica, y el autoreporte siempre es el optimista: por eso el contrato de la
tool no lo expone en ningun campo.

Nunca devuelve un puntaje 0-100: veredicto en tres bandas y conteos.

## Plata

Cada medicion gratis gasta las API keys de llmaudit, del orden de USD 0,05 a
0,15. Tres guardas, todas verificadas por tests:

1. Una medicion gratis por dominio cada 30 dias, chequeada ANTES de llamar a la API.
2. `MCP_MONTHLY_RUN_LIMIT` (default 200) como techo del canal, separado del
   presupuesto del funnel web.
3. El conteo de rate limit en prod va por identidad de cliente, no por la IP de
   este servidor, que en serverless rota.

## Env

| Variable | Para que |
| --- | --- |
| `LLMAUDIT_API_BASE_URL` | Base de la API. Default `https://llmaudit.app` |
| `MCP_SERVER_KEY` | Llave compartida con llm-rank-tracker. Sin ella prod bucketea por IP |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Tabla `mcp_runs`. Sin ellas el store es en memoria y NO sirve en serverless |
| `MCP_MONTHLY_RUN_LIMIT` | Techo mensual de corridas del canal |

## Uso del canal

`npm run stats` lee `mcp_runs` y dice cuanto queda del techo del mes, quien
llamo, que dominios se midieron y cual tiene tomada la cuota de 30 dias.

```sh
node --env-file <archivo.env> scripts/stats.mjs
node --env-file <archivo.env> scripts/stats.mjs --days 30 --history 180
```

Necesita `SUPABASE_URL` (o `NEXT_PUBLIC_SUPABASE_URL`) y
`SUPABASE_SERVICE_ROLE_KEY`. `--days` es el detalle diario, `--history` cuanto
pasado trae; el mes en curso siempre entra completo, porque ese numero tiene que
dar igual que el del guard.

Lo primero que imprime, cuando aparece, son las corridas **huerfanas**: filas
reservadas que nunca engancharon su `audit_id`. Le tiran "Unknown runId" al
cliente para siempre y mientras tanto ocupan la cuota gratis de su dominio y
suman al techo del mes. Se borran por `run_id`.

Vercel Web Analytics no sirve para medir esto: mide inyectando un script en el
HTML, y aca no hay HTML ni navegador que lo corra, cada request es un JSON-RPC
de un cliente MCP. Marcaria cero para siempre.

## Desarrollo

```sh
npm run dev     # xmcp dev
npm test        # vitest, sin red
npm run build   # xmcp build
```

Los tests corren contra fixtures reales en `fixtures/` (corridas ya pagadas de
la prospeccion). Ninguno sale a la red ni llama a un proveedor.
