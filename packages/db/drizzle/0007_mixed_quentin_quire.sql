CREATE TABLE "runtimes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'offline' NOT NULL,
	"draining" boolean DEFAULT false NOT NULL,
	"labels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_sandboxes" integer,
	"token_hash" text,
	"token_prefix" text,
	"driver_kind" text,
	"capabilities" jsonb,
	"port_start" integer,
	"port_end" integer,
	"port_bind" text,
	"public_host" text,
	"agent_version" text,
	"protocol" integer,
	"connected_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "runtimes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD COLUMN "runtime_id" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshots" ADD COLUMN "runtime_id" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE INDEX "runtimes_token_idx" ON "runtimes" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sandboxes_runtime_idx" ON "sandboxes" USING btree ("runtime_id");--> statement-breakpoint
CREATE INDEX "snapshots_runtime_idx" ON "snapshots" USING btree ("runtime_id");