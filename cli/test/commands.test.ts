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
  it("creates a channel, auto-joins as buddy1, saves config, and returns the invite code", async () => {
    vi.mocked(relayClient.createChannel).mockResolvedValue({ channelId: "abc", secret: "shh" });
    vi.mocked(relayClient.joinChannel).mockResolvedValue("buddy1");

    const { code, slot } = await runInit();

    expect(relayClient.joinChannel).toHaveBeenCalledWith("abc", "shh");
    expect(config.writeConfig).toHaveBeenCalledWith({
      channelId: "abc",
      secret: "shh",
      slot: "buddy1",
    });
    expect(slot).toBe("buddy1");
    expect(code.startsWith("WT-")).toBe(true);
  });
});

describe("runJoin", () => {
  it("joins the channel, saves the assigned slot, checks the other slot, and pulls unread messages", async () => {
    vi.mocked(relayClient.joinChannel).mockResolvedValue("buddy2");
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);
    vi.mocked(config.readLastSeenId).mockReturnValue(3);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([
      { id: 4, from: "buddy1", ts: 1, type: "fyi", text: "hi", reply_to: null },
    ]);

    const { slot, otherOnline, messages } = await runJoin(
      "WT-eyJjaGFubmVsSWQiOiJhYmMiLCJzZWNyZXQiOiJzaGgifQ"
    );

    expect(relayClient.joinChannel).toHaveBeenCalledWith("abc", "shh");
    expect(config.writeConfig).toHaveBeenCalledWith({
      channelId: "abc",
      secret: "shh",
      slot: "buddy2",
    });
    expect(relayClient.getPresence).toHaveBeenCalledWith("abc", "shh", "buddy1");
    expect(relayClient.pullMessages).toHaveBeenCalledWith("abc", "shh", 3);
    expect(config.writeLastSeenId).toHaveBeenCalledWith("abc", 4);
    expect(slot).toBe("buddy2");
    expect(otherOnline).toBe(true);
    expect(messages).toHaveLength(1);
  });

  it("reports the other slot as offline when nobody else has joined yet", async () => {
    vi.mocked(relayClient.joinChannel).mockResolvedValue("buddy1");
    vi.mocked(relayClient.getPresence).mockResolvedValue(false);
    vi.mocked(config.readLastSeenId).mockReturnValue(0);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([]);

    const { otherOnline } = await runJoin("WT-eyJjaGFubmVsSWQiOiJhYmMiLCJzZWNyZXQiOiJzaGgifQ");

    expect(relayClient.getPresence).toHaveBeenCalledWith("abc", "shh", "buddy2");
    expect(otherOnline).toBe(false);
  });

  it("does not advance the marker when there are no unread messages", async () => {
    vi.mocked(relayClient.joinChannel).mockResolvedValue("buddy1");
    vi.mocked(relayClient.getPresence).mockResolvedValue(false);
    vi.mocked(config.readLastSeenId).mockReturnValue(3);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([]);

    const { messages } = await runJoin("WT-eyJjaGFubmVsSWQiOiJhYmMiLCJzZWNyZXQiOiJzaGgifQ");

    expect(config.writeLastSeenId).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it("rejects with a clear error for a malformed invite code", async () => {
    await expect(runJoin("not-a-valid-code")).rejects.toThrow("invalid invite code");

    expect(relayClient.joinChannel).not.toHaveBeenCalled();
    expect(config.writeConfig).not.toHaveBeenCalled();
  });
});

describe("runShare", () => {
  it("pushes an fyi message using the saved config and reports the other side's presence", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", slot: "buddy1" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(9);

    const { id, otherSlot, otherOnline } = await runShare("qty is integer only");

    expect(relayClient.getPresence).toHaveBeenCalledWith("abc", "shh", "buddy2");
    expect(relayClient.pushMessage).toHaveBeenCalledWith("abc", "shh", {
      from: "buddy1",
      type: "fyi",
      text: "qty is integer only",
    });
    expect(id).toBe(9);
    expect(otherSlot).toBe("buddy2");
    expect(otherOnline).toBe(true);
  });

  it("reports the other side as offline when they've disconnected", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", slot: "buddy1" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(false);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(9);

    const { otherOnline } = await runShare("qty is integer only");

    expect(otherOnline).toBe(false);
  });

  it("pushes an answer message with reply_to when replyTo is given", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", slot: "buddy1" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(102);

    const { id } = await runShare("integer only", { replyTo: 101 });

    expect(relayClient.pushMessage).toHaveBeenCalledWith("abc", "shh", {
      from: "buddy1",
      type: "answer",
      text: "integer only",
      reply_to: 101,
    });
    expect(id).toBe(102);
  });
});

describe("runAsk", () => {
  it("returns an offline fallback without polling when the other slot is not present", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", slot: "buddy2" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(false);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);

    const answer = await runAsk("does qty accept decimals?");

    expect(relayClient.getPresence).toHaveBeenCalledWith("abc", "shh", "buddy1");
    expect(relayClient.pushMessage).toHaveBeenCalledWith("abc", "shh", {
      from: "buddy2",
      type: "question",
      text: "does qty accept decimals?",
    });
    expect(answer).toBe("no one online — proceeding with an assumption, flagged for follow-up");
  });

  it("polls until a reply_to match arrives when the other slot is online", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", slot: "buddy2" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);
    vi.mocked(relayClient.pullMessages)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 102, from: "buddy1", ts: 1, type: "answer", text: "integer only", reply_to: 101 },
      ]);

    const answer = await runAsk("does qty accept decimals?", { pollIntervalMs: 1, timeoutMs: 1000 });

    expect(answer).toBe("integer only");
  });

  it("falls back to a timeout message if no reply arrives in time", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", slot: "buddy2" });
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([]);

    const answer = await runAsk("does qty accept decimals?", { pollIntervalMs: 1, timeoutMs: 5 });

    expect(answer).toBe("no answer yet — proceeding with an assumption, flagged for follow-up");
  });

  it("exits early with a disconnect message if the other side goes offline mid-poll", async () => {
    vi.mocked(config.readConfig).mockReturnValue({ channelId: "abc", secret: "shh", slot: "buddy2" });
    vi.mocked(relayClient.getPresence)
      .mockResolvedValueOnce(true) // initial check before pushing the question
      .mockResolvedValueOnce(false); // check after the first poll finds no reply yet
    vi.mocked(relayClient.pushMessage).mockResolvedValue(101);
    vi.mocked(relayClient.pullMessages).mockResolvedValue([]);

    const answer = await runAsk("does qty accept decimals?", { pollIntervalMs: 1, timeoutMs: 1000 });

    expect(answer).toBe(
      "the other side disconnected while waiting — proceeding with an assumption, flagged for follow-up"
    );
  });
});
