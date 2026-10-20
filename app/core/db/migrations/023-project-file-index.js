// File identity belongs to the catalog; copies and parser projections can be rebuilt.
export const version = 23;
export const name = 'project-file-index';

/**
 * @param {{exec:(sql:string)=>void}} db
 */
export function up(db) {
  db.exec(`
    ALTER TABLE rb_sources ADD COLUMN file_size INTEGER;
    ALTER TABLE rb_sources ADD COLUMN file_mtime_ms REAL;
    ALTER TABLE rb_sources ADD COLUMN content_hash TEXT;
  `);
}
