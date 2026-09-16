import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInstall } from "../src/commands/install";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ctx-relay-install-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runInstall", () => {
  it("writes the five Claude Code commands under .claude/commands", () => {
    const written = runInstall(dir);

    expect(written).toHaveLength(5);
    for (const path of written) {
      expect(existsSync(path)).toBe(true);
    }
  });

  it("each command file references the matching CLI subcommand", () => {
    runInstall(dir);

    const init = readFileSync(join(dir, ".claude", "commands", "init-relay.md"), "utf8");
    expect(init).toContain("walkie-talkie init");

    const shareContext = readFileSync(join(dir, ".claude", "commands", "share-context.md"), "utf8");
    expect(shareContext).toContain("walkie-talkie share");

    const ask = readFileSync(join(dir, ".claude", "commands", "ask-relay.md"), "utf8");
    expect(ask).toContain("walkie-talkie ask");

    const join_ = readFileSync(join(dir, ".claude", "commands", "join-relay.md"), "utf8");
    expect(join_).toContain("walkie-talkie join");

    const status = readFileSync(join(dir, ".claude", "commands", "status-relay.md"), "utf8");
    expect(status).toContain("walkie-talkie status");
  });

  it("init-relay points at status-relay instead of allowing a silent re-run", () => {
    runInstall(dir);
    const init = readFileSync(join(dir, ".claude", "commands", "init-relay.md"), "utf8");
    expect(init).toContain("status-relay");
  });

  it("join-relay instructs answering unanswered questions before other work", () => {
    runInstall(dir);
    const join_ = readFileSync(join(dir, ".claude", "commands", "join-relay.md"), "utf8");
    expect(join_).toContain("unanswered questions");
    expect(join_).toContain("--reply-to");
  });
});
