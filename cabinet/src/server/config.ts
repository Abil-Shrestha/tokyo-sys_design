import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Settings that belong to this device rather than to the library: where the
 * library lives, the local API token, and secrets such as the AI key. These
 * never go into the library folder, so they are not synced or shared.
 */
export interface DeviceConfig {
  deviceId: string;
  token: string;
  libraryPath: string;
  port: number;
  aiKey?: string;
}

export const DEFAULT_PORT = 47600;

export function defaultConfigDir(): string {
  if (process.env.CABINET_CONFIG_DIR) return process.env.CABINET_CONFIG_DIR;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Cabinet");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? os.homedir(), "Cabinet");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "cabinet");
}

export function defaultLibraryPath(): string {
  return path.join(os.homedir(), "Cabinet Library");
}

export class ConfigStore {
  readonly file: string;
  private data: DeviceConfig;

  constructor(dir = defaultConfigDir()) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "config.json");
    let stored: Partial<DeviceConfig> = {};
    if (existsSync(this.file)) {
      try {
        stored = JSON.parse(readFileSync(this.file, "utf8"));
      } catch {
        stored = {};
      }
    }
    this.data = {
      deviceId: stored.deviceId ?? randomBytes(6).toString("hex"),
      token: stored.token ?? randomBytes(24).toString("base64url"),
      libraryPath: stored.libraryPath ?? defaultLibraryPath(),
      port: stored.port ?? DEFAULT_PORT,
      aiKey: stored.aiKey,
    };
    this.save();
  }

  get(): DeviceConfig {
    return { ...this.data };
  }

  update(patch: Partial<DeviceConfig>): DeviceConfig {
    this.data = { ...this.data, ...patch };
    this.save();
    return this.get();
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
