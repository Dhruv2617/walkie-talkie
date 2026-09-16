import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Config {
  channelId: string;
  secret: string;
  slot: "a" | "b";
}

let configDir = join(homedir(), ".ctx-relay");

export function setConfigDirForTests(dir: string) {
  configDir = dir;
}

function ensureDir() {
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
}

function configPath() {
  return join(configDir, "config.json");
}

function markerPath(channelId: string) {
  return join(configDir, `last_seen_${channelId}.json`);
}

export function readConfig(): Config | null {
  if (!existsSync(configPath())) return null;
  return JSON.parse(readFileSync(configPath(), "utf8")) as Config;
}

export function writeConfig(cfg: Config): void {
  ensureDir();
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

export function readLastSeenId(channelId: string): number {
  const path = markerPath(channelId);
  if (!existsSync(path)) return 0;
  return (JSON.parse(readFileSync(path, "utf8")) as { id: number }).id;
}

export function writeLastSeenId(channelId: string, id: number): void {
  ensureDir();
  writeFileSync(markerPath(channelId), JSON.stringify({ id }));
}
