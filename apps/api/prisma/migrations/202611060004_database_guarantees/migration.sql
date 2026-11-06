-- Defense in depth for writes performed outside the HTTP validators.
BEGIN;
ALTER TABLE shipments ADD CONSTRAINT shipments_dispatch_author_fkey
  FOREIGN KEY (dispatched_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE shipments ADD CONSTRAINT shipments_receive_author_fkey
  FOREIGN KEY (received_by_user_id) REFERENCES users(id) ON DELETE RESTRICT;
-- Access logs intentionally retain unknown user identifiers from denied attempts.

CREATE FUNCTION foresttrace_valid_plot_geometry(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE g geometry;
BEGIN
  IF value->>'type' NOT IN ('Polygon', 'MultiPolygon') THEN RETURN false; END IF;
  g := ST_GeomFromGeoJSON(value::text);
  RETURN COALESCE(ST_SRID(g) = 4326 AND NOT ST_IsEmpty(g) AND ST_IsValid(g)
    AND ST_GeometryType(g) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND ST_XMin(Box3D(g)) >= -180 AND ST_XMax(Box3D(g)) <= 180
    AND ST_YMin(Box3D(g)) >= -90 AND ST_YMax(Box3D(g)) <= 90, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;
ALTER TABLE plots ADD CONSTRAINT plots_geometry_valid
  CHECK (foresttrace_valid_plot_geometry(geometry)) NOT VALID;
-- Existing declarations remain preserved for review; all new writes are checked.
-- After reviewing legacy rows: ALTER TABLE plots VALIDATE CONSTRAINT plots_geometry_valid;

ALTER TABLE shipments ADD CONSTRAINT shipments_route_states_valid CHECK (
  route_states IS NOT NULL AND array_position(route_states, NULL) IS NULL AND
  route_states <@ ARRAY['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']::text[]
);
ALTER TABLE regulatory_requirements ADD CONSTRAINT regulatory_requirements_jurisdiction_valid
  CHECK (jurisdiction IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'));
ALTER TABLE regulatory_requirements ADD CONSTRAINT regulatory_requirements_period_valid
  CHECK (valid_until IS NULL OR valid_from <= valid_until);
ALTER TABLE regulatory_requirements ADD CONSTRAINT regulatory_requirements_coverage_valid
  CHECK (coverage IN ('CONFIRMADA','PENDENTE_DE_VERIFICACAO','CONFLITANTE'));
ALTER TABLE regulatory_assessments ADD CONSTRAINT regulatory_assessments_valid CHECK (
  version > 0 AND coverage IN ('CONFIRMADA','PENDENTE_DE_VERIFICACAO','CONFLITANTE')
  AND jsonb_typeof(requirements) = 'array' AND jsonb_typeof(gaps) = 'array'
  AND (coverage <> 'CONFIRMADA' OR (requirements <> '[]'::jsonb AND gaps = '[]'::jsonb))
);

-- Snapshots and regulatory versions are append-only for the application role.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foresttrace_app') THEN
    REVOKE UPDATE, DELETE ON regulatory_requirements, regulatory_assessments,
      conversion_parameters, evidence_bundles FROM foresttrace_app;
    -- Passport grants can change without allowing snapshot contents to be rewritten.
    REVOKE UPDATE, DELETE ON passports FROM foresttrace_app;
    GRANT UPDATE (allowed_organization_ids) ON passports TO foresttrace_app;
  END IF;
END $$;

CREATE INDEX plots_organization_idx ON plots(organization_id);
CREATE INDEX origin_lots_plot_idx ON origin_lots(plot_id);
CREATE INDEX shipment_items_lot_idx ON shipment_items(lot_id);
CREATE INDEX transformation_inputs_lot_idx ON transformation_inputs(lot_id);
CREATE INDEX lot_provenance_origin_idx ON lot_provenance(origin_lot_id);
CREATE INDEX custody_events_entity_idx ON custody_events(entity_id, type);
CREATE INDEX regulatory_requirements_scope_idx
  ON regulatory_requirements(jurisdiction, phase, product, official_system, valid_from);
CREATE INDEX regulatory_assessments_entity_idx
  ON regulatory_assessments(entity_type, entity_id, version);
COMMIT;
