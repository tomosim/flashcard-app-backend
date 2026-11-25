import { z } from "zod";

export const CreateTokenSchema = z.object({
  name: z.string().trim().min(1).max(50),
});

export const TokenIdParamsSchema = z.object({ id: z.uuid() });

export type CreateTokenInput = z.infer<typeof CreateTokenSchema>;

/** An API token as listed. Never includes the token or its hash. */
export type ApiTokenDto = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Returned once, when the token is created: the only time the raw token is shown. */
export type CreatedApiTokenDto = Omit<ApiTokenDto, "lastUsedAt"> & { token: string };
