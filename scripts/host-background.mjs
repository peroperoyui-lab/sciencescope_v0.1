/** Version import jobs; summary-policy owns every automatic minutes trigger. */
export function subscribeHostBackground({events, organizer, workbench, modelFor}) {
  const off = [];
  off.push(events.on('version.stored', async ({projectId, versionId, model}) => {
    if (!organizer) return;
    const snapshot = await workbench.get(projectId);
    const selected = model ?? await modelFor?.(projectId);
    if (!snapshot.autoOrganize || !selected) return;
    await organizer.organize({projectId, versionId, model:selected});
    void events.emit('workbench.changed', {projectId});
  }));
  return () => off.forEach(unsubscribe => unsubscribe());
}
