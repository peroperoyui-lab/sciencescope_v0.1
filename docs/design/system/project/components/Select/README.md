自定义下拉选择：一个触发按钮加一份菜单，不使用浏览器原生的下拉框。

## 结构

`<button class="ss-select" type="button" aria-haspopup="menu" data-menu="#m-x"><span class="ss-select__value" data-slot="value">当前值</span><i data-i="chevron-down"></i></button>`

菜单里每一项用 `role="menuitemradio"`、`aria-checked` 和 `data-label`；选中后 `data-label` 自动写回触发按钮的 `data-slot="value"`。

- `ss-select--ghost`：页头里的范围选择、工具条里的排序，平时没有边框。
- `ss-select--sm`：紧凑位置。
- 前面可以放一个图标说明用途（文件夹表示范围，上下箭头表示排序）。

## 规则

- 两到四个选项、需要一眼看到全部时，用 SegmentedControl。
- 固定宽度的选择器里，值靠左，箭头靠右。
- 选项按使用频率或自然顺序排列，当前项打勾。
