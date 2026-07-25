import * as z from "zod";

export const url = z.object({
  id: z.string(),
  code: z.string(),
  url: z.string().url(),
  short_url: z.string().url(),
  expires_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  click_count: z.number(),
});

export type Url = z.infer<typeof url>;

export const createUrlDto = z.object({
  url: z.string(),
  custom_code: z.string(),
  expires_at: z.string(),
});

export type CreateUrlDto = z.infer<typeof createUrlDto>;

export const clicksPerDayDto = z.array(
  z.object({ date: z.string(), count: z.number() }),
);

export const clicksPerHourDto = z.array(
  z.object({ hour: z.string(), count: z.number() }),
);

export const statsDto = z.object({
  id: z.string(),
  code: z.string(),
  url: z.string().url(),
  click_count: z.number(),
  clicks_per_day: clicksPerDayDto,
  clicks_per_hour: clicksPerHourDto,
});

export type ClicksPerDayDto = z.infer<typeof clicksPerDayDto>;
export type ClicksPerHourDto = z.infer<typeof clicksPerHourDto>;
export type StatsDto = z.infer<typeof statsDto>;
