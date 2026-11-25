declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth / requireJwt. */
      user?: { id: string; authType: "jwt" | "apiToken" };
    }
  }
}

export {};
