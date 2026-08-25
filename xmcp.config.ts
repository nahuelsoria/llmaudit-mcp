import { type XmcpConfig } from "xmcp";

const config: XmcpConfig = {
  http: true,
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
    name: "llmaudit",
    description:
      "Measure whether a brand actually shows up when buyers ask AI assistants for a recommendation. Free, no signup.",
    icons: [{ src: "./xmcp.svg" }],
  }
};

export default config;
