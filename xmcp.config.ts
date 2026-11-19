import { type XmcpConfig } from "xmcp";

const config: XmcpConfig = {
  // Puerto y host se fijan al BUILD (xmcp evalua este archivo al compilar):
  // en Vercel no importan, y la imagen Docker de los directorios los pone en
  // 0.0.0.0:3001 con ENV antes de `npm run build`, si no el container escucha
  // en loopback y nadie lo alcanza. El default sigue siendo local.
  http: {
    port: Number(process.env.PORT) || 3001,
    host: process.env.HOST || "127.0.0.1",
  },
  paths: {
    tools: "./src/tools",
    // false y no una ruta: no hay prompts, y git no versiona directorios
    // vacios, asi que apuntar a ./src/prompts buildea local y falla en Vercel.
    prompts: false,
    resources: "./src/resources",
  },
  // Lo que ve CUALQUIER cliente que se conecte. El default del scaffold decia
  // "xmcp server" y "bootstrapped with xmcp". Desde el cierre del 29/10/2026 no
  // promete nada gratis: dice lo mismo que la descripcion de
  // start_visibility_check.
  template: {
    name: "askedthrice",
    description:
      "Closed since 2026-10-29: Asked Thrice no longer runs free measurements. get_visibility_check still reads runs started before then. The paid scan is at https://askedthrice.com and needs an account.",
    icons: [{ src: "./xmcp.svg" }],
  }
};

export default config;
