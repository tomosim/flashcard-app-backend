import { Router } from "express";
import type { Enricher } from "../../enrichment/types.js";
import { requireAuth, userIdOf } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  CreateWordSchema,
  IdParamsSchema,
  ListWordsQuerySchema,
  UpdateWordSchema,
} from "./schemas.js";
import * as wordsService from "./service.js";

export function wordsRoutes(enricher: Enricher) {
  const router = Router();
  router.use(requireAuth);

  router.post("/", async (req, res) => {
    const input = validate(CreateWordSchema, req.body);
    const { word, duplicate } = await wordsService.createWord(userIdOf(req), input, enricher);
    if (duplicate) {
      res.status(200).json({ ...word, duplicate: true });
    } else {
      res.status(201).json(word);
    }
  });

  router.get("/", async (req, res) => {
    const query = validate(ListWordsQuerySchema, req.query);
    res.json(await wordsService.listWords(userIdOf(req), query));
  });

  router.delete("/", async (req, res) => {
    res.json(await wordsService.deleteAllWords(userIdOf(req)));
  });

  router.get("/:id", async (req, res) => {
    const { id } = validate(IdParamsSchema, req.params);
    res.json(await wordsService.getWord(userIdOf(req), id));
  });

  router.patch("/:id", async (req, res) => {
    const { id } = validate(IdParamsSchema, req.params);
    const patch = validate(UpdateWordSchema, req.body);
    res.json(await wordsService.updateWord(userIdOf(req), id, patch));
  });

  router.post("/:id/re-enrich", async (req, res) => {
    const { id } = validate(IdParamsSchema, req.params);
    res.json(await wordsService.reEnrichWord(userIdOf(req), id, enricher));
  });

  router.delete("/:id", async (req, res) => {
    const { id } = validate(IdParamsSchema, req.params);
    await wordsService.deleteWord(userIdOf(req), id);
    res.status(204).end();
  });

  return router;
}
