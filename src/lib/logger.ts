import { pino } from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.isTest ? "silent" : config.env === "production" ? "info" : "debug",
  ...(config.env === "development" && {
    transport: { target: "pino-pretty", options: { colorize: true } },
  }),
});
