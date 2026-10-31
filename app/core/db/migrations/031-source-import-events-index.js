export const version = 31;
export const name = 'source-import-events-index';

/**
 * @param {import('../database.js').Db} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`CREATE INDEX events_source_import ON events(
    json_extract(payload_json,'$.sourceId'),seq
  ) WHERE type='research.changed'
    AND json_extract(payload_json,'$.action')='source.imported'`);
}
