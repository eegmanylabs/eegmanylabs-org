# #EEGManyLabs Hub: data model

This document is the authoritative specification of the portal's relational model. The Drizzle schema in `portal/src/server/db/schema/` implements it, and the SQL migrations in `portal/drizzle/` are generated from that schema. When the two disagree, the schema and migrations describe what is deployed and this document must be corrected in the same change.

## 1. Conventions

Every table uses a `uuid` primary key named `id` with a `gen_random_uuid()` default, except the authentication tables owned by the authentication library, which keep the identifier type that library requires. Foreign keys to users therefore use the authentication library's identifier type. All timestamps are `timestamptz` stored in UTC. Mutable tables carry `created_at` and `updated_at`, and tables edited by people also carry `created_by` and `updated_by`. Major entities are archived through `archived_at` and are never hard deleted, because provenance, audit and historical reporting depend on their continued existence.

Human-readable stable identifiers sit beside the primary key. A replication has an immutable `study_key` such as `AmodioJost2007`, a laboratory and a person each have a unique `slug`, a dataset has a `dataset_key`, and a group has a `group_key`. Routes accept either the UUID or the stable identifier.

Enumerations that administrators may reconfigure (statuses, count categories, checklist templates) are rows in lookup tables. Enumerations that are technical and fixed are PostgreSQL enums. Free-text values that arrive from a source are always stored verbatim in a `*_source` or `raw_*` column, and any standardised interpretation is stored beside it in a separate column, so that an original value is never lost or silently rewritten.

Each fact-like record declares where it came from through a `data_origin` enum with the values `live`, `imported_historical`, `demo` and `projected`. The user interface labels the last three wherever they appear. Missing numeric values are stored as SQL `NULL` or as an absent row and are never coerced to zero.

Sensitive attributes live in their own tables or columns with an explicit classification so that the authorisation layer can enforce field-level rules. The classifications are `public` (approved for the public website), `member` (visible to signed-in members), `restricted` (contact details, outreach history, private notes) and `special` (gender and ethnicity).

## 2. Identity, access and claiming

| Table | Purpose and key columns |
|---|---|
| `user`, `session`, `account`, `verification`, `two_factor` | Owned by the authentication library. A user is a login identity. A user is distinct from a person record. |
| `persons` | One row per human known to the programme, whether or not they have signed in. `slug`, `given_name`, `middle_name`, `family_name`, `display_name`, `orcid`, `country_code`, `country_source`, `headshot_filename`, `scholar_url`, `university_url`, `lab_url`, `is_core_team`, `public_listing` (`none`, `member`, `core_team`), `user_id` (unique, null until claimed), `claimed_at`, `data_origin`, `archived_at`. |
| `person_emails` | `person_id`, `email` (stored lower-cased and trimmed), `kind` (`primary`, `secondary`, `historical`), `source_record_id`, `verified_at`, `is_claim_eligible`. Classification `restricted`. An index on `email` supports claim matching. The same address may appear on more than one person as a data error, which the claim flow treats as an ambiguous match that requires review. |
| `person_demographics` | One row per person, classification `special`. `gender_source`, `gender_category`, `gender_self_described`, `ethnicity_source`, `ethnicity_category`, `ethnicity_self_described`, `source_record_id`, `recorded_at`, `updated_by`. Original source terms are preserved verbatim and standardised categories are optional. Every read through the service layer is audited. |
| `institutions` | `name`, `short_name`, `country_code`, `city`, `ror_id`, `website`. Unique on normalised name and country. |
| `affiliations` | `person_id`, `institution_id` (nullable), `laboratory_id` (nullable), `affiliation_source` (verbatim text), `role_title`, `is_primary`, `start_date`, `end_date`, `source_record_id`. A person may hold several. |
| `role_assignments` | `user_id`, `role` (`programme_admin`, `core_team`, `replication_lead`, `lab_coordinator`, `lab_member`, `external_collaborator`), `scope_type` (`programme`, `replication`, `laboratory`, `group`), `scope_id`, `status` (`pending_approval`, `active`, `revoked`, `expired`), `granted_by`, `granted_at`, `expires_at`, `revoked_by`, `revoked_at`, `reason`. Unique on the active combination of user, role and scope. |
| `role_capabilities` | Administrator-configurable matrix: `role`, `capability`, `allowed`. Defaults are defined in code and this table stores overrides, which is how sensitive operations are restricted for the core team. |
| `capability_grants` | Named capability granted to one user, for example `demographics.read`, with `granted_by`, `reason`, `expires_at`, `revoked_at`. |
| `groups`, `group_members` | Replication-level and laboratory-level workspaces with a stable `group_key`. `kind` (`replication_team`, `lab_team`, `working_group`, `custom`), optional `replication_id` and `laboratory_id`. Members are users with a `role_in_group`. Groups receive permissions as principals. Individual attribution is always retained. |
| `external_accounts` | Mapping from a person, group, laboratory or replication to an account name in an external system (`cloud`, `bids`, `eegnet`, `sftp`, `osf`, `github`, `google`, `quire`). Stores the account identifier and never a secret. |
| `invitations` | `email`, `person_id` (nullable), intended role and scope, `token_hash`, `expires_at`, `accepted_at`, `invited_by`, `revoked_at`. |
| `account_claims` | `user_id`, `person_id`, `status` (`pending_review`, `approved`, `rejected`, `withdrawn`), `match_basis` (`primary_email`, `secondary_email`, `invitation`, `manual`), `evidence` (JSON), `reviewed_by`, `reviewed_at`, `decision_note`. |
| `lab_claims` | `laboratory_id`, `user_id`, `requested_role` (`coordinator`, `representative`), `evidence` (JSON, including affiliation match and institutional email domain), `status`, `reviewed_by`, `reviewed_at`, `decision_note`. |
| `correction_requests` | A member's request to correct an imported record: `user_id`, `entity_type`, `entity_id`, `field`, `proposed_value`, `message`, `status`, `resolved_by`, `resolved_at`. |

## 3. Programme, laboratories and equipment

| Table | Purpose and key columns |
|---|---|
| `programmes` | `key`, `name`, `description`, `parent_id`, `kind` (`programme`, `subproject`). Spin-off projects such as the resting-state and alpha asymmetry subprojects are children of the main programme. |
| `laboratories` | One authoritative profile per laboratory or institutional unit. `slug`, `name`, `institution_id`, `department`, `country_code`, `city`, `address` (restricted), `website`, `pi_person_id`, `status` (`unverified`, `active`, `inactive`), `description`, `data_origin`, `archived_at`. |
| `laboratory_members` | `laboratory_id`, `person_id`, `role` (`pi`, `coordinator`, `representative`, `member`), `is_authorised_representative`, `start_date`, `end_date`, `status`. Several authorised representatives are allowed. |
| `equipment_configurations` | Several per laboratory, with history. `laboratory_id`, `name`, `is_current`, `valid_from`, `valid_to`, `eeg_system_source` (verbatim), `amplifier_manufacturer`, `amplifier_model`, `cap_type`, `electrode_type`, `channel_count`, `sampling_rates_hz` (integer array), `reference_scheme`, `trigger_method`, `presentation_software`, `stimulus_computer`, `display_refresh_hz`, `eye_tracker`, `response_devices`, `other` (JSON), `notes`. An edit to a current configuration closes the old row and opens a new one, which preserves history. |
| `equipment_requirements` | Per replication: `replication_id`, `requirement_key`, `operator`, `value`, `is_mandatory`, `note`. Compatibility is computed by comparing these with a laboratory's current configuration. |

## 4. Replications and scientific definition

| Table | Purpose and key columns |
|---|---|
| `replications` | `programme_id`, `study_key` (immutable, unique), `short_title`, original study fields (`original_authors`, `original_year`, `original_title`, `original_reference`, `original_doi`), citation verification (`citation_status` of `unverified`, `verified`, `mismatch`, `not_found`, with `citation_checked_at`, `citation_source`, `citation_metadata` JSON), `abstract`, `rationale`, `effect_of_interest`, `plain_language_description`, `original_n`, `original_statistics`, `original_effect_size_source`, `original_effect_size_value`, `original_effect_size_metric`, `original_bayes_factor_source`, `power_assumptions`, `power_based_n`, `target_n`, `duration_source`, `sample_type`, `min_eeg_channels`, `extra_equipment`, `study_type`, `outcome`, `psych_construct`, `theme`, `status_id`, public stage fields (`public_stage_number`, `public_stage_name`, `public_stage_text`), `signup_url`, `signup_active`, `selection_status` (`selected`, `shortlisted`, `ranked_candidate`, `withdrawn`), `data_origin`, `archived_at`. |
| `study_aliases` | `replication_id`, `alias`, `scheme` (`programme`, `website`, `cloud_account`, `bids`, `eegnet`, `source_tab`, `other`), `explanation`, `part_1`, `part_2`, `is_canonical`, `source_record_id`. Unique on scheme and alias. Existing identifiers are never renamed. |
| `replication_memberships` | `replication_id`, `person_id`, `role` (`lead`, `co_lead`, `former_lead`, `coordinator`, `analyst`, `member`, `advisor`), `is_current`, `start_date`, `end_date`, `review_status` (`confirmed`, `needs_review`), `source_record_id`. Conflicting leads from different sources are all stored with `needs_review` and a reconciliation item is raised. |
| `status_definitions` | Configurable statuses for any entity type: `entity_type`, `key`, `label`, `category` (`not_started`, `active`, `done`, `paused`, `cancelled`), `position`, `is_default`, `archived_at`. Seeded for replications with proposed, planning, recruiting labs, site preparation, collecting, collection complete, processing, analysing, writing, submitted, published, paused and archived. |
| `status_history` | `entity_type`, `entity_id`, `from_status_id`, `to_status_id`, `effective_at`, `recorded_at`, `changed_by`, `reason`, `source`. The pair of effective and recorded times allows a past status to be reconstructed. |
| `hypotheses` | `replication_id`, `hypothesis_number` (verbatim), `text`, `expected_effect`, `outcome_measure`, `analysis_specification`, `preregistration_url`, `original_statistics`, `null_sig_source` (verbatim), `replicated_source` (verbatim, an unverified historical label), `scientific_review_status` (`unverified`, `under_review`, `verified`), `analysis_status`, `result_summary`, `result_reviewed_by`, `result_reviewed_at`, `study_description_url`, `infosheet_url`, `source_record_id`. |
| `prediction_market_items` | Survey and market questions linked to a hypothesis or to the programme: `hypothesis_id`, `question_text`, `choices`, `source_record_id`. |
| `protocols`, `protocol_versions` | A protocol belongs to a replication. A version has `version_label`, `effective_date`, `status` (`draft`, `approved`, `superseded`), `change_summary`, `document_link_id`, `approved_by`, `approved_at`. |
| `protocol_acknowledgements`, `protocol_deviations` | Per participation: acknowledgement of a version by a person at a time, and deviations with `description`, `severity`, `occurred_at`, `reported_by`, `corrective_action`, `status`. |
| `vocabulary_terms` | Community vocabulary: `source_id` (original identifier), `name`, `abbreviation`, `description`, `invalid_reason`, `same_as_source` (verbatim), `same_as_term_id`, `kind`, `is_deprecated`, `source_record_id`. |
| `replication_vocabulary` | Links a replication to vocabulary terms, for example its questionnaires, with a `relation` and a note. |

## 5. Laboratory participation in a replication

A laboratory and its participation in one replication are separate records. Project-specific details live on the participation and laboratory-wide facts live on the laboratory.

| Table | Purpose and key columns |
|---|---|
| `participations` | Unique on `replication_id` and `laboratory_id`. `local_lead_person_id`, `status` (`invited`, `interested`, `confirmed`, `onboarding`, `ready`, `collecting`, `collection_complete`, `withdrawn`, `declined`), `ethics_status` (`unknown`, `not_started`, `submitted`, `approved`, `not_required`), `ethics_reference`, `ethics_approved_at`, `training_status`, `readiness_status`, `readiness_approved_by`, `readiness_approved_at`, `target_n_main`, `target_n_rest`, `protocol_version_id`, `equipment_configuration_id`, `equipment_override_justification`, `signed_up_at`, `data_origin`. |
| `participation_members` | People at the laboratory who work on this replication, with a role. |
| `checklist_templates`, `checklist_template_items` | Administrator-configurable templates, seeded with the onboarding checklist (participation confirmation, verified contacts, equipment confirmation, ethics, protocol review, training, technical checks, pilot, readiness approval). |
| `checklist_items` | Instantiated per participation: `participation_id`, `template_item_key`, `label`, `status` (`not_started`, `in_progress`, `done`, `not_applicable`, `blocked`), `completed_by`, `completed_at`, `evidence_url`, `note`, `position`. |
| `outreach_contacts` | Historical recruitment correspondence, classification `restricted`. `replication_id`, `laboratory_id` (nullable), `person_id` (nullable), `lab_name_source`, `contact_name_source`, `contact_email`, `contacted_at_source`, `response_source`, `status_source`, `notes`, `source_record_id`. |

## 6. Recruitment

Recruitment is recorded as append-only reports. A report never overwrites an earlier one. A correction is a new report that points at the report it corrects.

| Table | Purpose and key columns |
|---|---|
| `count_categories` | `key`, `label`, `definition`, `position`, `is_core`, `replication_id` (null for global). Seeded with target, planned, scheduled, recruited, tested, recorded, submitted, received, validated, usable and excluded, each with an explicit definition. Replication-specific extensions set `replication_id`. |
| `recruitment_reports` | `participation_id`, `as_of_date` (the date for which the counts hold), `period_start`, `period_end`, `report_kind` (`cumulative`, `period`), `basis` (`lab_reported`, `centrally_verified`), `entry_kind` (`new`, `correction`), `corrects_report_id`, `reported_by`, `verified_by`, `verified_at`, `source` (`manual`, `import`, `sheet_sync`), `data_origin`, `note`, `created_at`. |
| `recruitment_counts` | `report_id`, `category_id`, `modality` (`main`, `rest`, `participants`), `value` (integer, not null). An absent row means the value is unknown. The `participants` modality counts unique people, which prevents a person who contributed both a main-experiment and a resting-state recording from being counted twice. A total number of participants is never derived by adding `main` and `rest`. |
| `recruitment_exclusions` | `report_id`, `modality`, `reason_term_id`, `reason_source`, `count`. |
| `planned_pauses` | `participation_id`, `starts_on`, `ends_on`, `reason`. |
| `historical_aggregates` | Replication-level figures imported from historical workbooks and kept apart from live counts: `replication_id`, `metric_key` (for example `n_labs_signed`, `total_n_to_be_run`, `n_labs_finished`, `total_n_main_collected`, `total_n_rest`), `value_source` (verbatim), `value_numeric`, `snapshot_date`, `source_record_id`. |
| `forecast_runs` | `replication_id`, `generated_at`, `generated_by`, `method_version`, `assumptions` (JSON), `scenarios` (JSON with optimistic, central and conservative results and intervals), `inputs_as_of`. Always `data_origin = projected`. |

The state of recruitment at any past date is the latest cumulative report per participation, category, modality and basis whose `as_of_date` is on or before that date. Restricting additionally on `created_at` reproduces what the portal knew at that time.

## 7. Tasks and project oversight

| Table | Purpose and key columns |
|---|---|
| `task_lists` | A project list, optionally tied to a programme, replication or laboratory, or personal to one user. `name`, `kind`, `owner_user_id`, `scope_type`, `scope_id`, `source_system`, `source_id`, `archived_at`. |
| `tasks` | `list_id`, `parent_id`, `position` (text fractional index), `kind` (`task`, `milestone`), `title`, `description` (rich text JSON), `status_id`, `priority` (`none`, `low`, `medium`, `high`, `urgent`), `start_at`, `due_at`, `completed_at`, `estimate_minutes`, `progress_percent`, `recurrence_rule` (RFC 5545 text), `recurrence_source_task_id`, `created_by`, `source_system`, `source_id`, `source_url`, `archived_at`. Nesting is by `parent_id` with a service-level guard against cycles. |
| `task_participants` | `task_id`, `user_id` or `person_id`, `role` (`assignee`, `collaborator`, `follower`). |
| `task_dependencies` | `task_id`, `depends_on_task_id`, `kind` (`finish_to_start`, `start_to_start`, `finish_to_finish`, `blocks`). Unique pair, self-reference forbidden, cycles rejected in the service. |
| `task_links` | `task_id`, `entity_type`, `entity_id`. A task may link to several research entities. |
| `task_checklist_items` | `task_id`, `label`, `is_done`, `position`. |
| `tags`, `entity_tags` | Shared tags applied to tasks and other entities. |
| `reminders` | `user_id`, `entity_type`, `entity_id`, `remind_at`, `sent_at`, `channel`. |

## 8. Workspace: pages, databases and views

| Table | Purpose and key columns |
|---|---|
| `pages` | Every major entity is a page. `parent_page_id`, `entity_type` and `entity_id` (set when the page is the body of an entity), `kind` (`custom`, `entity`, `meeting`, `report`, `decision`, `template`), `title`, `icon`, `position`, `is_template`, `access_mode` (`inherit`, `restricted`), `plain_text`, `created_by`, `last_edited_by`, `archived_at`. |
| `page_documents` | `page_id`, `snapshot` (bytea, merged Yjs state), `state_vector` (bytea), `update_seq`, `updated_at`. |
| `page_updates` | Append-only Yjs updates awaiting compaction: `page_id`, `seq`, `update` (bytea), `user_id`, `client_id`, `created_at`. |
| `page_versions` | `page_id`, `snapshot` (bytea), `label`, `kind` (`auto`, `manual`, `restore`), `created_by`, `created_at`. Restoring a version writes a new forward change. |
| `page_permissions` | `page_id`, `principal_type` (`user`, `group`, `role`), `principal_id`, `level` (`view`, `comment`, `edit`, `full`). |
| `favourites`, `recents` | Per user, referencing any entity. |
| `comment_threads`, `comments` | A thread attaches to any entity and optionally to an anchor (a block identifier or a field). Comments have `author_id`, `body` (rich text JSON), `edited_at`, `deleted_at`. Threads have `resolved_at` and `resolved_by`. |
| `mentions` | `source_type`, `source_id`, `mentioned_user_id`, `created_by`, `created_at`. |
| `attachments` | `entity_type`, `entity_id`, `storage_key`, `filename`, `content_type`, `size_bytes`, `sha256`, `uploaded_by`. Files are stored through a storage adapter (local disk in development, object storage in production). |
| `custom_databases` | User-created databases: `name`, `description`, `icon`, `parent_page_id`, `created_by`, `archived_at`. Addressed as the collection `db:<id>`. |
| `properties` | Property definitions for a collection, which is either a custom database or a core entity type that accepts custom properties. `collection_key`, `key`, `name`, `type` (`text`, `rich_text`, `number`, `date`, `date_range`, `email`, `url`, `checkbox`, `person`, `status`, `select`, `multi_select`, `file`, `relation`, `rollup`, `formula`, `created_time`, `edited_time`, `created_by`, `edited_by`), `config` (JSON: options, relation target, rollup specification, formula expression, number format), `position`, `archived_at`. |
| `database_rows` | Rows of custom databases: `database_id`, `title`, `values` (JSON keyed by property id), `position`, `page_id`, authorship columns, `archived_at`. |
| `property_values` | Custom property values on core entities: `property_id`, `entity_type`, `entity_id`, `value` (JSON). Unique on property and entity. |
| `relation_links` | Normalised storage for relation properties: `property_id`, `from_type`, `from_id`, `to_type`, `to_id`. Supports rollups and backlinks. |
| `views` | `collection_key` (for example `core:replications`, `core:participations`, `core:tasks`, `db:<id>`), `name`, `type` (`table`, `list`, `board`, `calendar`, `timeline`, `gallery`), `config` (JSON: filter tree, sorts, grouping, visible properties, column order and widths, card layout, date properties), `scope` (JSON, a fixed filter such as one replication), `owner_user_id` (set for personal views), `is_shared`, `page_id`, `position`. |
| `dashboards`, `dashboard_widgets` | A dashboard belongs to the programme, a replication, a laboratory or a user. Widgets have a `type` (`view`, `kpi`, `chart`, `timeline`, `calendar`, `activity`, `note`, `embed`), a `config` and a grid position and size. |

Core scientific collections keep strict typed columns. The collection registry in code describes which built-in fields each collection exposes to views and which collections accept custom properties. A linked view on any page queries the one authoritative table, so a record edited in one place is the same record everywhere.

## 9. Datasets and distributed storage

The portal is a registry of where data lives. It does not require raw EEG to be transferred to a central store.

| Table | Purpose and key columns |
|---|---|
| `storage_endpoints` | `key`, `name`, `institution_id`, `protocol` (`sftp`, `ftps`, `filesystem`, `s3`, `webdav`, `gin`, `osf`, `other`), `host`, `port`, `base_path`, `owner_person_id`, `credential_ref` (the name of a secret held in the secret store), `status` (`active`, `unreachable`, `retired`), `last_checked_at`, `last_check_result`. |
| `datasets` | `dataset_key`, `replication_id`, `laboratory_id`, `participation_id`, `title`, `modality` (`main`, `rest`, `mixed`), `grouping_label`, `protocol_version_id`, `expected_file_count`, `expected_participants`, `received_at`, `size_bytes`, `workflow_status_id`, `bids_status` (`not_started`, `in_progress`, `invalid`, `valid`), `bids_version`, `bids_report` (JSON), `qc_status` (`not_started`, `pending`, `passed`, `flagged`, `failed`), `analysis_ready`, `metadata` (JSON), `data_origin`. |
| `dataset_storage_refs` | Several per dataset. `dataset_id`, `endpoint_id`, `role` (`primary`, `mirror`, `backup`, `processing_copy`), `uri`, `availability` (`available`, `unavailable`, `unknown`), `verified_at`, `valid_from`, `valid_to`, `relocated_from_ref_id`. |
| `file_manifests`, `manifest_files` | A manifest is a listing of a storage reference at a time, from a scan, an upload or manual entry. Files carry `relative_path`, `size_bytes`, `checksum_algorithm`, `checksum`, `modified_at` and a comparison `status` (`expected`, `present`, `missing`, `unexpected`, `duplicate`). |
| `data_transfers` | `dataset_id`, `from_ref_id`, `to_ref_id`, `status` (`initiated`, `in_progress`, `completed`, `failed`, `verified`), `initiated_by`, timestamps, `bytes_transferred`, `error`, `verification_manifest_id`. |
| `qc_assessments` | `dataset_id`, `level` (`dataset`, `recording`), `recording_label`, `assessed_by`, `tool`, `tool_version`, `pipeline_version`, `parameters` (JSON), `outcome` (`pass`, `flag`, `fail`), `metrics` (JSON), `exclusions`, `notes`, `assessed_at`. |
| `processing_runs`, `processing_run_inputs` | Preprocessing and analysis runs with `kind`, `pipeline_name`, `code_url`, `code_commit`, `version`, `parameters`, `environment`, `status`, `started_at`, `finished_at`, `run_by`, output links and reproducibility notes. Inputs link to datasets. |
| `dataset_access_events` | Who viewed storage paths or requested a viewer link, and when. |
| `viewer_links` | Optional links to a viewer such as ElectroTag: `dataset_id`, `tool`, `url`, `created_by`. Entirely optional and never required for access. |

## 10. Scientific outputs and governance records

| Table | Purpose and key columns |
|---|---|
| `manuscripts` | `replication_id` (nullable), `website_publication_id`, `title`, `kind` (`stage1_rr`, `stage2_rr`, `preprint`, `article`, `data_paper`, `software`, `other`), `status`, `journal`, `doi`, `preprint_doi`, `osf_url`, `authors_short`, `submitted_at`, `accepted_at`, `published_at`, `citation_status`, `citation_metadata`. |
| `manuscript_events` | Review rounds, decisions, revisions and submissions with dates and linked documents. |
| `contributor_tables` | From the membership workbook: `replication_id`, `table_url`, `is_only_signup_table`, `is_published`, `publication_url`, `pdf_url`, `source_record_id`. |
| `contributors` | `replication_id`, `manuscript_id` (nullable), `contributor_table_id`, `person_id` (nullable), verbatim name parts, `order_in_publication`, `affiliation_source`, `email` (restricted), `orcid`, `agreement_source`, `funding_statement`, `review_status`, `source_record_id`. |
| `contributor_roles` | `contributor_id`, `credit_role` (the 14 CRediT roles), `value_source` (verbatim cell value). |
| `decisions`, `risks`, `incidents` | Methodological decision log, risk register and incident registry, each scoped to the programme or a replication, each with an owner, a status, dates and a linked page. |
| `meetings`, `meeting_attendees` | Meeting pages with agenda and notes held in the page body, attendees, and action items created as linked tasks. |
| `progress_reports` | Scope, period, linked page, linked generated document and status. |
| `document_links` | Any external document attached to any entity: `entity_type`, `entity_id`, `kind` (`google_doc`, `google_sheet`, `drive_folder`, `osf`, `github`, `pdf`, `form`, `url`), `url`, `external_id`, `title`, `access_status` (`unknown`, `public`, `restricted`, `unreachable`), `http_status`, `last_checked_at`, `owner_name`, `modified_at`, `source_record_id`. |

## 11. Provenance, migration and integrations

| Table | Purpose and key columns |
|---|---|
| `sources` | The source registry. `key`, `name`, `kind` (`google_sheet`, `drive_file`, `repository_tsv`, `quire`, `osf`, `other`), `url`, `external_id`, `owner`, `authority` (`historical`, `live`, `reference`), `sync_policy` (`one_off`, `scheduled_pull`, `two_way`), `cadence`, `access_status`, `last_fetched_at`, `notes`. |
| `source_tabs` | `source_id`, `name` (verbatim), `visibility` (`visible`, `hidden`, `very_hidden`), `header_row`, `row_count`, `importer_key`, `last_seen_at`. |
| `import_batches` | `source_id`, `mode` (`preview`, `apply`), `status` (`running`, `previewed`, `applied`, `failed`, `rolled_back`), `content_hash`, `started_by`, `started_at`, `finished_at`, `stats` (JSON), `log` (JSON). |
| `source_records` | Immutable raw rows. `source_id`, `tab`, `row_key` (stable identity derived from natural keys, never from the row number alone), `row_number`, `raw` (JSON of original values and formulas), `raw_hash`, `first_seen_batch_id`, `last_seen_batch_id`. Unique on source, tab, row key and hash. |
| `record_links` | Provenance from a source record to an entity: `source_record_id`, `entity_type`, `entity_id`, `relation` (`created`, `updated`, `matched`), `fields`. |
| `import_changes` | Every write made by a batch, with `before` and `after`, which makes a batch reversible. |
| `reconciliation_items` | The human review queue. `kind` (`duplicate_person`, `conflicting_lead`, `ambiguous_laboratory`, `value_conflict`, `unmatched_identifier`, `ambiguous_email`), entity references, `candidates` (JSON with source references), `status` (`open`, `resolved`, `dismissed`), `resolution`, `resolved_by`, `resolved_at`, `batch_id`, `fingerprint` (unique, so a re-import does not raise the same item twice). |
| `integration_mappings` | Identifier of an entity in an external system: `entity_type`, `entity_id`, `system`, `external_id`, `external_url`. Unique on system, external identifier and entity type. |
| `integration_connections` | `system`, `status`, `config` (non-secret JSON), `credential_ref`, `last_success_at`, `last_error`, `last_error_at`. |
| `sync_mappings` | `connection_id`, `spreadsheet_id`, `tab`, `collection_key`, `key_strategy`, `column_map` (JSON with a direction per field: `app_authoritative`, `sheet_authoritative`, `bidirectional`, `generated`), `enabled`. |
| `sync_cell_state` | The last value synchronised for each mapped cell on both sides, which is the base of the three-way comparison that prevents feedback loops. |
| `sync_runs`, `sync_conflicts` | Run history with attempts and errors, and conflicts holding the base, application and sheet values until an authorised user resolves them. |
| `generated_documents` | `template_key`, entity reference, `external_document_id`, `managed_sections` (JSON of named ranges), `last_generated_at`, `last_revision_id`, `status`. |
| `publication_batches` | The public publishing log: `kind`, `payload`, `diff`, `status` (`draft`, `previewed`, `staged`, `approved`, `published`, `rolled_back`), `requested_by`, `approved_by`, `commit_ref`, `pull_request_url`. |

## 12. Events, audit, automation and notifications

| Table | Purpose and key columns |
|---|---|
| `audit_events` | Append-only. `actor_user_id`, `actor_kind` (`user`, `system`, `import`, `sync`, `automation`), `action`, `entity_type`, `entity_id`, `changes` (JSON of field, before and after, with special-category values replaced by a marker), `context` (JSON: request identifier, hashed IP address, user agent), `created_at`. Updates and deletes are blocked by a trigger. |
| `domain_events` | Transactional outbox consumed by automations, notifications, synchronisation and search indexing. `type`, `entity_type`, `entity_id`, `payload`, `actor_user_id`, `origin`, `correlation_id`, `causation_id`, `depth`, `created_at`, `processed_at`. |
| `automation_rules` | `name`, `enabled`, `trigger_type` (`record_created`, `record_updated`, `status_changed`, `schedule`, `manual`), `trigger_config`, `conditions`, `actions`, `scope_type`, `scope_id`, `created_by`. |
| `automation_runs` | `rule_id`, `event_id`, `idempotency_key` (unique), `status`, `attempts`, `log`, `error`, `started_at`, `finished_at`. Loop prevention uses the event `depth` and `origin`. |
| `notifications` | `user_id`, `type`, `entity_type`, `entity_id`, `payload`, `created_at`, `read_at`, `emailed_at`. |
| `notification_preferences` | Per user: channel settings, digest frequency, quiet hours and per-type switches. |
| `subscriptions` | `user_id`, `entity_type`, `entity_id`, `level`. |
| `email_outbox` | `to_address`, `subject`, `text_body`, `html_body`, `template_key`, `status`, `attempts`, `sent_at`, `error`. In development, messages stay in this table and are shown in a development mailbox. |
| `scheduled_reports` | `name`, `definition`, `schedule`, `recipients`, `last_run_at`, `enabled`. |
| `search_documents` | `entity_type`, `entity_id`, `title`, `body`, `tsv` (generated `tsvector` with a GIN index), `scope` (JSON used for permission filtering), `updated_at`. |

## 13. Integrity rules enforced by the database

Foreign keys are declared for every reference to a first-class table, with `ON DELETE RESTRICT` as the default and `ON DELETE CASCADE` only for pure child rows such as checklist items, counts and manifest files. Polymorphic references (`entity_type` with `entity_id`) are validated in the service layer and covered by integration tests. Unique constraints protect natural keys: replication `study_key`, laboratory `slug`, person `slug`, participation pair, alias within a scheme, source record identity, reconciliation fingerprint and automation idempotency key. Check constraints protect ranges such as non-negative counts and `progress_percent` between 0 and 100. Indexes exist on every foreign key and on the columns used for filtering in the main views.
