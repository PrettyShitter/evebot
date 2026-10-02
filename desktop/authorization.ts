import { createServer } from "node:http";
import { shell } from "electron";
import { SsoClient, SCOPES, CALLBACK } from "../engine/auth/tokens";
let active = false;
export async function authorize(clientId: string, seller: boolean) {
  if (active) throw Error("Вход уже открыт в браузере");
  if (!clientId.trim()) throw Error("Сначала сохраните Client ID");
  active = true;
  try {
    const client = new SsoClient(clientId);
    const attempt = await client.authorization(
      seller ? SCOPES.seller : SCOPES.buyer,
    );
    return await new Promise<Awaited<ReturnType<SsoClient["code"]>>>(
      (resolve, reject) => {
        let consumed = false;
        const server = createServer(async (req, res) => {
          const url = new URL(req.url ?? "/", CALLBACK);
          if (req.method !== "GET" || url.pathname !== "/callback") {
            res.writeHead(404).end();
            return;
          }
          if (
            consumed ||
            url.searchParams.get("state") !== attempt.state ||
            Date.now() > attempt.expiresAt
          ) {
            res.writeHead(400).end("Invalid or expired state");
            return;
          }
          consumed = true;
          const code = url.searchParams.get("code");
          clearTimeout(timer);
          server.close();
          if (!code) {
            res.writeHead(400).end("Authorization cancelled");
            reject(Error("Авторизация отменена"));
            return;
          }
          try {
            const record = await client.code(code, attempt.verifier);
            const wanted = seller ? SCOPES.seller : SCOPES.buyer;
            if (wanted.some((s) => !record.scopes.includes(s)))
              throw Error("Не предоставлены нужные scopes");
            res
              .writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
              })
              .end("Персонаж подключён. Вернитесь в EVE Trader.");
            resolve(record);
          } catch {
            res.writeHead(400).end("Authorization failed");
            reject(Error("Не удалось подтвердить авторизацию EVE"));
          }
        });
        const timer = setTimeout(() => {
          server.close();
          reject(Error("Время авторизации истекло"));
        }, 300000);
        server.on("error", () => {
          clearTimeout(timer);
          reject(
            Error(
              "Callback порт 43827 занят. Закройте другое окно входа и повторите.",
            ),
          );
        });
        server.listen(43827, "localhost", () => {
          void shell.openExternal(attempt.url).catch(() => {
            clearTimeout(timer);
            server.close();
            reject(Error("Не удалось открыть браузер"));
          });
        });
      },
    );
  } finally {
    active = false;
  }
}
