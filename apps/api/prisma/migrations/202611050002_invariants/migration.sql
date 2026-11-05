CREATE EXTENSION IF NOT EXISTS postgis;

-- FKs adicionais: os UUIDs polimórficos de lote são verificados separadamente.
DO $$
DECLARE t text; c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['memberships','plots','origin_lots','documents','harvests','balances','balance_movements','transformations','product_lots','conversion_exceptions','checks','audit_cases','pending_operation_requests','passports','source_queries','regulatory_assessments','corrections'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT', t, t || '_organization_fkey');
  END LOOP;
  FOREACH t IN ARRAY ARRAY['plots','origin_lots','documents','harvests','shipments','transformations','product_lots','conversion_exceptions','audit_cases','pending_operation_requests','passports','corrections','sales'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT', t, t || '_author_fkey');
  END LOOP;
  FOREACH c IN ARRAY ARRAY['sender_id','recipient_id'] LOOP
    EXECUTE format('ALTER TABLE shipments ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES organizations(id) ON DELETE RESTRICT', 'shipments_' || c || '_fkey', c);
  END LOOP;
  FOREACH c IN ARRAY ARRAY['seller_id','buyer_id'] LOOP
    EXECUTE format('ALTER TABLE sales ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES organizations(id) ON DELETE RESTRICT', 'sales_' || c || '_fkey', c);
  END LOOP;
END $$;

ALTER TABLE memberships ADD CONSTRAINT memberships_user_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE permits ADD CONSTRAINT permits_document_fkey FOREIGN KEY (document_id) REFERENCES documents(id);
ALTER TABLE documents ADD CONSTRAINT documents_supersedes_fkey FOREIGN KEY (supersedes_id) REFERENCES documents(id);
ALTER TABLE harvests ADD CONSTRAINT harvests_lot_fkey FOREIGN KEY (origin_lot_id) REFERENCES origin_lots(id);
ALTER TABLE transformations ADD CONSTRAINT transformations_parameter_fkey FOREIGN KEY (conversion_parameter_id) REFERENCES conversion_parameters(id);
ALTER TABLE lot_provenance ADD CONSTRAINT lot_provenance_product_fkey FOREIGN KEY (product_lot_id) REFERENCES product_lots(id);
ALTER TABLE lot_provenance ADD CONSTRAINT lot_provenance_origin_fkey FOREIGN KEY (origin_lot_id) REFERENCES origin_lots(id);
ALTER TABLE conversion_exceptions ADD CONSTRAINT conversion_exceptions_parameter_fkey FOREIGN KEY (conversion_parameter_id) REFERENCES conversion_parameters(id);
ALTER TABLE conversion_exceptions ADD CONSTRAINT conversion_exceptions_document_fkey FOREIGN KEY (document_id) REFERENCES documents(id);
ALTER TABLE audit_cases ADD CONSTRAINT audit_cases_check_fkey FOREIGN KEY (check_id) REFERENCES checks(id);
ALTER TABLE audit_decisions ADD CONSTRAINT audit_decisions_reviewer_fkey FOREIGN KEY (reviewer_user_id) REFERENCES users(id);
ALTER TABLE audit_decisions ADD CONSTRAINT audit_decisions_exception_fkey FOREIGN KEY (conversion_exception_id) REFERENCES conversion_exceptions(id);
ALTER TABLE sales ADD CONSTRAINT sales_product_fkey FOREIGN KEY (product_lot_id) REFERENCES product_lots(id);
ALTER TABLE sales ADD CONSTRAINT sales_document_fkey FOREIGN KEY (document_id) REFERENCES documents(id);
ALTER TABLE passports ADD CONSTRAINT passports_product_fkey FOREIGN KEY (product_lot_id) REFERENCES product_lots(id);
ALTER TABLE custody_events ADD CONSTRAINT custody_events_actor_fkey FOREIGN KEY (actor_id) REFERENCES users(id);
ALTER TABLE evidence_bundles ADD CONSTRAINT evidence_bundles_passport_fkey FOREIGN KEY (passport_id) REFERENCES passports(id);
ALTER TABLE evidence_bundles ADD CONSTRAINT evidence_bundles_user_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_keys_user_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE source_queries ADD CONSTRAINT source_queries_source_fkey FOREIGN KEY (source_id) REFERENCES sources(id);
ALTER TABLE source_queries ADD CONSTRAINT source_queries_lot_fkey FOREIGN KEY (lot_id) REFERENCES origin_lots(id);

ALTER TABLE plots ADD CONSTRAINT plots_area_positive CHECK (area_ha > 0 AND geometry_version > 0);
ALTER TABLE origin_lots ADD CONSTRAINT origin_lots_volume_valid CHECK (authorized_volume_m3 > 0 AND harvested_volume_m3 >= 0 AND harvested_volume_m3 <= authorized_volume_m3);
ALTER TABLE origin_lots ADD CONSTRAINT origin_lots_period_valid CHECK (valid_from <= valid_until);
ALTER TABLE permits ADD CONSTRAINT permits_valid CHECK (volume_m3 > 0 AND valid_from <= valid_until);
ALTER TABLE harvests ADD CONSTRAINT harvests_valid CHECK (volume_m3 > 0 AND period_start <= period_end);
ALTER TABLE balances ADD CONSTRAINT balances_non_negative CHECK (available_m3 >= 0 AND reserved_m3 >= 0 AND quarantined_m3 >= 0);
ALTER TABLE balance_movements ADD CONSTRAINT balance_movements_positive CHECK (volume_m3 > 0);
ALTER TABLE shipment_items ADD CONSTRAINT shipment_items_positive CHECK (volume_m3 > 0 AND (received_volume_m3 IS NULL OR received_volume_m3 >= 0));
ALTER TABLE shipments ADD CONSTRAINT shipments_dates CHECK ((dispatched_at IS NULL OR dispatched_at >= declared_at) AND (received_at IS NULL OR (dispatched_at IS NOT NULL AND received_at >= dispatched_at)));
ALTER TABLE transformations ADD CONSTRAINT transformations_valid CHECK (residue_m3 >= 0 AND loss_m3 >= 0 AND version > 0);
ALTER TABLE transformation_inputs ADD CONSTRAINT transformation_inputs_positive CHECK (volume_m3 > 0);
ALTER TABLE product_lots ADD CONSTRAINT product_lots_positive CHECK (volume_m3 > 0 AND version > 0);
ALTER TABLE lot_provenance ADD CONSTRAINT lot_provenance_valid CHECK (volume_m3 > 0 AND fraction > 0 AND fraction <= 1 AND (input_lot_id IS NULL OR input_lot_id <> product_lot_id));
ALTER TABLE conversion_parameters ADD CONSTRAINT conversion_parameters_valid CHECK (coefficient > 0 AND coefficient <= 1 AND (valid_until IS NULL OR valid_from <= valid_until));
ALTER TABLE conversion_exceptions ADD CONSTRAINT conversion_exceptions_valid CHECK (coefficient > 0 AND coefficient <= 1 AND valid_from <= valid_until);
ALTER TABLE sales ADD CONSTRAINT sales_positive CHECK (volume_m3 > 0);
ALTER TABLE custody_events ADD CONSTRAINT custody_events_valid CHECK (sequence > 0 AND event_hash ~ '^[0-9a-f]{64}$' AND (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$'));
ALTER TABLE passports ADD CONSTRAINT passports_valid CHECK (version > 0 AND content_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE evidence_bundles ADD CONSTRAINT evidence_bundles_duration CHECK (duration_ms >= 0);
ALTER TABLE documents ADD CONSTRAINT documents_hash_valid CHECK (content_hash ~ '^[0-9a-f]{64}$' AND version > 0);
ALTER TABLE checks ADD CONSTRAINT checks_result_valid CHECK (status IN ('PASSOU','ALERTA','PENDENTE','NAO_AVALIADO'));
ALTER TABLE audit_cases ADD CONSTRAINT audit_cases_status_valid CHECK (status IN ('ABERTO','EM_ANALISE','RESOLVIDO_COM_EVIDENCIA','REJEITADO','MANTIDO_PENDENTE'));
ALTER TABLE audit_decisions ADD CONSTRAINT audit_decisions_evidence CHECK (length(trim(comment)) > 0 AND (decision <> 'RESOLVIDO_COM_EVIDENCIA' OR cardinality(evidence_ids) > 0));

DO $$
DECLARE t text; c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','plots','shipments'] LOOP
    FOREACH c IN ARRAY CASE WHEN t='shipments' THEN ARRAY['origin_state','destination_state'] ELSE ARRAY['state'] END LOOP
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IN (''AC'',''AL'',''AP'',''AM'',''BA'',''CE'',''DF'',''ES'',''GO'',''MA'',''MT'',''MS'',''MG'',''PA'',''PB'',''PR'',''PE'',''PI'',''RJ'',''RN'',''RS'',''RO'',''RR'',''SC'',''SP'',''SE'',''TO''))', t, t || '_' || c || '_valid', c);
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION foresttrace_lot_exists() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM origin_lots WHERE id=NEW.lot_id) AND NOT EXISTS (SELECT 1 FROM product_lots WHERE id=NEW.lot_id) THEN
    RAISE EXCEPTION 'Referenced lot does not exist' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER balances_lot_exists BEFORE INSERT OR UPDATE ON balances FOR EACH ROW EXECUTE FUNCTION foresttrace_lot_exists();
CREATE TRIGGER shipment_items_lot_exists BEFORE INSERT OR UPDATE ON shipment_items FOR EACH ROW EXECUTE FUNCTION foresttrace_lot_exists();
CREATE TRIGGER transformation_inputs_lot_exists BEFORE INSERT OR UPDATE ON transformation_inputs FOR EACH ROW EXECUTE FUNCTION foresttrace_lot_exists();

CREATE FUNCTION foresttrace_product_has_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM custody_events WHERE entity_id=NEW.transformation_id AND type='TRANSFORMATION_RECORDED') THEN
    RAISE EXCEPTION 'Output lot requires transformation creation event' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER product_lot_creation_event AFTER INSERT ON product_lots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION foresttrace_product_has_event();

-- O administrador continua capaz de alterar registros: limite explicitado na documentação.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='foresttrace_app') THEN
    GRANT USAGE ON SCHEMA public TO foresttrace_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO foresttrace_app;
    REVOKE UPDATE, DELETE ON custody_events, balance_movements, audit_decisions, checks, corrections, access_logs, idempotency_keys FROM foresttrace_app;
    REVOKE ALL ON _prisma_migrations FROM foresttrace_app;
    REVOKE CREATE ON SCHEMA public FROM foresttrace_app;
  END IF;
END $$;
