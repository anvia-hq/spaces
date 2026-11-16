CREATE TABLE IF NOT EXISTS "machine_sizes" (
	"name" text PRIMARY KEY NOT NULL,
	"vcpu" integer NOT NULL,
	"mem_mib" integer NOT NULL,
	"disk_gb" integer NOT NULL,
	"description" text,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
