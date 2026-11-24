import { Router } from "express";
import { requireAuth, userIdOf } from "../../middleware/auth.js";
import * as languagesService from "./service.js";

export function languagesRoutes() {
  const router = Router();
  router.use(requireAuth);

  router.get("/", async (req, res) => {
    res.json(await languagesService.listLanguages(userIdOf(req)));
  });

  return router;
}
