import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as config from "../src/config";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ctx-relay-test-"));
  config.setConfigDirForTests(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("config", () => {
  it("returns null when no config written yet", () => {
    expect(config.readConfig()).toBeNull();
  });

  it("writes and reads back the config", () => {
    config.writeConfig({ channelId: "abc123", secret: "shh", slot: "a" });
    expect(config.readConfig()).toEqual({ channelId: "abc123", secret: "shh", slot: "a" });
  });

  it("tracks last_seen_id per channel, defaulting to 0", () => {
    expect(config.readLastSeenId("abc123")).toBe(0);
    config.writeLastSeenId("abc123", 7);
    expect(config.readLastSeenId("abc123")).toBe(7);
  });
});
