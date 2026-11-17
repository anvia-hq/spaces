INSERT INTO "machine_sizes" ("name", "vcpu", "mem_mib", "disk_gb", "description", "created_at", "updated_at")
VALUES
	('small', 2, 4096, 51, 'Two cores, 4 GiB', now(), now()),
	('default', 4, 8192, 51, 'Four cores, 8 GiB', now(), now()),
	('large', 8, 16384, 111, 'Eight cores, 16 GiB', now(), now()),
	('xlarge', 16, 32768, 251, 'Sixteen cores, 32 GiB', now(), now())
ON CONFLICT ("name") DO NOTHING;
