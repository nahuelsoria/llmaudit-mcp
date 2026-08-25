# llmaudit MCP

Servidor MCP HTTP construido con TypeScript y xmcp.

Expone `start_visibility_check`, `get_visibility_check` y el recurso `llmaudit://methodology`.

## Desarrollo

```sh
npm install
npm test
npx tsc --noEmit
npm run build
npm start
```

Las pruebas usan solamente los fixtures guardados en el directorio superior. No llaman a llmaudit ni a proveedores de modelos.

La URL local del transporte es `http://127.0.0.1:3001/mcp`.

## Configuracion

`LLMAUDIT_API_BASE_URL` define la base HTTP que usa el cliente real. Si no se configura, usa `https://llmaudit.app`.

No ejecutes las tools contra el cliente real durante las pruebas. El servicio permite inyectar un cliente que devuelve fixtures.
