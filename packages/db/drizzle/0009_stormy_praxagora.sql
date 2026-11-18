CREATE TABLE "runtime_samples" (
	"runtime_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"active_sandboxes" integer NOT NULL,
	"vcpu_committed" integer NOT NULL,
	"mem_mib_committed" integer NOT NULL,
	"vcpu_capacity" integer,
	"mem_mib_capacity" integer,
	CONSTRAINT "runtime_samples_runtime_id_at_pk" PRIMARY KEY("runtime_id","at")
);
--> statement-breakpoint
CREATE INDEX "runtime_samples_at_idx" ON "runtime_samples" USING btree ("at");