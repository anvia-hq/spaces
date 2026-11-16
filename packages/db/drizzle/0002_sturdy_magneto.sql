CREATE TABLE "spans" (
	"trace_id" text NOT NULL,
	"span_id" text PRIMARY KEY NOT NULL,
	"parent_span_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"status_code" text NOT NULL,
	"status_message" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"owner_id" text
);
--> statement-breakpoint
CREATE INDEX "spans_trace_idx" ON "spans" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "spans_started_idx" ON "spans" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "spans_request_idx" ON "spans" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "spans_owner_idx" ON "spans" USING btree ("owner_id","started_at");--> statement-breakpoint
CREATE INDEX "spans_name_idx" ON "spans" USING btree ("name");