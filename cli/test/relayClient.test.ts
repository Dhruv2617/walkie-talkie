import { afterEach, describe, expect, it, vi } from "vitest";
import * as relayClient from "../src/relayClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relayClient", () => {
  it("createChannel posts to /channels and returns the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ channel_id: "abc", secret: "shh" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await relayClient.createChannel();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/channels"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual({ channelId: "abc", secret: "shh" });
  });

  it("joinChannel throws channel_full on 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ detail: { error: "channel_full" } }),
      })
    );

    await expect(relayClient.joinChannel("abc", "shh")).rejects.toThrow("channel_full");
  });

  it("joinChannel throws plain-string detail on 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: "invalid channel or secret" }),
      })
    );

    await expect(relayClient.joinChannel("abc", "wrong-secret")).rejects.toThrow(
      "invalid channel or secret"
    );
  });

  it("joinChannel returns the assigned slot on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ slot: "buddy1" }),
      })
    );

    await expect(relayClient.joinChannel("abc", "shh")).resolves.toBe("buddy1");
  });
});
