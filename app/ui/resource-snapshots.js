// Shared projections of durable resource snapshots and page-leave capture.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from './context.js';

export const RESOURCE_LABELS = { map: '导图', plans: '计划', log: '日志', minutes: '对话纪要' };
export const SOURCE_LABELS = {
  'leave-page': '离开页面时保存',
  'ai-turn-end': 'AI 发言结束时保存',
  'before-restore': '恢复前保存',
};

/** @param {{projectId?:string,resource?:string,key?:string,meetingId?:string,limit?:number}} query */
export function useSnapshots(query) {
  const actions = useActions();
  const version = useAppState((state) => state.snapshotsVersion);
  const [snapshots, setSnapshots] = useState([]);
  const signature = JSON.stringify(query);
  useEffect(() => {
    let current = true;
    actions
      .snapshots(query)
      .then((list) => current && setSnapshots(list))
      .catch((error) => actions.toast(error.message));
    return () => {
      current = false;
    };
  }, [signature, version]);
  return snapshots;
}

/** Capture final persisted content when an editing page/dialog is left.
 * @param {Array<[string,string]>} targets
 * @param {()=>Promise<any>|void} [beforeCapture]
 */
export function useSnapshotCapture(targets, beforeCapture) {
  const actions = useActions();
  const latest = useRef(beforeCapture);
  latest.current = beforeCapture;
  const signature = JSON.stringify(targets);
  useEffect(
    () => () => {
      void actions.attempt(async () => {
        await latest.current?.();
        await Promise.all(targets.map(([resource, key]) => actions.captureSnapshot(resource, key)));
      });
    },
    [signature],
  );
}
