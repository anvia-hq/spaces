CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"sandbox_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "setup_status" text;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "setup_error" text;--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "network_policy" jsonb;--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");