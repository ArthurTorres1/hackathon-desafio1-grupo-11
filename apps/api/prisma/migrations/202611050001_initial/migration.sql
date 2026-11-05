-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "state" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "data_provenance" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "roles" TEXT[],

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'BR',
    "state" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "declared_property" TEXT NOT NULL,
    "geometry" JSONB NOT NULL,
    "geometry_hash" TEXT NOT NULL,
    "geometry_version" INTEGER NOT NULL DEFAULT 1,
    "geometry_date" DATE NOT NULL,
    "area_ha" DECIMAL(20,6) NOT NULL,
    "geoid" TEXT,
    "data_provenance" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "origin_lots" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "plot_id" UUID NOT NULL,
    "species_common" TEXT NOT NULL,
    "species_scientific" TEXT NOT NULL,
    "authorized_volume_m3" DECIMAL(20,6) NOT NULL,
    "harvested_volume_m3" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "right_of_use" TEXT NOT NULL,
    "data_provenance" JSONB NOT NULL,
    "assessment_scope" TEXT NOT NULL DEFAULT 'DEMONSTRATIVO',
    "created_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "origin_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permits" (
    "id" UUID NOT NULL,
    "origin_lot_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "issuing_authority" TEXT NOT NULL,
    "official_system" TEXT NOT NULL,
    "document_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "volume_m3" DECIMAL(20,6) NOT NULL,
    "data_provenance" JSONB NOT NULL,

    CONSTRAINT "permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "fiscal_key" TEXT,
    "content_type" TEXT NOT NULL,
    "data_provenance" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "allowed_organization_ids" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harvests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "origin_lot_id" UUID NOT NULL,
    "species" TEXT NOT NULL,
    "volume_m3" DECIMAL(20,6) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "tag" TEXT NOT NULL,
    "document_ids" TEXT[],
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "harvests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balances" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "available_m3" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "reserved_m3" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "quarantined_m3" DECIMAL(20,6) NOT NULL DEFAULT 0,

    CONSTRAINT "balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_movements" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "volume_m3" DECIMAL(20,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "carrier" TEXT NOT NULL,
    "origin_state" TEXT NOT NULL,
    "destination_state" TEXT NOT NULL,
    "route_states" TEXT[],
    "official_system" TEXT NOT NULL,
    "document_ids" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "declared_at" TIMESTAMP(3) NOT NULL,
    "dispatched_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "dispatched_by_user_id" UUID,
    "received_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "volume_m3" DECIMAL(20,6) NOT NULL,
    "received_volume_m3" DECIMAL(20,6),

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformations" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "conversion_parameter_id" UUID NOT NULL,
    "residue_m3" DECIMAL(20,6) NOT NULL,
    "loss_m3" DECIMAL(20,6) NOT NULL,
    "assessment_scope" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transformations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformation_inputs" (
    "id" UUID NOT NULL,
    "transformation_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "volume_m3" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "transformation_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_lots" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "transformation_id" UUID NOT NULL,
    "product" TEXT NOT NULL,
    "species_common" TEXT NOT NULL,
    "species_scientific" TEXT NOT NULL,
    "volume_m3" DECIMAL(20,6) NOT NULL,
    "assessment_scope" TEXT NOT NULL,
    "data_provenance" JSONB NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_provenance" (
    "id" UUID NOT NULL,
    "product_lot_id" UUID NOT NULL,
    "origin_lot_id" UUID,
    "input_lot_id" UUID,
    "volume_m3" DECIMAL(20,6) NOT NULL,
    "fraction" DECIMAL(24,18) NOT NULL,

    CONSTRAINT "lot_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_parameters" (
    "id" UUID NOT NULL,
    "input_product" TEXT NOT NULL,
    "output_product" TEXT NOT NULL,
    "coefficient" DECIMAL(12,9) NOT NULL,
    "regulation_reference" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "data_provenance" TEXT NOT NULL,

    CONSTRAINT "conversion_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversion_exceptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "conversion_parameter_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "coefficient" DECIMAL(12,9) NOT NULL,
    "issuing_authority" TEXT NOT NULL,
    "approval_reference" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "data_provenance" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "rule_id" TEXT NOT NULL,
    "rule_version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "regulation_reference" TEXT,
    "source" JSONB NOT NULL,
    "modality" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "technical_severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "suggested_action" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "assessment_scope" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_cases" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "rule_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_decisions" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "evidence_ids" TEXT[],
    "conversion_exception_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_operation_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_operation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "product_lot_id" UUID NOT NULL,
    "volume_m3" DECIMAL(20,6) NOT NULL,
    "document_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "pending_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custody_events" (
    "event_id" UUID NOT NULL,
    "stream_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "previous_hash" TEXT,
    "event_hash" TEXT NOT NULL,

    CONSTRAINT "custody_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "stream_heads" (
    "stream_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "event_hash" TEXT,

    CONSTRAINT "stream_heads_pkey" PRIMARY KEY ("stream_id")
);

-- CreateTable
CREATE TABLE "passports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "product_lot_id" UUID NOT NULL,
    "public_token" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "snapshot_heads" JSONB NOT NULL,
    "assessment_scope" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_bundles" (
    "id" UUID NOT NULL,
    "passport_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "status_code" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_id" TEXT,
    "allowed" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "access_mode" TEXT NOT NULL,
    "requires_auth" BOOLEAN NOT NULL,
    "spatial_coverage" TEXT NOT NULL,
    "time_coverage" TEXT NOT NULL,
    "update_frequency" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "fields_used" TEXT[],
    "integration_status" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "limitations" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_queries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "geometry_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "result_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "http_status" INTEGER,
    "provider_version" TEXT NOT NULL,
    "assessment_scope" TEXT NOT NULL,
    "data_provenance" TEXT NOT NULL,
    "failure_reason" TEXT,
    "job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_requirements" (
    "id" UUID NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "official_system" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "article" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "coverage" TEXT NOT NULL,
    "required_evidence" JSONB NOT NULL,
    "resolution_criteria" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,
    "checked_by" TEXT NOT NULL,

    CONSTRAINT "regulatory_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_assessments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "coverage" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regulatory_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "previous_version" INTEGER NOT NULL,
    "new_version" INTEGER NOT NULL,
    "previous_data" JSONB NOT NULL,
    "corrected_data" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_organization_id_role_key" ON "memberships"("user_id", "organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "origin_lots_code_key" ON "origin_lots"("code");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "documents_fiscal_key_key" ON "documents"("fiscal_key");

-- CreateIndex
CREATE UNIQUE INDEX "balances_lot_id_organization_id_key" ON "balances"("lot_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_lots_code_key" ON "product_lots"("code");

-- CreateIndex
CREATE INDEX "checks_entity_id_idx" ON "checks"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "custody_events_stream_id_sequence_key" ON "custody_events"("stream_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "passports_public_token_key" ON "passports"("public_token");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_operation_key_key" ON "idempotency_keys"("user_id", "operation", "key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "origin_lots" ADD CONSTRAINT "origin_lots_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permits" ADD CONSTRAINT "permits_origin_lot_id_fkey" FOREIGN KEY ("origin_lot_id") REFERENCES "origin_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformation_inputs" ADD CONSTRAINT "transformation_inputs_transformation_id_fkey" FOREIGN KEY ("transformation_id") REFERENCES "transformations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_transformation_id_fkey" FOREIGN KEY ("transformation_id") REFERENCES "transformations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_decisions" ADD CONSTRAINT "audit_decisions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "audit_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

