BEGIN;
CREATE TYPE "RegulatoryCoverage" AS ENUM ('CONFIRMADA','PENDENTE_DE_VERIFICACAO','CONFLITANTE');
ALTER TABLE regulatory_requirements DROP CONSTRAINT regulatory_requirements_coverage_valid;
ALTER TABLE regulatory_assessments DROP CONSTRAINT regulatory_assessments_valid;
ALTER TABLE regulatory_requirements ALTER COLUMN coverage TYPE "RegulatoryCoverage" USING coverage::"RegulatoryCoverage";
ALTER TABLE regulatory_assessments ALTER COLUMN coverage TYPE "RegulatoryCoverage" USING coverage::"RegulatoryCoverage";
ALTER TABLE regulatory_assessments ADD CONSTRAINT regulatory_assessments_valid CHECK (
  version > 0 AND jsonb_typeof(requirements) = 'array' AND jsonb_typeof(gaps) = 'array'
  AND (coverage <> 'CONFIRMADA' OR (requirements <> '[]'::jsonb AND gaps = '[]'::jsonb))
);
ALTER TABLE regulatory_requirements DROP CONSTRAINT regulatory_requirements_jurisdiction_valid;
ALTER TABLE regulatory_requirements ADD CONSTRAINT regulatory_requirements_jurisdiction_valid CHECK
  (jurisdiction IN ('BR','AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'));
ALTER TABLE regulatory_requirements ADD COLUMN supersedes_id uuid UNIQUE
  REFERENCES regulatory_requirements(id) ON DELETE RESTRICT;
ALTER TABLE regulatory_requirements ADD CONSTRAINT regulatory_requirements_no_self_version CHECK (supersedes_id IS NULL OR supersedes_id <> id);
ALTER TABLE regulatory_requirements ADD CONSTRAINT regulatory_requirements_evidence_array CHECK (jsonb_typeof(required_evidence) = 'array');
ALTER TABLE regulatory_assessments ADD COLUMN context jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE regulatory_assessments ADD COLUMN context_hash text;
ALTER TABLE regulatory_assessments ADD COLUMN created_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE regulatory_assessments ADD CONSTRAINT regulatory_assessments_context_hash_valid CHECK (context_hash IS NULL OR context_hash ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX regulatory_requirements_version_key ON regulatory_requirements
  (jurisdiction, phase, product, modality, official_system, source_url, article, version);
CREATE UNIQUE INDEX regulatory_assessments_version_key ON regulatory_assessments(organization_id, entity_type, entity_id, version);
COMMIT;
