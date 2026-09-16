import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { pathToFileURL } from "node:url";
import { dispatch, isMainModule } from "../src/index";
import * as init from "../src/commands/init";
import * as join from "../src/commands/join";
import * as share from "../src/commands/share";
import * as ask from "../src/commands/ask";
import * as install from "../src/commands/install";

vi.mock("../src/commands/init");
vi.mock("../src/commands/join");
vi.mock("../src/commands/share");
vi.mock("../src/commands/ask");
vi.mock("../src/commands/install");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("dispatch", () => {
  it("init prints the invite code and connection status as buddy1", async () => {
    vi.mocked(init.runInit).mockResolvedValue({ code: "WT-abc", slot: "buddy1" });
    const out = await dispatch(["init"]);
    expect(out).toContain("WT-abc");
    expect(out).toContain("connected as buddy1");
    expect(out).toContain("wait for buddy2 to join");
  });

  it("join prints connected status when the other buddy is already online", async () => {
    vi.mocked(join.runJoin).mockResolvedValue({ slot: "buddy2", otherOnline: true, messages: [] });
    const out = await dispatch(["join", "WT-abc"]);
    expect(join.runJoin).toHaveBeenCalledWith("WT-abc");
    expect(out).toContain("connected as buddy2");
    expect(out).toContain("buddy1 is here too, you're both connected");
  });

  it("join prints waiting status when the other buddy has not joined yet", async () => {
    vi.mocked(join.runJoin).mockResolvedValue({ slot: "buddy1", otherOnline: false, messages: [] });
    const out = await dispatch(["join", "WT-abc"]);
    expect(out).toContain("connected as buddy1");
    expect(out).toContain("waiting for buddy2 to join");
  });

  it("share pushes the given text", async () => {
    vi.mocked(share.runShare).mockResolvedValue(9);
    const out = await dispatch(["share", "qty", "is", "integer", "only"]);
    expect(share.runShare).toHaveBeenCalledWith("qty is integer only", undefined);
    expect(out).toContain("9");
  });

  it("share parses --reply-to and passes it through", async () => {
    vi.mocked(share.runShare).mockResolvedValue(102);
    const out = await dispatch(["share", "integer", "only", "--reply-to", "101"]);
    expect(share.runShare).toHaveBeenCalledWith("integer only", { replyTo: 101 });
    expect(out).toContain("102");
  });

  it("ask prints the returned answer", async () => {
    vi.mocked(ask.runAsk).mockResolvedValue("integer only");
    const out = await dispatch(["ask", "does qty accept decimals?"]);
    expect(out).toBe("integer only");
  });

  it("join lists pulled messages and flags unanswered questions", async () => {
    vi.mocked(join.runJoin).mockResolvedValue({
      slot: "buddy2",
      otherOnline: true,
      messages: [
        { id: 100, from: "buddy1", ts: 1, type: "fyi", text: "renamed org_name", reply_to: null },
        {
          id: 101,
          from: "buddy1",
          ts: 2,
          type: "question",
          text: "does qty accept decimals?",
          reply_to: null,
        },
      ],
    });
    const out = await dispatch(["join", "WT-abc"]);
    expect(out).toContain("2 unread message(s)");
    expect(out).toContain("does qty accept decimals?");
    expect(out).toContain("1 question(s) still need a reply");
    expect(out).toContain("[101] does qty accept decimals?");
  });

  it("join does not flag a question that already has a matching answer in the same pull", async () => {
    vi.mocked(join.runJoin).mockResolvedValue({
      slot: "buddy2",
      otherOnline: true,
      messages: [
        {
          id: 101,
          from: "buddy2",
          ts: 1,
          type: "question",
          text: "does qty accept decimals?",
          reply_to: null,
        },
        { id: 102, from: "buddy1", ts: 2, type: "answer", text: "integer only", reply_to: 101 },
      ],
    });
    const out = await dispatch(["join", "WT-abc"]);
    expect(out).not.toContain("still need a reply");
  });

  it("join rejects when no invite code is given", async () => {
    await expect(dispatch(["join"])).rejects.toThrow("usage: ctx-relay join <code>");
  });

  it("throws a clear error for an unknown command", async () => {
    await expect(dispatch(["frobnicate"])).rejects.toThrow("unknown command: frobnicate");
  });

  it("install writes Claude Code commands and reports how many", async () => {
    vi.mocked(install.runInstall).mockReturnValue([
      "/repo/.claude/commands/share-context.md",
      "/repo/.claude/commands/ask-relay.md",
      "/repo/.claude/commands/join-relay.md",
    ]);
    const out = await dispatch(["install"]);
    expect(install.runInstall).toHaveBeenCalled();
    expect(out).toContain("installed 3 Claude Code command(s)");
  });
});

describe("isMainModule", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(pathJoin(tmpdir(), "wt-mainmodule-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true when argv[1] matches the module URL directly", () => {
    const filePath = pathJoin(dir, "index.js");
    writeFileSync(filePath, "");
    // import.meta.url is always a resolved-realpath URL in real Node — construct
    // the "expected" side the same way here rather than from the raw path.
    const moduleUrl = pathToFileURL(realpathSync(filePath)).href;
    expect(isMainModule(filePath, moduleUrl)).toBe(true);
  });

  it("returns true when argv[1] reaches the same file through a symlink", () => {
    const realDir = pathJoin(dir, "real");
    mkdirSync(realDir);
    const realFile = pathJoin(realDir, "index.js");
    writeFileSync(realFile, "");

    const linkedDir = pathJoin(dir, "linked");
    symlinkSync(realDir, linkedDir);
    const argv1ThroughSymlink = pathJoin(linkedDir, "index.js");

    // import.meta.url would resolve through the symlink to the real path —
    // simulate that by comparing against the real file's canonical URL.
    const moduleUrl = pathToFileURL(realpathSync(realFile)).href;
    expect(isMainModule(argv1ThroughSymlink, moduleUrl)).toBe(true);
  });

  it("returns false when argv[1] points at a different file entirely", () => {
    const filePath = pathJoin(dir, "index.js");
    const otherPath = pathJoin(dir, "other.js");
    writeFileSync(filePath, "");
    writeFileSync(otherPath, "");
    const moduleUrl = pathToFileURL(realpathSync(filePath)).href;
    expect(isMainModule(otherPath, moduleUrl)).toBe(false);
  });

  it("returns false when argv[1] is undefined", () => {
    expect(isMainModule(undefined, "file:///anything")).toBe(false);
  });
});
