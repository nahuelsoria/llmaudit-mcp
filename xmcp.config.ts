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
  // "xmcp server" y "bootstrapped with xmcp".
  template: {
    name: "askedthrice",
    description:
      "Measure whether a brand actually shows up when buyers ask AI assistants for a recommendation. Free, no signup.",
    icons: [{ src: "./xmcp.svg" }],
  }
};

export default config;
