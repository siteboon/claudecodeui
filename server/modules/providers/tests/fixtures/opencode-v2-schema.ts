/**
 * The tables of OpenCode's `opencode.db` that CloudCLI reads, with their
 * indexes, exactly as OpenCode created them (dumped from `sqlite_master`):
 * - OPENCODE_2_SCHEMA: a database OpenCode 2.2.3 created.
 * - OPENCODE_UPGRADED_SCHEMA: an OpenCode 1.18.25 database after 2.2.3 migrated
 *   it, which keeps the 1.x `session`, `message` and `part` tables.
 * - OPENCODE_CREDENTIAL_SCHEMA: the `credential` table where 2.2.3 keeps logins;
 *   1.18.25 creates the same table and leaves it empty.
 * Used by the OpenCode 2.x storage tests.
 */
export const OPENCODE_2_SCHEMA = `
CREATE TABLE \`project\` (
          \`id\` text PRIMARY KEY,
          \`worktree\` text NOT NULL,
          \`vcs\` text,
          \`name\` text,
          \`icon_url\` text,
          \`icon_url_override\` text,
          \`icon_color\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_initialized\` integer,
          \`time_active\` integer DEFAULT 0 NOT NULL,
          \`time_archived\` integer,
          \`sandboxes\` text NOT NULL,
          \`commands\` text
        );
CREATE TABLE \`session_v2\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`fork_session_id\` text,
          \`fork_boundary\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_busy\` integer,
          \`time_idle\` integer,
          \`time_viewed\` integer,
          \`idle_outcome\` text,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          \`time_suspended\` integer,
          \`resume_attempts\` integer DEFAULT 0 NOT NULL,
          CONSTRAINT \`fk_session_v2_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
CREATE INDEX \`session_v2_parent_idx\` ON \`session_v2\` (\`parent_id\`);
CREATE INDEX \`session_v2_project_idx\` ON \`session_v2\` (\`project_id\`);
CREATE INDEX \`session_v2_time_suspended_idx\` ON \`session_v2\` (\`time_suspended\`) WHERE "session_v2"."time_suspended" is not null;
CREATE INDEX \`session_v2_workspace_idx\` ON \`session_v2\` (\`workspace_id\`);
CREATE TABLE \`session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);
CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);
CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);
CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);
CREATE TABLE \`session_part\` (
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          \`type\` text NOT NULL,
          \`call_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`session_part_pk\` PRIMARY KEY(\`message_id\`, \`ordinal\`),
          CONSTRAINT \`fk_session_part_message_id_session_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`session_message\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_part_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
CREATE INDEX \`session_part_session_message_idx\` ON \`session_part\` (\`session_id\`,\`message_id\`,\`ordinal\`);
`;

export const OPENCODE_UPGRADED_SCHEMA = `
CREATE TABLE \`project\` (
          \`id\` text PRIMARY KEY,
          \`worktree\` text NOT NULL,
          \`vcs\` text,
          \`name\` text,
          \`icon_url\` text,
          \`icon_url_override\` text,
          \`icon_color\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_initialized\` integer,
          \`sandboxes\` text NOT NULL,
          \`commands\` text
        , \`time_active\` integer DEFAULT 0 NOT NULL, \`time_archived\` integer);
CREATE TABLE \`session\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text NOT NULL,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          CONSTRAINT \`fk_session_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
CREATE INDEX \`session_parent_idx\` ON \`session\` (\`parent_id\`);
CREATE INDEX \`session_project_idx\` ON \`session\` (\`project_id\`);
CREATE INDEX \`session_workspace_idx\` ON \`session\` (\`workspace_id\`);
CREATE TABLE \`message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_message_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
CREATE INDEX \`message_session_time_created_id_idx\` ON \`message\` (\`session_id\`,\`time_created\`,\`id\`);
CREATE TABLE \`part\` (
          \`id\` text PRIMARY KEY,
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_part_message_id_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`message\`(\`id\`) ON DELETE CASCADE
        );
CREATE INDEX \`part_message_id_id_idx\` ON \`part\` (\`message_id\`,\`id\`);
CREATE INDEX \`part_session_idx\` ON \`part\` (\`session_id\`);
CREATE TABLE \`session_v2\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`fork_session_id\` text,
          \`fork_boundary\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          \`time_suspended\` integer, \`resume_attempts\` integer DEFAULT 0 NOT NULL, \`time_idle\` integer, \`time_viewed\` integer, \`idle_outcome\` text, \`time_busy\` integer,
          CONSTRAINT \`fk_session_v2_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
CREATE INDEX \`session_v2_parent_idx\` ON \`session_v2\` (\`parent_id\`);
CREATE INDEX \`session_v2_project_idx\` ON \`session_v2\` (\`project_id\`);
CREATE INDEX \`session_v2_time_suspended_idx\` ON \`session_v2\` (\`time_suspended\`) WHERE "session_v2"."time_suspended" is not null;
CREATE INDEX \`session_v2_workspace_idx\` ON \`session_v2\` (\`workspace_id\`);
CREATE TABLE "session_message" (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);
CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);
CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);
CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);
CREATE TABLE \`session_part\` (
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          \`type\` text NOT NULL,
          \`call_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`session_part_pk\` PRIMARY KEY(\`message_id\`, \`ordinal\`),
          CONSTRAINT \`fk_session_part_message_id_session_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`session_message\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_part_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
CREATE INDEX \`session_part_session_message_idx\` ON \`session_part\` (\`session_id\`,\`message_id\`,\`ordinal\`);
`;

export const OPENCODE_CREDENTIAL_SCHEMA = `
CREATE TABLE \`credential\` (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
`;
