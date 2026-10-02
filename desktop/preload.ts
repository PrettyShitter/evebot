import { contextBridge, ipcRenderer } from "electron";
import type { AppRequest, Bridge } from "../shared/contracts/app";
const bridge: Bridge = {
  request: (request: AppRequest) => ipcRenderer.invoke("eve:request", request),
};
contextBridge.exposeInMainWorld("eve", Object.freeze(bridge));
