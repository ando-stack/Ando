-- Fortnite VOD Analyzer — esquema PostgreSQL (Supabase).
-- Generado desde backend/app/models.py. El backend también lo crea al arrancar (create_all).
-- El backend accede con la conexión directa a Postgres; la API REST pública de Supabase
-- (PostgREST) queda bloqueada activando RLS sin políticas en todas las tablas.

CREATE TABLE users (
	id VARCHAR(36) NOT NULL, 
	email VARCHAR(320) NOT NULL, 
	display_name VARCHAR(120), 
	password_hash VARCHAR(255), 
	external_id VARCHAR(64), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (external_id)
);

CREATE UNIQUE INDEX ix_users_email ON users (email);

CREATE TABLE activity (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	message VARCHAR(300) NOT NULL, 
	match_id VARCHAR(36), 
	player_id VARCHAR(36), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_activity_created_at ON activity (created_at);
CREATE INDEX ix_activity_owner_id ON activity (owner_id);

CREATE TABLE players (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	epic_id VARCHAR(120), 
	platform VARCHAR(40), 
	region VARCHAR(40), 
	game_mode VARCHAR(60), 
	competitive_level VARCHAR(60), 
	coach_notes TEXT, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_players_owner_id ON players (owner_id);

CREATE TABLE matches (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	player_id VARCHAR(36) NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	source_type VARCHAR(10) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	game_mode VARCHAR(60), 
	played_at TIMESTAMP WITH TIME ZONE, 
	notes TEXT, 
	target_player_ref VARCHAR(120), 
	replay_video_offset FLOAT, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(player_id) REFERENCES players (id) ON DELETE CASCADE
);

CREATE INDEX ix_matches_player_id ON matches (player_id);
CREATE INDEX ix_matches_owner_id ON matches (owner_id);

CREATE TABLE player_goals (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	player_id VARCHAR(36) NOT NULL, 
	title VARCHAR(200) NOT NULL, 
	description TEXT, 
	category VARCHAR(40), 
	status VARCHAR(20) NOT NULL, 
	source_analysis_id VARCHAR(36), 
	due_date TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(player_id) REFERENCES players (id) ON DELETE CASCADE
);

CREATE INDEX ix_player_goals_player_id ON player_goals (player_id);
CREATE INDEX ix_player_goals_owner_id ON player_goals (owner_id);

CREATE TABLE analyses (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	match_id VARCHAR(36) NOT NULL, 
	job_id VARCHAR(36), 
	source_type VARCHAR(10) NOT NULL, 
	is_current BOOLEAN NOT NULL, 
	model VARCHAR(80), 
	pipeline_version VARCHAR(20) NOT NULL, 
	coverage JSONB NOT NULL, 
	timeline JSONB NOT NULL, 
	stats JSONB NOT NULL, 
	scores JSONB NOT NULL, 
	report JSONB NOT NULL, 
	replay_data JSONB, 
	usage JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(match_id) REFERENCES matches (id) ON DELETE CASCADE
);

CREATE INDEX ix_analyses_owner_id ON analyses (owner_id);
CREATE INDEX ix_analyses_match_id ON analyses (match_id);

CREATE TABLE coach_notes (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	match_id VARCHAR(36) NOT NULL, 
	t FLOAT, 
	category VARCHAR(30), 
	text TEXT NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(match_id) REFERENCES matches (id) ON DELETE CASCADE
);

CREATE INDEX ix_coach_notes_match_id ON coach_notes (match_id);
CREATE INDEX ix_coach_notes_owner_id ON coach_notes (owner_id);

CREATE TABLE jobs (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	match_id VARCHAR(36) NOT NULL, 
	type VARCHAR(30) NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	stage VARCHAR(60), 
	progress FLOAT NOT NULL, 
	message TEXT, 
	error TEXT, 
	error_code VARCHAR(60), 
	attempts INTEGER NOT NULL, 
	params JSONB NOT NULL, 
	log JSONB NOT NULL, 
	locked_by VARCHAR(120), 
	heartbeat_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	started_at TIMESTAMP WITH TIME ZONE, 
	finished_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(match_id) REFERENCES matches (id) ON DELETE CASCADE
);

CREATE INDEX ix_jobs_owner_id ON jobs (owner_id);
CREATE INDEX ix_jobs_status_created ON jobs (status, created_at);
CREATE INDEX ix_jobs_match_id ON jobs (match_id);

CREATE TABLE media_files (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	match_id VARCHAR(36) NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	storage_key VARCHAR(500) NOT NULL, 
	original_name VARCHAR(300) NOT NULL, 
	size_bytes BIGINT NOT NULL, 
	sha256 VARCHAR(64) NOT NULL, 
	mime VARCHAR(100), 
	duration_s FLOAT, 
	width INTEGER, 
	height INTEGER, 
	fps FLOAT, 
	video_codec VARCHAR(40), 
	audio_codec VARCHAR(40), 
	has_audio BOOLEAN, 
	meta JSONB NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_media_owner_hash_kind UNIQUE (owner_id, sha256, kind), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(match_id) REFERENCES matches (id) ON DELETE CASCADE
);

CREATE INDEX ix_media_files_owner_id ON media_files (owner_id);
CREATE INDEX ix_media_files_match_id ON media_files (match_id);

CREATE TABLE uploads (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	match_id VARCHAR(36) NOT NULL, 
	kind VARCHAR(20) NOT NULL, 
	filename VARCHAR(300) NOT NULL, 
	size_bytes BIGINT NOT NULL, 
	chunk_bytes INTEGER NOT NULL, 
	received_bytes BIGINT NOT NULL, 
	status VARCHAR(20) NOT NULL, 
	error TEXT, 
	media_id VARCHAR(36), 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(match_id) REFERENCES matches (id) ON DELETE CASCADE
);

CREATE INDEX ix_uploads_owner_id ON uploads (owner_id);
CREATE INDEX ix_uploads_match_id ON uploads (match_id);

CREATE TABLE findings (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	match_id VARCHAR(36) NOT NULL, 
	analysis_id VARCHAR(36), 
	origin VARCHAR(10) NOT NULL, 
	module VARCHAR(30), 
	category VARCHAR(30) NOT NULL, 
	error_type VARCHAR(20), 
	severity VARCHAR(10) NOT NULL, 
	phase VARCHAR(10), 
	t_start FLOAT NOT NULL, 
	t_end FLOAT, 
	title VARCHAR(200) NOT NULL, 
	what_happened TEXT NOT NULL, 
	why_error TEXT, 
	what_to_do TEXT, 
	how_to_avoid TEXT, 
	evidence JSONB NOT NULL, 
	confidence FLOAT, 
	review_status VARCHAR(12) NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(match_id) REFERENCES matches (id) ON DELETE CASCADE, 
	FOREIGN KEY(analysis_id) REFERENCES analyses (id) ON DELETE CASCADE
);

CREATE INDEX ix_findings_owner_id ON findings (owner_id);
CREATE INDEX ix_findings_analysis_id ON findings (analysis_id);
CREATE INDEX ix_findings_match_id ON findings (match_id);

CREATE TABLE frames (
	id VARCHAR(36) NOT NULL, 
	owner_id VARCHAR(36) NOT NULL, 
	analysis_id VARCHAR(36) NOT NULL, 
	label VARCHAR(16) NOT NULL, 
	t FLOAT NOT NULL, 
	segment_index INTEGER NOT NULL, 
	reason VARCHAR(30) NOT NULL, 
	storage_key VARCHAR(500) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(analysis_id) REFERENCES analyses (id) ON DELETE CASCADE
);

CREATE INDEX ix_frames_analysis_id ON frames (analysis_id);
CREATE INDEX ix_frames_owner_id ON frames (owner_id);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE frames ENABLE ROW LEVEL SECURITY;
