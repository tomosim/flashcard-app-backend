import { Router } from "express";
import { requireAuth, userIdOf } from "../../middleware/auth.js";
import { createAuthRateLimiter } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import { LoginSchema, RegisterSchema } from "./schemas.js";
import * as authService from "./service.js";

export function authRoutes() {
  const router = Router();
  router.use(createAuthRateLimiter());

  router.post("/register", async (req, res) => {
    const input = validate(RegisterSchema, req.body);
    res.status(201).json(await authService.register(input));
  });

  router.post("/login", async (req, res) => {
    const input = validate(LoginSchema, req.body);
    res.json(await authService.login(input));
  });

  router.get("/me", requireAuth, async (req, res) => {
    res.json({ user: await authService.getMe(userIdOf(req)) });
  });

  return router;
}
