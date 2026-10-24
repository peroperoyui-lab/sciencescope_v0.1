// Settings → 执行与批准 (design system PageSettingsApprovals): the execution
// mode new chats start in, and the rules saved from 总是允许 on an approval
// card, grouped by the project (or single chat) they apply to. A rule is only
// listed and removed here; new ones come from the card.
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Head, Row, Section, Seg, useSetting } from './settings-kit.js';

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

function ApprovalRules() {
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

  return html`<${Section}
    title=${t('总是允许的操作')}
    count=${rules.length}
    attrs=${{ 'data-settings': 'approval-rules' }}
  >
    <p class="ss-settings__desc" style="margin:0 0 8px">
      ${t('在批准卡片上选「总是允许」后记在这里，只在当时的项目或对话里生效。删掉一条，下次就再问你。')}
    </p>
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
  <//>`;
}

export function ApprovalsPage() {
  const [mode, write] = useSetting((settings) => settings.approvals?.defaultApproval ?? 'ask');
  return html`<div class="ss-settings__inner" data-settings="approvals">
    <${Head} title=${t('执行与批准')} />
    <${Section}
      title=${t('执行方式')}
      tip=${t('每个对话还能在输入框底栏单独切换，只对那个对话有效。')}
    >
      <${Row}
        label=${t('新对话默认')}
        desc=${t('请求批准：运行命令、写项目文件夹、安装软件包之前先问你。常规：不问，直接执行，每一步都在时间线上看得见')}
      >
        <${Seg}
          label=${t('新对话默认')}
          small=${false}
          value=${mode}
          options=${[
            ['ask', t('请求批准')],
            ['auto', t('常规')],
          ]}
          onChange=${(next) => write({ approvals: { defaultApproval: next } })}
        />
      <//>
    <//>
    <${ApprovalRules} />
  </div>`;
}
