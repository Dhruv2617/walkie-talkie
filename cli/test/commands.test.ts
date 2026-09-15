import { beforeEach, describe, expect, it, vi } from "vitest";
import * as relayClient from "../src/relayClient";
import * as config from "../src/config";
import { runInit } from "../src/commands/init";
import { runJoin } from "../src/commands/join";

vi.mock("../src/relayClient");
vi.mock("../src/config");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runInit", () => {
  it("creates a channel and returns an invite code", async () => {
    vi.mocked(relayClient.createChannel).mockResolvedValue({ channelId: "abc", secret: "shh" });

    const code = await runInit();

    expect(code.startsWith("CTXR-")).toBe(true);
  });
});

describe("runJoin", () => {
  it("joins the role, saves config, and pulls unread messages", async () => {
    vi.mocked(config.readLastSeenId).mockReturnValue(3);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([
      { id: 4, from: "backend", ts: 1, type: "fyi", text: "hi", reply_to: null },
    ]);

    const { messages } = await runJoin("CTXR-eyJjaGFubmVsSWQiOiJhYmMiLCJzZWNyZXQiOiJzaGgifQ", "frontend");

    expect(relayClient.joinChannel).toHaveBeenCalledWith("abc", "shh", "frontend");
    expect(config.writeConfig).toHaveBeenCalledWith({ channelId: "abc", secret: "shh", role: "frontend" });
    expect(relayClient.pullMessages).toHaveBeenCalledWith("abc", 3);
    expect(config.writeLastSeenId).toHaveBeenCalledWith("abc", 4);
    expect(messages).toHaveLength(1);
  });

  it("does not advance the marker when there are no unread messages", async () => {
    vi.mocked(config.readLastSeenId).mockReturnValue(3);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([]);

    const { messages } = await runJoin("CTXR-eyJjaGFubmVsSWQiOiJhYmMiLCJzZWNyZXQiOiJzaGgifQ", "frontend");

    expect(config.writeLastSeenId).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it("rejects with a clear error for a malformed invite code", async () => {
    await expect(runJoin("not-a-valid-code", "frontend")).rejects.toThrow("invalid invite code");

    expect(relayClient.joinChannel).not.toHaveBeenCalled();
    expect(config.writeConfig).not.toHaveBeenCalled();
  });
});
