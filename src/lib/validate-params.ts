import { z } from 'zod';

export const partParamsSchema = z.object({
  partNo: z.string().regex(/^[A-Za-z0-9._\-]+$/).max(50),
  colorId: z.coerce.number().int().min(0),
});

export function validatePartParams(params: { partNo: string; colorId: string }) {
  return partParamsSchema.parse({ partNo: params.partNo, colorId: params.colorId });
}
