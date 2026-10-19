export const version = 21;
export const name = 'remove-automation';

/**
 * Retired automation conversations become ordinary conversations; their
 * messages and unrelated policy choices stay intact.
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`UPDATE meetings
    SET policy_json = json_set(policy_json, '$.mode', 'direct')
    WHERE json_extract(policy_json, '$.mode') = 'autonomous';
    UPDATE meetings SET policy_json = json_remove(policy_json, '$.goal')
    WHERE json_type(policy_json, '$.goal') IS NOT NULL;
    DROP TABLE meeting_goals;`);
}
