连续数值的滑块，当前值显示在右侧。

## 结构

`<span class="ss-slider"><input type="range" min="50" max="95" step="5" value="80" data-unit="%" /><output>80%</output></span>`

拖动时 `output` 自动更新，已选部分用 `accent` 填充。

## 规则

- 只用于有明确范围、拖动就能理解的值，如上下文压缩门槛。
- 不用上下小箭头微调数字；需要精确数字的值（上下文长度、最长输出）不让用户填，自动获取。
- 步长取整，标签写清单位。
