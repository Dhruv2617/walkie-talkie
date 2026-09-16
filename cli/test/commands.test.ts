import { beforeEach, describe, expect, it, vi } from "vitest";
import * as relayClient from "../src/relayClient";
import * as config from "../src/config";
import { runInit } from "../src/commands/init";
import { runJoin } from "../src/commands/join";
import { runShare } from "../src/commands/share";
import { runAsk } from "../src/commands/ask";

vi.mock("../src/relayClient");
vi.mock("../src/config");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runInit", () => {
  it("creates a channel and returns an invite code", async () => {
    vi.mocked(relayClient.createChannel).mockResolvedValue({ channelId: "abc", secret: "shh" });

    const code = await runInit();

    expect(code.startsWith("WT-")).toBe(true);
  });
});

describe("runJoin", () => {
  it("joins the role, saves config, and pulls unread messages", async () => {
    vi.mocked(config.readLastSeenId).mockReturnValue(3);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([
      { id: 4, from: "backend", ts: 1, type: "fyi", text: "hi", reply_to: null },
    ]);

    const { messages } = await runJoin("WT-eyJjaGFubmVsSWQiOiJhYmMiLCJzZWNyZXQiOiJzaGgifQ", "frontend");

    expect(relayClient.joinChannel).toHaveBeenCalledWith("abc", "shh", "frontend");
    expect(config.writeConfig).toHaveBeenCalledWith({ channelId: "abc", secret: "shh", role: "frontend" });
    expect(relayClient.pullMessages).toHaveBeenCalledWith("abc", "shh", 3);
    expect(config.writeLastSeenId).toHaveBeenCalledWith("abc", 4);
    expect(messages).toHaveLength(1);
  });

  it("does not advance the marker when there are no unread messages", async () => {
    vi.mocked(config.readLastSeenId).mockReturnValue(3);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([]);

    const { messages } = await runJoin("WT-eyJjaGFubmVsSWQiOiJhYmMiLCJzZWNyZXQiOiJzaGgifQ", "frontend");

    expect(config.writeLastSeenId).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it("rejects with a clear error for a malformed invite code", async () => {
    await expect(runJoin("not-a-valid-code", "frontend")).rejects.toThrow("invalid invite code");

    expect(relayClient.joinChannel).not.toHaveBeenCalled();
    expect(config.writeConfig).not.toHaveBeenCalled();
  });
});

describe("runShare", () => {
  it("pushes an fyi message using the saved config", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", role: "backend" });
    vi.mocked(relayClient.pushMessage).mockResolvedValue(9);

    const id = await runShare("qty is integer only");

    expect(relayClient.pushMessage).toHaveBeenCalledWith("abc", "shh", {
      from: "backend",
      type: "fyi",
      text: "qty is integer only",
    });
    expect(id).toBe(9);
  });

  it("pushes an answer message with reply_to when replyTo is given", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", role: "backend" });
    vi.mocked(relayClient.pushMessage).mockResolvedValue(102);

    const id = await runShare("integer only", { replyTo: 101 });

    expect(relayClient.pushMessage).toHaveBeenCalledWith("abc", "shh", {
      from: "backend",
      type: "answer",
      text: "integer only",
      reply_to: 101,
    });
    expect(id).toBe(102);
  });
});

describe("runAsk", () => {
  it("returns an offline fallback without polling when the other role is not present", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", role: "frontend" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(false);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);

    const answer = await runAsk("does qty accept decimals?");

    expect(relayClient.pushMessage).toHaveBeenCalledWith("abc", "shh", {
      from: "frontend",
      type: "question",
      text: "does qty accept decimals?",
    });
    expect(answer).toBe("no one online — proceeding with an assumption, flagged for follow-up");
  });

  it("polls until a reply_to match arrives when the other role is online", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", role: "frontend" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);
    vi.mocked(relayClient.pullMessages)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 102, from: "backend", ts: 1, type: "answer", text: "integer only", reply_to: 101 },
      ]);

    const answer = await runAsk("does qty accept decimals?", { pollIntervalMs: 1, timeoutMs: 1000 });

    expect(answer).toBe("integer only");
  });

  it("falls back to a timeout message if no reply arrives in time", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", role: "frontend" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([]);

    const answer = await runAsk("does qty accept decimals?", { pollIntervalMs: 1, timeoutMs: 5 });

    expect(answer).toBe("no answer yet — proceeding with an assumption, flagged for follow-up");
  });
});
