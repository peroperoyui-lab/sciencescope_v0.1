// Settings → 运行环境 → 总是允许的操作: the rules saved from 总是允许 on an
// approval card, grouped by the project (or single chat) they apply to. A rule
// is only listed and removed here; new ones come from the card.
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { InfoTip } from './info-tip.js';

const TOOLS = {
  shell: { icon: 'square-terminal', name: '运行命令' },
  write_file: { icon: 'file-pen', name: '写入文件' },
  edit_file: { icon: 'file-diff', name: '修改文件' },
  python_env_install: { icon: 'package', name: '安装包' },
};

/** The same wording the approval card offered. @param {any} rule */
function scopeOf(rule) {
  if (rule.kind === 'prefix') return { title: t('以 {prefix} 开头的命令', { prefix: rule.value }) };
  if (rule.kind === 'package') return { title: t('安装 {package}', { package: rule.value }) };
  if (rule.kind === 'any') return { title: t('所有安装包') };
  if (rule.kind === 'server') return { title: t('这个服务器的所有工具') };
  if (rule.kind === 'folder')
    return { title: t('这个文件夹里的文件（含子文件夹）'), value: rule.value };
  return {
    title: rule.tool === 'shell' ? t('这条命令（完全一致）') : t('这个文件'),
    value: rule.value,
  };
}

export function ApprovalRulesSettings() {
  const actions = useActions();
  const rules = useAppState((state) => state.settings?.approvals?.rules ?? []);
  const projects = useAppState((state) => state.projects);
  const meetings = useAppState((state) => state.meetings);
  const servers = useAppState((state) => state.settings?.mcp?.servers ?? []);
  const groups = new Map();
  for (const rule of rules) {
    const key = rule.projectId ?? `meeting:${rule.meetingId}`;
    if (!groups.has(key)) {
      const name = rule.projectId
        ? (projects.find((project) => project.id === rule.projectId)?.name ?? t('已删除的项目'))
        : t('单独对话 · {title}', {
            title: meetings.find((meeting) => meeting.id === rule.meetingId)?.title ?? '—',
          });
      groups.set(key, { name, rules: [] });
    }
    groups.get(key).rules.push(rule);
  }
  const remove = (id) =>
    actions.attempt(() =>
      actions.updateSettings({ approvals: { rules: rules.filter((rule) => rule.id !== id) } }),
    );

  return html`<section class="ss-setting-section" data-settings="approval-rules">
    <div class="ss-setting-section__head">
      <h3 class="ss-setting-section__title">
        ${t('总是允许的操作')}<${InfoTip}
          text=${t('在批准卡片上选「总是允许」后记在这里。规则只在定下它的项目里生效；不属于项目的对话，只管那个对话。删掉后，同类操作会重新询问。')}
        />
      </h3>
    </div>
    ${
      rules.length
        ? html`<div class="ss-list">
            ${[...groups.values()].map(
              (group) =>
                html`<div class="ss-list__group" key=${group.name}>${group.name}</div>
                  ${group.rules.map((rule) => {
                    const tool =
                      rule.kind === 'server'
                        ? {
                            icon: 'server',
                            name:
                              servers.find((server) => server.id === rule.value)?.name ??
                              t('已删除的 MCP 服务器'),
                          }
                        : (TOOLS[rule.tool] ?? { icon: 'wrench', name: rule.tool });
                    const scope = scopeOf(rule);
                    return html`<div
                      class=${`ss-list-row ${scope.value ? 'ss-list-row--2' : ''}`}
                      key=${rule.id}
                      data-rule=${rule.id}
                    >
                      <${Lucide} name=${tool.icon} class="ss-list-row__icon" />
                      <span class="ss-list-row__main">
                        <span class="ss-list-row__title">${t(tool.name)} · ${scope.title}</span>
                        ${
                          scope.value &&
                          html`<span class="ss-list-row__sub ss-mono" title=${scope.value}
                            >${scope.value}</span
                          >`
                        }
                      </span>
                      <span class="ss-list-row__meta"
                        >${new Date(rule.createdAt).toLocaleDateString()}</span
                      >
                      <span class="ss-list-row__actions">
                        <button
                          type="button"
                          class="ss-icon-btn ss-icon-btn--sm"
                          aria-label=${t('删除这条规则')}
                          data-tip=${t('删除这条规则')}
                          onClick=${() => remove(rule.id)}
                        >
                          <${Lucide} name="trash-2" />
                        </button>
                      </span>
                    </div>`;
                  })}`,
            )}
          </div>`
        : html`<p class="ss-muted">${t('还没有规则。')}</p>`
    }
  </section>`;
}
