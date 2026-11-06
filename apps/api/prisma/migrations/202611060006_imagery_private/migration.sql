BEGIN;
CREATE TABLE imagery_queries (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plot_id uuid REFERENCES plots(id) ON DELETE RESTRICT,
  geometry jsonb NOT NULL, geometry_hash text NOT NULL, geometry_version integer,
  context_provenance jsonb NOT NULL, filters jsonb NOT NULL, request_hash text NOT NULL,
  adapter_version text NOT NULL, snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
  status text NOT NULL, http_status integer, failure_reason text, page integer NOT NULL DEFAULT 1,
  next_cursor text UNIQUE, next_request jsonb,
  queried_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at timestamp(3) NOT NULL,
  CONSTRAINT imagery_queries_valid CHECK (
    geometry_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$' AND snapshot_hash ~ '^[0-9a-f]{64}$'
    AND page BETWEEN 1 AND 5 AND (geometry_version IS NULL OR geometry_version > 0)
    AND status IN ('SUCESSO','SEM_IMAGENS','INDISPONIVEL') AND expires_at >= queried_at
    AND (next_cursor IS NULL OR next_cursor ~ '^[0-9a-f]{64}$')
  )
);
CREATE TABLE plot_imagery_references (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plot_id uuid NOT NULL REFERENCES plots(id) ON DELETE RESTRICT,
  query_id uuid NOT NULL REFERENCES imagery_queries(id) ON DELETE RESTRICT,
  scene_key text NOT NULL, collection_id text NOT NULL, item_id text NOT NULL,
  geometry_hash text NOT NULL, geometry_version integer NOT NULL,
  snapshot jsonb NOT NULL, snapshot_hash text NOT NULL, attribution text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT plot_imagery_references_valid CHECK (geometry_version > 0
    AND geometry_hash ~ '^[0-9a-f]{64}$' AND snapshot_hash ~ '^[0-9a-f]{64}$' AND scene_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT plot_imagery_reference_scene_key UNIQUE(plot_id,geometry_version,query_id,scene_key)
);
CREATE INDEX imagery_queries_cache_idx ON imagery_queries(organization_id, request_hash, expires_at);
CREATE INDEX imagery_queries_plot_idx ON imagery_queries(organization_id, plot_id, geometry_hash);
CREATE INDEX plot_imagery_references_plot_idx ON plot_imagery_references(organization_id, plot_id, geometry_version);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='foresttrace_app') THEN
    GRANT SELECT, INSERT, DELETE ON imagery_queries TO foresttrace_app;
    REVOKE UPDATE ON imagery_queries FROM foresttrace_app;
    GRANT SELECT, INSERT ON plot_imagery_references TO foresttrace_app;
    REVOKE UPDATE, DELETE ON plot_imagery_references FROM foresttrace_app;
  END IF;
END $$;
COMMIT;
