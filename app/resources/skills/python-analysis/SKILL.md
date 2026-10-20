---
name: python-analysis
description: 用 Python 分析数据：确认环境、安装缺的包、写脚本运行、看结果和图。需要统计、作图、处理表格或复现分析时使用。
metadata:
  title: 用 Python 分析数据
---

# 用 Python 分析数据

每个对话都有一个受管的 Python 环境（默认是内置的「科学分析」环境，已有 pandas、numpy、scipy、statsmodels、matplotlib 等常用包）。命令行里的 `python` 就是这个环境，系统 Python 从不修改。

## 步骤

1. **先看数据。** 用 `list_files` 找到文件，用 `read_file` 看前几十行，或者跑一小段脚本打印列名、类型、行数、缺失值。弄清结构再分析，不要猜列名。
2. **缺包就装。** 先试 `python -c "import 包名"`。缺了用 `python_env_install {packages, reason}`，写明为什么需要。不要在命令行里 `pip install`，那样会绕开环境管理。请求批准模式下装包会先问用户。
3. **写脚本，再运行。** 用 `write_file` 把分析写成 `.py` 文件放在工作文件夹里，再用 `shell` 运行 `python 脚本名.py`。比一长串 `python -c` 好读、好改，用户也能复现。
4. **看结果。** 读命令输出：报错就看完整报错再改，不要换一种写法盲试。作图用 matplotlib 保存为 PNG（`plt.savefig(..., dpi=150, bbox_inches='tight')`），再用 `view_image {path}` 亲眼看图是否正确。中文标签需要设置中文字体（Windows 上用 `Microsoft YaHei`）。
5. **交付。** 结果图和表按技能 deliver-files 交付。

## 汇报

- 说清用了哪个文件、哪些列、什么方法、样本量多少，数字给到合适的小数位。
- 统计结果给效应量和区间，不只给 p 值；说明做了哪些处理（删缺失、去极值、变换）。
- 结果和预期不符时如实说，不要调参数直到「显著」。

## 不要做

- 不要修改用户的原始数据文件；清洗后的数据另存一份。
- 不要读取或打印凭据文件、环境变量里的密钥。
- 长时间运行的任务先用一小部分数据试跑。
