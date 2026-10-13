CREATE TABLE `workspace_state_chunks` (
	`workspace_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `snapshot_id`, `chunk_index`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
