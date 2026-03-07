import Fastify, { FastifyRequest } from "fastify";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { generateQrCode } from "./generateQRCode";
import { validateURL } from "./validateURL.js";
import { isPastDate } from "./isPastDate.js";
import type { CreateUrlDto } from "./types";
import { validateCustomCode } from "./validateCustomCode.js";

function generateUID() {
  // I generate the UID from two parts here
  // to ensure the random number provide enough bits.
  var firstPart: string | number = (Math.random() * 46656) | 0;
  var secondPart: string | number = (Math.random() * 46656) | 0;
  firstPart = ("000" + firstPart.toString(36)).slice(-3);
  secondPart = ("000" + secondPart.toString(36)).slice(-3);
  return firstPart + secondPart;
}

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const app = Fastify({ logger: true });

app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_request, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : undefined);
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

app.get("/health", async () => {
  return { status: "okay" };
});

app.get("/urls", async (request, reply) => {
  const page = parseInt((request.query as any).page as string) || 1;
  const perPage = parseInt((request.query as any).per_page as string) || 10;

  const [urls, total] = await Promise.all([
    prisma.url.findMany({
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: "desc" },
    }),
    prisma.url.count(),
  ]);

  const data = urls.map((url) => ({ id: url.id }));

  return reply.status(200).send({
    data,
    meta: {
      page,
      per_page: perPage,
      total,
    },
  });
});

app.post("/urls", async (request, reply) => {
  const url = request.body as CreateUrlDto;

  const isUrlValid = validateURL(url.url);
  const isCustomCodeValid = url.custom_code
    ? validateCustomCode(url.custom_code)
    : true;
  const isDateInThePast = url.expires_at
    ? isPastDate(new Date(url.expires_at))
    : false;

  if (!isUrlValid) {
    return reply.status(400).send({ error: "Invalid URL" });
  }

  if (!isCustomCodeValid) {
    return reply.status(400).send({ error: "Invalid custom code" });
  }

  if (isDateInThePast) {
    return reply.status(400).send({ error: "Expiration date is in the past" });
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const existingUrl = await tx.url.findFirst({
          where: {
            url: url.url,
          },
        });

        if (existingUrl) {
          return {
            status: 200 as const,
            data: {
              id: existingUrl.id,
              code: existingUrl.code,
              url: existingUrl.url,
              short_url: `http://localhost:${port}/${existingUrl.code}`,
              expires_at: existingUrl.expiresAt?.toISOString() ?? null,
              click_count: Number(existingUrl.clickCount),
              created_at: existingUrl.createdAt.toISOString(),
              updated_at: existingUrl.updatedAt.toISOString(),
            },
          };
        }

        if (url.custom_code) {
          const existentCode = await tx.url.findFirst({
            where: {
              code: url.custom_code,
            },
          });

          if (existentCode) {
            return {
              status: 409 as const,
              data: { error: "Custom code already in use" },
            };
          }
        }

        const createdUrl = await tx.url.create({
          data: {
            url: url.url,
            code: url?.custom_code ?? generateUID(),
            expiresAt: url?.expires_at ? new Date(url.expires_at) : undefined,
          },
        });

        return {
          status: 201 as const,
          data: {
            id: createdUrl.id,
            code: createdUrl.code,
            url: createdUrl.url,
            short_url: `http://localhost:${port}/${createdUrl.code}`,
            expires_at: createdUrl.expiresAt?.toISOString() ?? null,
            click_count: Number(createdUrl.clickCount),
            created_at: createdUrl.createdAt.toISOString(),
            updated_at: createdUrl.updatedAt.toISOString(),
          },
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );

    return reply.status(result.status).send(result.data);
  } catch (e) {
    if (!url.custom_code) {
      const existing = await prisma.url.findFirst({
        where: { url: url.url },
      });
      if (existing) {
        return reply.status(200).send({
          id: existing.id,
          code: existing.code,
          url: existing.url,
          short_url: `http://localhost:${port}/${existing.code}`,
          expires_at: existing.expiresAt?.toISOString() ?? null,
          click_count: Number(existing.clickCount),
          created_at: existing.createdAt.toISOString(),
          updated_at: existing.updatedAt.toISOString(),
        });
      }
    }
    return reply.status(409).send({ error: "Custom code already in use" });
  }
});

app.get("/urls/:id", async (request, reply) => {
  const { id } = request.params as { id: string };

  try {
    const url = await prisma.url.findUniqueOrThrow({ where: { id } });
    const data = {
      id: url.id,
      code: url.code,
      url: url.url,
      short_url: `http://localhost:${port}/${url.code}`,
      expires_at: url.expiresAt?.toISOString() ?? null,
      click_count: Number(url.clickCount),
      created_at: url.createdAt.toISOString(),
      updated_at: url.updatedAt.toISOString(),
    };

    return reply.status(200).send(data);
  } catch (e) {
    return reply.status(404).send({ error: "URL not found" });
  }
});

app.delete("/urls/:id", async (request, reply) => {
  const { id } = request.params as { id: string };

  try {
    await prisma.url.delete({ where: { id } });
    return reply.status(204).send();
  } catch (e) {
    return reply.status(404).send({ error: "URL not found" });
  }
});

app.patch("/urls/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const { url, expires_at } = request.body as {
    url?: string;
    expires_at?: string;
  };

  const updatedUrl = await prisma.url.update({
    where: { id },
    data: {
      url,
      expiresAt: expires_at ? new Date(expires_at) : undefined,
    },
  });

  const data = {
    id: updatedUrl.id,
    code: updatedUrl.code,
    url: updatedUrl.url,
    short_url: `http://localhost:${port}/${updatedUrl.code}`,
    expires_at: updatedUrl.expiresAt?.toISOString() ?? null,
    click_count: Number(updatedUrl.clickCount),
    created_at: updatedUrl.createdAt.toISOString(),
    updated_at: updatedUrl.updatedAt.toISOString(),
  };

  return reply.status(200).send(data);
});

app.get("/urls/:id/stats", async (request, reply) => {
  const { id } = request.params as { id: string };

  const url = await prisma.url.findUnique({
    where: { id },
    include: { clicks: true },
  });
  const clicks = url?.clicks ?? [];

  if (!url) {
    return reply.status(404).send({ error: "URL not found" });
  }

  if (!clicks.length) {
    const data = {
      id: url.id,
      code: url.code,
      url: url.url,
      click_count: 0,
      clicks_per_day: [],
      clicks_per_hour: [],
    };

    return reply.status(200).send(data);
  }

  const clicksPerDay = Object.entries(
    clicks.reduce(
      (acc, click) => {
        const date = click.clickedAt.toISOString().split("T")[0];
        acc[date] = (acc[date] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  ).reduce(
    (acc, [date, count]) => {
      acc.push({ date, count });
      return acc;
    },
    [] as { date: string; count: number }[],
  );

  const clicksPerHour = Object.entries(
    clicks.reduce(
      (acc, click) => {
        const hour = click.clickedAt.toISOString().split("T")[1].split(":")[0];
        acc[hour] = (acc[hour] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  ).reduce(
    (acc, [hour, count]) => {
      acc.push({ hour, count });
      return acc;
    },
    [] as { hour: string; count: number }[],
  );

  const data = {
    id: url.id,
    code: url.code,
    url: url.url,
    click_count: clicks.length,
    clicks_per_day: clicksPerDay,
    clicks_per_hour: clicksPerHour,
  };

  return reply.status(200).send(data);
});

// Retorna o QR Code da `short_url` codificado em base64 (imagem PNG). O conteúdo do QR Code deve ser a `short_url` completa (ex: `http://localhost:3000/aB3kZ7`).
app.get("/urls/:id/qr", async (request, reply) => {
  const { id } = request.params as { id: string };
  const url = await prisma.url.findUnique({ where: { id } });
  if (!url) {
    return reply.status(404).send({ error: "URL not found" });
  }
  const shortUrl = `http://localhost:${port}/${url.code}`;
  const data = { qr_code: await generateQrCode(shortUrl) };

  return reply.status(200).send(data);
});

// Return 301 redirect to the long URL and increment click count
app.get("/:code", async (request, reply) => {
  const { code } = request.params as { code: string };
  const url = await prisma.url.findUnique({ where: { code } });
  if (!url) return reply.status(404).send({ error: "URL not found" });
  if (url.expiresAt && isPastDate(url.expiresAt)) {
    return reply.status(410).send({ error: "URL has expired" });
  }
  await Promise.all([
    prisma.click.create({ data: { urlId: url.id } }),
    prisma.url.update({
      where: { id: url.id },
      data: { clickCount: { increment: 1 } },
    }),
  ]);
  return reply.status(301).header("Location", url.url).send();
});

const port = Number(process.env.PORT) || 3000;

app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`Server listening on port ${port}`);
});
