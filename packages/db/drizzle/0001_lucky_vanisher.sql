CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"actor_label" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"result" text NOT NULL,
	"status" integer,
	"error_code" text,
	"request_id" text,
	"ip" text,
	"user_agent" text,
	"duration_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_id" text
);
--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_owner_idx" ON "audit_log" USING btree ("owner_id","at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_id");