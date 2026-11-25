import "dotenv/config";
import { z } from "zod";
import { isTestRuntime } from "./lib/runtime.js";

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.url(),
    // Required only under the test runner; production never uses it.
    TEST_DATABASE_URL: z.url().optional(),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_EXPIRES_IN: z.string().min(1).default("7d"),
    ENRICHER: z.enum(["mock", "claude"]).default("mock"),
    ANTHROPIC_API_KEY: z.string().optional(),
    SUPPORTED_LANGUAGES: z
      .string()
      .default("de,fr,es,it,nl,pt")
      .transform((s) =>
        s
          .split(",")
          .map((l) => l.trim().toLowerCase())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().regex(/^[a-z]{2}$/, "must be ISO 639-1 codes")).min(1)),
    CORS_ORIGIN: z.string().min(1),
  })
  .superRefine((env, ctx) => {
    if (isTestRuntime() && !env.TEST_DATABASE_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["TEST_DATABASE_URL"],
        message: "TEST_DATABASE_URL is required when running tests",
      });
    }
    if (env.ENRICHER === "claude" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when ENRICHER=claude",
      });
    }
  });

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
    process.exit(1);
  }
  const env = parsed.data;
  const isTest = isTestRuntime();
  return {
    env: isTest ? ("test" as const) : env.NODE_ENV,
    isTest,
    port: env.PORT,
    // Tests always run against the separate test database.
    // TEST_DATABASE_URL is guaranteed under tests by the check above.
    databaseUrl: isTest ? env.TEST_DATABASE_URL! : env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    // Tests always use the mock enricher and never see an API key, whatever the env says.
    enricher: isTest ? ("mock" as const) : env.ENRICHER,
    anthropicApiKey: isTest ? undefined : env.ANTHROPIC_API_KEY || undefined,
    supportedLanguages: env.SUPPORTED_LANGUAGES,
    corsOrigin: env.CORS_ORIGIN,
  } as const;
}

export const config = loadConfig();
export type Config = typeof config;
