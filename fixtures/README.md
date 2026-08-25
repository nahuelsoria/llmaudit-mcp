# Fixtures

Corridas reales de `llmaudit.app` sobre **dominios propios**, medidas el
25/08/2026. No hay datos de terceros acá: una medicion nombra a la marca y a
sus competidores, y publicar la de alguien que no la pidio no es nuestro.

| Archivo | Que es |
| --- | --- |
| `audit-picaday.json` + `map-picaday.json` | Par real completo, tal cual lo devolvio prod. |
| `map-llmaudit.json` | Mapa real de prod. |
| `audit-llmaudit.json` | Minimo a proposito: esa corrida entro por el servidor MCP, asi que no se guardo la respuesta cruda de `/api/audit`. El mapper solo lee `audit.id`, asi que no se pierde cobertura. |
| `map-proveedor-caido.json` | **Derivado, no es una corrida.** Al mapa de picaday se le fuerzan a error todas las celdas de anthropic. |

El derivado existe porque bajo `GEMINI_MODE=paid_only` una corrida gratis mide
con dos proveedores y ninguno falla, asi que el modo de falla "un proveedor
entero se cayo" ya no se puede capturar midiendo. Cubre dos cosas al mismo
tiempo: que un proveedor caido se nombre, y que con menos de 6 celdas abiertas
respondidas no se invente un veredicto.
