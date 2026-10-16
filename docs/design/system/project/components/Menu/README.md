菜单：右键和 ⋯ 打开同一份菜单，贴着触发点出现，放不下就翻到另一侧。

## 结构

`<div class="ss-menu" id="m-x" hidden>` 里放 `ss-menu__item` 按钮。

- 图标在前，快捷键放 `ss-menu__end`。
- 单选项：`role="menuitemradio"`、`aria-checked`，末尾放 `<i data-i="check" class="ss-menu__check"></i>`。
- 分组标题 `ss-menu__label`，分隔线 `ss-menu__sep`。
- 不能用的项：`aria-disabled="true"`，文字里写原因，如「归档（运行中不能归档）」。
- 危险项 `ss-menu__item--danger`，放在最后一组。
- 说明型菜单项 `ss-menu__item--rich`，里面放 `ss-menu__text`（名称 + `ss-menu__desc` 一句后果）。
- 触发：按钮写 `data-menu="#m-x"`，行写 `data-ctx="#m-x"`（右键）。位置用 `data-place` 指定，默认 `bottom-start`。

## 规则

- 一次只开一个菜单。↑ ↓ 移动，Enter 选择，Esc 关闭并把焦点还给触发按钮。
- 应用里禁用浏览器自带的右键菜单，只在输入框和选中的文字上保留。
- 菜单项写动作，两到六个字；需要输入的项结尾加「…」。
