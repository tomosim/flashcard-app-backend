import { Router } from "express";
import { requireJwt, userIdOf } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { CreateTokenSchema, TokenIdParamsSchema } from "./schemas.js";
import * as tokensService from "./service.js";

/**
 * Personal API token management. JWT only: an API token can't mint new
 * tokens or revoke others, so a leaked token can be revoked from the app.
 */
export function tokensRoutes() {
  const router = Router();
  router.use(requireJwt);

  router.post("/", async (req, res) => {
    const input = validate(CreateTokenSchema, req.body);
    res.status(201).json(await tokensService.createToken(userIdOf(req), input));
  });

  router.get("/", async (req, res) => {
    res.json(await tokensService.listTokens(userIdOf(req)));
  });

  router.delete("/:id", async (req, res) => {
    const { id } = validate(TokenIdParamsSchema, req.params);
    await tokensService.revokeToken(userIdOf(req), id);
    res.status(204).end();
  });

  return router;
}
