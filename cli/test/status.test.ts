import { beforeEach, describe, expect, it, vi } from "vitest";
import * as relayClient from "../src/relayClient";
import * as config from "../src/config";
import { runStatus } from "../src/commands/status";

vi.mock("../src/relayClient");
vi.mock("../src/config");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runStatus", () => {
  it("returns null when no config has been written yet", async () => {
    vi.mocked(config.readConfig).mockReturnValue(null);

    const result = await runStatus();

    expect(result).toBeNull();
  });

  it("reconstructs the invite code from saved config and reports connection status", async () => {
    vi.mocked(config.readConfig).mockReturnValue({
      channelId: "abc",
      secret: "shh",
      slot: "buddy1",
    });
    vi.mocked(relayClient.getPresence).mockResolvedValue(true);

    const result = await runStatus();

    expect(relayClient.getPresence).toHaveBeenCalledWith("abc", "shh", "buddy2");
    expect(result).toEqual({
      code: expect.stringMatching(/^WT-/),
      slot: "buddy1",
      otherOnline: true,
    });
  });
});
