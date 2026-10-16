设置行：左边是名称和一句说明，右边是控件；改了立即生效，不需要保存按钮。

## 结构

- 分区 `ss-setting-section`：`ss-setting-section__head` 里放 `ss-setting-section__title`，旁边可以加 ⓘ，或在右侧放一个轻按钮。
- 每一行 `ss-setting-row` 分左右两部分：
  - 左边 `ss-setting-row__text`：`ss-setting-row__label`，加一句可选的说明 `ss-setting-row__desc`；
  - 右边 `ss-setting-row__control`。

## 选控件

| 设置的类型 | 控件 |
|---|---|
| 开或关 | 开关 `ss-switch` |
| 两到四个选项 | SegmentedControl |
| 更多选项 | Select（固定宽度，值靠左） |
| 有范围的比例 | Slider |
| 带单位的时长 | 小号 Select，列出常用值，如「无响应时停止 60 秒」 |
| 一次性动作，如清理缓存、导出 | 默认按钮 |

## 规则

- 每个设置都要有保存的值和真正用到它的地方；没做完的设置不显示。
- 改了立即生效，不放「保存」或「应用」按钮。需要重启才生效的，在说明里写明。
- 说明写改了以后会怎样，如「关掉后，启动时停在新对话页」，不要重复名称。
- 名称不超过十个字。一行只放一个控件。
