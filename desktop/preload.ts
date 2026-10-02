import { contextBridge, ipcRenderer } from "electron";
import type { AppRequest, Bridge } from "../shared/contracts/app";
const bridge: Bridge = {
  request: async (request: AppRequest) => {
    try {
      return await ipcRenderer.invoke("eve:request", request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message.replace(
          /^Error invoking remote method 'eve:request': (?:Error: )?/,
          "",
        ),
        { cause: error },
      );
    }
  },
};
contextBridge.exposeInMainWorld("eve", Object.freeze(bridge));
