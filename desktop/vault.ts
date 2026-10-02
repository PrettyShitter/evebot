import { safeStorage } from "electron";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Vault, TokenRecord } from "../engine/auth/tokens";
export class SecureVault implements Vault {
  constructor(private directory: string) {}
  private path(id: string) {
    if (!/^\d+$/.test(id)) throw Error("Invalid character ID");
    return join(this.directory, id + ".enc");
  }
  async read(id: string) {
    try {
      return JSON.parse(
        (await safeStorage.decryptStringAsync(await readFile(this.path(id))))
          .result,
      ) as TokenRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw Error(
        "Не удалось открыть токен в хранилище ОС. Подключите персонажа повторно.",
        { cause: error },
      );
    }
  }
  async write(record: TokenRecord) {
    if (!(await safeStorage.isAsyncEncryptionAvailable()))
      throw Error("Безопасное хранилище ОС недоступно");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(record.characterId);
    await writeFile(
      path + ".tmp",
      await safeStorage.encryptStringAsync(JSON.stringify(record)),
      { mode: 0o600 },
    );
    await rename(path + ".tmp", path);
  }
  async remove(id: string) {
    await unlink(this.path(id)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
