// Settings → 工具 (design system PageSettingsTools): every tool the roles
// share, grouped by where it comes from, from `GET /api/tools`. Tools that ask
// first under 请求批准 carry a tag; only MCP tools can be switched off, which
// writes the server's `disabledTools`.
import { useEffect, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { Info } from './settings-models.js';

/** What each built-in tool does, for people; the model reads the English description. */
const DESCRIPTIONS = {
  shell: '在工作文件夹里运行命令（Windows 用 PowerShell）',
  read_file: '读取文本文件，可以按行读',
  write_file: '新建或覆盖文本文件',
  edit_file: '替换文件里的一处文字',
  list_files: '按通配符列出文件',
  grep_files: '用正则表达式搜索文件内容',
  web_fetch: '读取网页的文字',
  view_image: '查看图片或 PDF 某一页，可以放大局部',
  research_search: '在资料库里检索段落和条目',
  research_read: '读资料原文，保留页码和章节',
  workspace_read: '读项目、对话、纪要、计划、导图、日志',
  workspace_edit: '修改计划、导图、日志、纪要和笔记，留历史版本',
  workspace_undo: '撤销一次修改',
  workspace_versions: '查看或恢复历史版本',
  workspace_present: '把生成的文件交付到回答下方',
  python_env_install: '往对话的 Python 环境里装包',
  propose_main_draft: '秘书起草给主对话的指令，由你决定是否发送',
  use_skill: '读取一个技能的正文并照着做',
};
/** Rows a section shows before 还有 N 个, unless a search or filter is on. */
const SHOWN = 6;
const FILTERS = [
  ['all', '全部'],
  ['ask', '会先问'],
  ['off', '已停用'],
];

/**
 * @param {{ title: string, rows: any[], folded: boolean, head?: any,
 *   empty?: any, onSwitch?: (tool: any, on: boolean) => void }} props
 */
function Section({ title, rows, folded, head, empty, onSwitch }) {
  const [open, setOpen] = useState(false);
  const shown = folded && !open ? rows.slice(0, SHOWN) : rows;
  if (!rows.length && !empty) return null;
  return html`<section class="ss-setting-section" data-tools=${title}>
    <div class="ss-setting-section__head">
      <h3 class="ss-setting-section__title">
        ${title}<span class="ss-count">${rows.length}</span>
      </h3>
      ${head}
      ${
        folded &&
        rows.length > SHOWN &&
        html`<button type="button" class="ss-linkbtn" onClick=${() => setOpen(!open)}>
          ${open ? t('收起') : t('还有 {n} 个', { n: rows.length - SHOWN })}
        </button>`
      }
    </div>
    ${
      rows.length
        ? html`<div class="ss-list">
            ${shown.map(
              (tool) =>
                html`<div
                  key=${tool.name}
                  class=${`ss-list-row ss-list-row--2 ${tool.enabled ? '' : 'ss-list-row--done'}`}
                  data-tool=${tool.name}
                >
                  <span class="ss-list-row__main">
                    <span class="ss-list-row__title ss-mono">${tool.tool ?? tool.name}</span>
                    <span class="ss-list-row__sub" title=${tool.description}>
                      ${DESCRIPTIONS[tool.name] ? t(DESCRIPTIONS[tool.name]) : tool.description}
                    </span>
                  </span>
                  ${
                    tool.needsApproval &&
                    html`<span class="ss-tag" data-tip=${t('在「请求批准」下，调用前先问你')}
                      ><${Lucide} name="shield-question-mark" />${t('会先问')}</span
                    >`
                  }
                  ${
                    onSwitch &&
                    html`<input
                      type="checkbox"
                      role="switch"
                      class="ss-switch"
                      aria-label=${t('启用 {name}', { name: tool.tool ?? tool.name })}
                      checked=${tool.enabled}
                      onChange=${(event) => onSwitch(tool, event.currentTarget.checked)}
                    />`
                  }
                </div>`,
            )}
          </div>`
        : empty
    }
  </section>`;
}

export function ToolsPage() {
  const actions = useActions();
  const [tools, setTools] = useState(/** @type {any[] | null} */ (null));
  const [servers, setServers] = useState(/** @type {any[]} */ ([]));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const load = () =>
    actions.attempt(async () => {
      const [nextTools, nextServers] = await Promise.all([
        actions.listTools(),
        actions.listMcpServers(),
      ]);
      setTools(nextTools.filter((tool) => tool.source !== 'skill'));
      setServers(nextServers);
    });
  useEffect(() => {
    void load();
  }, []);
  if (!tools) return html`<p role="status">${t('正在读取…')}</p>`;

  const words = query.trim().toLowerCase();
  const matches = (tool) =>
    (!words ||
      `${tool.tool ?? tool.name} ${tool.description} ${t(DESCRIPTIONS[tool.name] ?? '')}`
        .toLowerCase()
        .includes(words)) &&
    (filter === 'all' || (filter === 'ask' ? tool.needsApproval : !tool.enabled));
  const folded = !words && filter === 'all';
  const of = (source) => tools.filter((tool) => tool.source === source && matches(tool));
  const ours = of('sciencescope');
  const skillTools = ours.filter((tool) => tool.name === 'use_skill');
  const switchTool = (tool, on) =>
    actions.attempt(async () => {
      const server = servers.find((entry) => entry.id === tool.server);
      const disabledTools = on
        ? server.disabledTools.filter((name) => name !== tool.tool)
        : [...server.disabledTools, tool.tool];
      await actions.saveMcpServer({ disabledTools }, server.id);
      await load();
    });
  const toMcp = html`<button
    type="button"
    class="ss-btn ss-btn--ghost ss-btn--sm"
    onClick=${() => navigate({ view: 'settings', id: 'mcp' })}
  >
    <${Lucide} name="server" />${t('管理服务器')}
  </button>`;

  return html`<div class="ss-settings__inner" data-settings="tools">
    <h2 class="ss-settings__title">
      ${t('工具')}<${Info}
        text=${t('专家、秘书和全局助手共用这一套工具，每次发言时随请求发给模型。内置和 ScienceScope 自己的工具不能关；MCP 服务器的工具可以逐个停用。')}
      />
    </h2>
    <p class="ss-settings__desc">
      ${t('共 {n} 个工具。在「请求批准」下，标「会先问」的工具调用前先问你。', {
        n: tools.length,
      })}
    </p>
    <div class="ss-settings__toolbar">
      <label class="ss-input ss-input--sm" style="width:240px">
        <${Lucide} name="search" small />
        <input
          type="search"
          placeholder=${t('搜索工具')}
          aria-label=${t('搜索工具')}
          value=${query}
          onInput=${(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <span class="ss-toolbar__spacer"></span>
      <div class="ss-seg ss-seg--sm" role="group" aria-label=${t('显示')}>
        ${FILTERS.map(
          ([id, label]) =>
            html`<button
              type="button"
              key=${id}
              aria-pressed=${String(filter === id)}
              onClick=${() => setFilter(id)}
            >
              ${t(label)}
            </button>`,
        )}
      </div>
    </div>
    <${Section} title=${t('内置')} rows=${of('builtin')} folded=${false} />
    <${Section}
      title="ScienceScope"
      rows=${ours.filter((tool) => tool.name !== 'use_skill')}
      folded=${folded}
    />
    <${Section}
      title=${t('技能')}
      rows=${skillTools}
      folded=${false}
      head=${html`<button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        onClick=${() => navigate({ view: 'settings', id: 'skills' })}
      >
        <${Lucide} name="graduation-cap" />${t('管理技能')}
      </button>`}
    />
    ${servers
      .filter((server) => server.enabled)
      .map((server) => {
        const rows = tools.filter((tool) => tool.server === server.id && matches(tool));
        const connected = server.status === 'connected';
        if (!connected && (words || filter !== 'all')) return null;
        return html`<${Section}
          key=${server.id}
          title=${server.name}
          rows=${rows}
          folded=${folded}
          onSwitch=${switchTool}
          head=${html`<span
              class=${`ss-provider__status ${connected ? '' : 'ss-provider__status--danger'}`}
              ><span class=${`ss-dot ${connected ? 'ss-dot--ok' : 'ss-dot--danger'}`}></span
              >${connected ? t('MCP · 已连接') : t('MCP · 连接失败')}</span
            >${!connected && toMcp}`}
          empty=${html`<p class="ss-muted">
            ${connected ? t('这个服务器没有提供工具。') : server.error}
          </p>`}
        />`;
      })}
  </div>`;
}
