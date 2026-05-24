import type { Plugin } from "@opencode-ai/plugin";
import { ImmutablePrefix, costUsd, Usage } from "reasonix";

export const OpenReasonPlugin: Plugin = async ({ client }) => {
  let prefix: ImmutablePrefix | null = null;
  let prevFingerprint: string | null = null;
  let firstFetch = true;

  return {
    auth: {
      provider: "deepseek",
      methods: [],
      loader: async (_auth, _provider) => ({
        fetch: async (url: string | URL | Request, init?: RequestInit) => {
          const rawBody = typeof init?.body === "string" ? init.body : "{}";
          const body = JSON.parse(rawBody);
          const messages: any[] = body.messages ?? [];
          const toolSpecs: any[] = body.tools ?? [];
          const sysMsg = messages.find((m: any) => m.role === "system");

          if (!prefix) {
            prefix = new ImmutablePrefix({
              system: typeof sysMsg?.content === "string" ? sysMsg.content : "",
              toolSpecs,
            });
          } else {
            const currentSystem = typeof sysMsg?.content === "string" ? sysMsg.content : "";
            if (currentSystem !== prefix.system) {
              prefix.replaceSystem(currentSystem);
              await client.app.log({
                body: {
                  service: "open-reason",
                  level: "info",
                  message: "system prompt changed",
                },
              });
            }

            const currentNames = new Set(toolSpecs.map(t => t.function?.name));
            const prefixNames = new Set(prefix.toolSpecs.map(t => t.function?.name));
            let toolsChanged = false;

            for (const spec of toolSpecs) {
              const name = spec.function?.name;
              if (name && !prefixNames.has(name)) {
                prefix.addTool(spec);
                toolsChanged = true;
              }
            }

            for (const name of prefixNames) {
              if (!currentNames.has(name)) {
                prefix.removeTool(name);
                toolsChanged = true;
              }
            }

            if (toolsChanged) {
              await client.app.log({
                body: {
                  service: "open-reason",
                  level: "info",
                  message: `tools: ${prefixNames.size} -> ${currentNames.size}`,
                },
              });
            }
          }

          const fgp = prefix.fingerprint;
          const cacheStable = prevFingerprint === fgp;
          prevFingerprint = fgp;

          const conversation = messages.filter((m: any) => m.role !== "system");
          const newBody = JSON.stringify({
            ...body,
            messages: [...prefix.toMessages(), ...conversation],
          });

          await client.app.log({
            body: {
              service: "open-reason",
              level: "info",
              message: firstFetch ? `first fetch: ${url}` : `fetch: ${url}`,
              extra: {
                fingerprint: fgp,
                cacheStable,
                tools: toolSpecs.length,
                messages: messages.length,
                sysFs: prefix.toMessages().length,
                conv: conversation.length,
              },
            },
          });
          firstFetch = false;

          const response = await fetch(url, { ...init, body: newBody });

          if (response.body && response.ok) {
            const reader = response.body.getReader();
            let buffer = "";

            const stream = new ReadableStream({
              async start(controller) {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += new TextDecoder().decode(value, { stream: true });
                  controller.enqueue(value);
                }
                controller.close();

                for (const line of buffer.split("\n")) {
                  if (!line.startsWith("data: ")) continue;
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.usage) {
                      const hit = data.usage.prompt_cache_hit_tokens ?? 0;
                      const miss = data.usage.prompt_cache_miss_tokens ?? 0;
                      const total = hit + miss;
                      const ratio = total > 0 ? ((hit / total) * 100).toFixed(1) : "N/A";
                      const usage = Usage.fromApi(data.usage);
                      const cost = costUsd(body.model, usage);

                      await client.app.log({
                        body: {
                          service: "open-reason",
                          level: "info",
                          message: `cache: ${hit} hit / ${miss} miss (${ratio}%)`,
                          extra: {
                            hit,
                            miss,
                            ratio: total > 0 ? parseFloat(ratio) : 0,
                            cost_usd: Math.round(cost * 10000) / 10000,
                            model: body.model,
                          },
                        },
                      });
                    }
                  } catch {}
                }
              },
            });

            return new Response(stream, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }

          return response;
        },
      }),
    },
  };
};
