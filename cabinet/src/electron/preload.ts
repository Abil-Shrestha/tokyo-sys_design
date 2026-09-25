import { contextBridge, ipcRenderer } from "electron";

const version = process.argv.find((a) => a.startsWith("--cabinet-version="))?.split("=")[1] ?? "";

contextBridge.exposeInMainWorld("cabinetDesktop", {
  platform: process.platform,
  version,
  onCommand(callback: (command: string) => void): () => void {
    const listener = (_e: unknown, command: string) => callback(command);
    ipcRenderer.on("cabinet:command", listener);
    return () => ipcRenderer.removeListener("cabinet:command", listener);
  },
  chooseLibrary(): Promise<string | null> {
    return ipcRenderer.invoke("cabinet:choose-library");
  },
});
