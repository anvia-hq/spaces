ALTER TABLE "saved_snapshots" ALTER COLUMN "size_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "snapshots" ALTER COLUMN "size_bytes" SET DATA TYPE bigint;