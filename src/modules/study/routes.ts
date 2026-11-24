import { Router } from "express";
import { z } from "zod";
import { LanguageCodeSchema } from "../../lib/languages.js";
import { requireAuth, userIdOf } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as studyService from "./service.js";

const StudyBatchQuerySchema = z.object({
  language: LanguageCodeSchema,
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export function studyRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get("/batch", async (req, res) => {
    const query = validate(StudyBatchQuerySchema, req.query);
    res.json(await studyService.getStudyBatch(userIdOf(req), query));
  });

  return router;
}
