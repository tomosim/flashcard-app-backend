import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  return (await import("../src/config.js")).config;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("TEST_DATABASE_URL", () => {
  it("is optional outside the test runner", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    const config = await loadConfig();
    expect(config.isTest).toBe(false);
    expect(config.databaseUrl).toBe(process.env.DATABASE_URL);
  });

  it("is required under the test runner", async () => {
    vi.stubEnv("TEST_DATABASE_URL", undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadConfig()).rejects.toThrow("process.exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("TEST_DATABASE_URL is required when running tests"),
    );
  });
});
