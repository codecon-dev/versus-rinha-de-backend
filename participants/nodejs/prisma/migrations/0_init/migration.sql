-- CreateTable
CREATE TABLE "urls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(16),
    "url" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "click_count" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "urls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clicks" (
    "id" BIGSERIAL NOT NULL,
    "url_id" UUID NOT NULL,
    "clicked_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "urls_code_key" ON "urls"("code");

-- CreateIndex
CREATE INDEX "idx_urls_url" ON "urls"("url");

-- CreateIndex
CREATE INDEX "idx_urls_code" ON "urls"("code");

-- CreateIndex
CREATE INDEX "idx_urls_created_at" ON "urls"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_clicks_url_id" ON "clicks"("url_id");

-- CreateIndex
CREATE INDEX "idx_clicks_clicked_at" ON "clicks"("clicked_at");

-- AddForeignKey
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_url_id_fkey" FOREIGN KEY ("url_id") REFERENCES "urls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
