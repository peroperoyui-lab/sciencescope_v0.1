单行和多行输入框，配上方标签、下方提示和错误文字。

## 结构

- 单行：`<span class="ss-input"><i data-i="search"></i><input placeholder="…" /></span>`，小号加 `ss-input--sm`。
- 多行：`<textarea class="ss-textarea"></textarea>`。
- 表单字段：`<label class="ss-field">` 里依次放 `ss-field__label`、输入框、`ss-field__hint` 或 `ss-field__error`。

## 规则

- 标签写在上方，不用占位符代替标签。占位符用 `muted`，写例子或用途。
- 错误写在输入框下方，说清怎么改，如「地址要以 https:// 开头」，不写「格式错误」。
- 密钥用 `type="password"`，提示写「只保存在本机的密钥文件里」；保存后不再回显密钥。
- 上下文长度、输出上限这类数字不让用户填，由程序自动获取。
