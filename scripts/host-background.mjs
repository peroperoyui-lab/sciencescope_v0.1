/** T17 compatibility subscriptions. T18 replaces the minutes subscription. */
export function subscribeHostBackground({events, minutes, organizer, workbench, modelFor}) {
  const off = [events.on('discussion.finished', ({chatId}) => minutes.schedule(chatId))];
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
