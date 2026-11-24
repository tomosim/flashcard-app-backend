import express, { Router } from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createEnricher } from "./enrichment/index.js";
import type { Enricher } from "./enrichment/types.js";
import { authRoutes } from "./modules/auth/routes.js";
import { wordsRoutes } from "./modules/words/routes.js";

export type AppOptions = {
  /** Defaults to the enricher selected by ENRICHER. Tests inject fakes here. */
  enricher?: Enricher;
};

export function createApp({ enricher = createEnricher(config) }: AppOptions = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "100kb" }));
  app.use(pinoHttp({ logger }));

  const api = Router();
  api.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  api.use("/auth", authRoutes());
  api.use("/words", wordsRoutes(enricher));

  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
