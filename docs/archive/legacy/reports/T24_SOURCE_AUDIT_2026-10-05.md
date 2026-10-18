# T24 科学案例来源审核导出（供无本地环境审阅）

此文只包含派生评分、模型回答短摘录（每条≤115字符）、源chunk/page定位和判定原因。没有全文论文、fixture、凭据、私有推理或原始日志。来源为用户供给论文“ The use of artificial intelligence (AI) in research: a review of author guidelines in leading journals across eight social science disciplines ”（DOI10.1007/s11192-025-05377-0），169带定位片段。引用完整sourceID用于与受控原始材料对照。

最终统一rubric：runtime1=单次provider/runtime正常completed，或typedmax-tokens partial+显式same-sessioncontinue到completed；0=productterminal/recovery失败；infra剔除。19facts/6caveats每项covered1、partial0.5、absent0。字数/回答长短不计分。不以“material数量”或总claims数量替代所有逐句缺陷。外部标准无供给来源不等于事实必错，须另核；标“推论”不免除其逻辑与证据检查。

| Case | Runtime | Facts c/p/a | Facts points | Caveats c/p/a | Caveat points |
|---|---|---|---|---|---|
| new-r1-science | 1 | 18/0/1 | 18/19 | 4/1/1 | 4.5/6 |
| old-r1-science | infra排除 | — | — | — | — |
| new-r2-science | 1 | 19/0/0 | 19/19 | 5/1/0 | 5.5/6 |
| old-r2-science | 0 | 16/3/0 | 17.5/19 | 5/0/1 | 5/6 |
| new-r3-science | 1 | 18/0/1 | 18/19 | 3/2/1 | 4/6 |
| old-r3-science | 0 | 12/2/5 | 13/19 | 5/1/0 | 5.5/6 |

old最终2可评分轮均值：runtime0，facts15.25/19，caveats5.25/6。
new最终3可评分轮均值：runtime1，facts18.333333333333332/19，caveats4.666666666666667/6。

比较限制：oldr1绝对proxy120s，后590s；newr1/r2是predraincandidate，newr3是postdraincandidate，产品/worker审计版本变化如实保留。baseline全轮同版本。capacity262144/32768是runtime默认声明，非vendorverified。六个科学案例均已审核；最终均值含五个可评分案例，旧r1基础设施失败剔除，无未完成科学轮。

## new-r1-science

Runtime completion：1。19facts：covered/partial/absent=18/0/1，18/19。6caveats：4/1/1，4.5/6。Physical/effective/retry=2/2/0。

全部额外断言与缺陷（material只是分层，不代替完整清单）：

- **F01 额外/推论/轻微或外部未核 · OVERSTATED_REVIEWER_INFERENCE**
  摘录：“- 「衡量程度（degree）」这一表述与操作化不符：全部 18 个题项为二分（Yes/No），且正文两处明确说明编码仅区分「出现/未出现」，不区分「允许/禁止」（p.4, c13；p.9, c59）。二分出现/未出现无法构成程度…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c13。
  审核：二分题项本身不排除通过多个题项构成程度指标；论文未报告合成指标可批评，但绝对不可能的断言无依据。
- **F02 额外/推论/轻微或外部未核 · UNSUPPORTED_COMPARATIVE_ASSERTION**
  摘录：“- 「第一/首个」属优先权声明，本研究的证据不能自证。最接近的前作被本文自己引用：Kim (2024) 对 LIS 期刊 AI 政策的研究（p.4, c12；p.13, c69），故新颖性依赖于「跨学科 + Q1 + 八学科」的范…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12; p.13/src_a27702bca8444633b1ca-c69; p.16/src_a27702bca8444633b1ca-c113。
  审核：文中确引Kim(2024)，但没有对所有既往研究比较来证明最接近；c69也不引Kim。
- **F03 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“- **复核者推论（需核对）**：编码自 2024-05-08 开始（p.4, c13），而基于 2023 数据的 JCR 版本约于 2024 年 6 月发布。若作者用的是后者，样本框晚于编码起始日，存在时间口径问题；若用前者，则…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c13。
  审核：JCR发布时间和数据/版本对应关系不在供给全文；虽标推论，所依外部日历仍未给来源。
- **F04 MATERIAL · UNPROVIDED_EXTERNAL_FACT**
  摘录：“- **原文未提供**：WoS 类别到「communication / economics / education / ethics / healthcare / linguistics / sociology / politic…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12。
  审核：供给全文没有WoS官方类目表，句子内部还列JCR有Ethics，与ethics不是单一类目名自相抵牾。
- **F05 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“- **原文未提供**：出版方层级政策的处理方式。许多期刊继承 Elsevier/Springer Nature/Wiley/Taylor & Francis/SAGE 等出版方的统一 AI 政策；若只在期刊页面检索，可能漏编；若…”
  依据：供给全文未提供。
  审核：论文未提供这些出版方模板、继承比例或本样本出版方结构；可提出假设，不能作为已知事实。
- **F06 额外/推论/轻微或外部未核 · OVERSTATED_REVIEWER_INFERENCE**
  摘录：“- **复核者推论**：18 个题项中有 3 个近乎无常（V7 = 0%、V18 = 0%、V9 = 0.5%），有效题项池实际约 15 个；「18 项框架」的表述略有夸大。”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.9/src_a27702bca8444633b1ca-c59。
  审核：V9全样本有变异，近乎常量不能等同删除有效题项；框架覆盖有效15的判断需定义与验证。
- **F07 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STANDARD**
  摘录：“2. 判定阈值偏松。本文采用「≥0.65 为可接受」，而 Krippendorff 的常用约定是 α ≥ 0.667 仅作探索性结论、α ≥ 0.80 才算可靠。V8、V11、V12、V16 恰在 0.65，低于 0.667。”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.16/src_a27702bca8444633b1ca-c120; p.16/src_a27702bca8444633b1ca-c123。
  审核：供给全文仅报告>=0.65，参考条目不包含0.667/0.80阈值正文；需要外部原著页码。
- **F08 额外/推论/轻微或外部未核 · OVERSTATED_REVIEWER_INFERENCE**
  摘录：“   - V8（同行评审，总体 11.2%）、V11（可及性，12%）、V12（隐私，12%）为低基数题项，在 55 例子样本中阳性数约 6 例，CI 宽属结构性现象；”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.8/src_a27702bca8444633b1ca-c40。
  审核：实际55例阳性计数未提供，6例仅由总体频率估算；本句未局部标估算，不能确认CI原因。
- **F09 额外/推论/轻微或外部未核 · OVERSTATED_REVIEWER_INFERENCE**
  摘录：“   - V16（方法部分声明，总体 60.2%）在 55 例中阳性数约 33 例，仍只有 0.65 [0.13, 1]，**这不能用低基数解释**，提示编码者对「建议 vs 要求」「何处声明」存在实质分歧。”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.8/src_a27702bca8444633b1ca-c38。
  审核：正文随后承认33例只从全样本推算；真实子样本基数和两编码者分布未知，不能排除低基数或锁定具体分歧。
- **F10 额外/推论/轻微或外部未核 · OVERSTATED_CONDITIONAL_INFERENCE**
  摘录：“4. V12、V13、V15 经第二轮编码后达到 0.65–1.00。**原文未提供**：第二轮是重编全部 55 例还是只重编分歧个案；第二轮是否盲编；分歧总数、分歧解决方式（讨论/仲裁）；以及首轮与二轮的 α 变化表。若只重编分…”
  依据：p.7/src_a27702bca8444633b1ca-c20。
  审核：可能有偏不等于一定抬高，方向取决于如何重编/统计；应条件式描述风险。
- **F11 额外/推论/轻微或外部未核 · UNSUPPORTED_REVIEWER_INFERENCE**
  摘录：“5. 367 本中约 85% 由编码者 A 单独编码，论文未报告这部分的可信度（如抽检复核错误率、编码者内稳定性、跨时间漂移）。**复核者推论**：全文所有百分比的误差主要由这部分未复核编码决定，而非由报告的 α 决定。”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.15/src_a27702bca8444633b1ca-c73。
  审核：85%单编是可复算，但缺误差率/误差模型不能判所有百分比误差主要来源。
- **F12 额外/推论/轻微或外部未核 · OVERSTATED_SOURCE_SCOPE**
  摘录：“- 可支持：确以描述统计为主、以单一卡方检验为辅；统计软件为 SPSS（因使用 KALPHA 宏）。”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.12/src_a27702bca8444633b1ca-c66。
  审核：SPSS/KALPHA只明确用于信度，不证明其他统计全部SPSS。
- **F13 额外/推论/轻微或外部未核 · OVERSTATED_CONDITIONAL_INFERENCE**
  摘录：“- **复核者推论（重要分析效度问题）**：若作者指南多由出版方统一模板派生，观测值存在聚类结构，367 处于「名义独立样本」状态。卡方与 Cramér's V 的独立性假设在出版方聚类下不成立，标准误会低估、p 值会过小。这可以…”
  依据：p.12/src_a27702bca8444633b1ca-c66。
  审核：是否同模板、相关方向/程度未知。聚类值得敏感性分析，但必然低估/过小不是本研究已证结论。
- **F14 MATERIAL · NUMERICAL_RECALCULATION_ERROR**
  摘录：“- 支持度检验：以 N=367，按各学科行边际与 192/175 列边际算期望值，取调整残差 (O−E)/√(E·(1−r/N)·(1−c/N))，得 +1.03/−1.03（communication）、−0.88/+0.88（…”
  依据：p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64; p.12/src_a27702bca8444633b1ca-c66; p.12/src_a27702bca8444633b1ca-c67。
  审核：真实教育调整残差为±1.76134，原文1.81不精确一致；sociology±0.644945四舍五入1位应0.6，不能把0.65称全部1位吻合。
- **F15 MATERIAL · NUMERICAL_RECALCULATION_ERROR**
  摘录：“- 由各格 (O−E)²/E 求和：0.998+0.578+2.509+0.804+0.395+0.423+4.444+0.373 = **10.523**，与报告的 χ²(7)=10.51 一致 ✓。”
  依据：p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64; p.12/src_a27702bca8444633b1ca-c66。
  审核：据8组计数χ²=10.519122994而非10.523；常规2位应10.52，不与10.51严格一致。差很小且不改变p>.05。
- **F16 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STANDARD**
  摘录：“- 无论取 0.169 还是 0.119，按 Cohen 的 w 基准（0.10 小、0.30 中、0.50 大）都属「小效应」，故**定性结论「关联很小」不受影响**，需修正的只是具体数值与公式披露。”
  依据：p.15/src_a27702bca8444633b1ca-c77。
  审核：Cohen参考书条目在文献表，0.10/0.30/0.50规则未提供正文；需要外部依据。
- **F17 MATERIAL · CONTRADICTED_BY_SOURCE**
  摘录：“- 与之并存的事实是：**按 V1（是否提及 AI），economics 为 49/95 = 51.6%（高于总体 47.7%，调整残差 +0.9），仅低于 education 的 57.1%；而 political scienc…”
  依据：p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64。
  审核：economics51.6%还低于healthcare14/26=53.8%与sociology20/38=52.6%；不是仅低于education。
- **F18 MATERIAL · MISQUOTED_SOURCE_AND_SCOPE**
  摘录：“| 「各学科在 AI 的接受与监管上存在显著差异」 | **与推断结果不一致**：唯一的推断检验（V1）χ²(7)=10.51, p=0.161，不显著 | 改为「在若干具体题项上存在描述性差异（未做推断检验）」；「显著」一词应删…”
  依据：p.1/src_a27702bca8444633b1ca-c2; p.12/src_a27702bca8444633b1ca-c66。
  审核：摘要英文notable differences不是statistically significant；V1不显著亦不能否定其他17未检验变量差异。回答添加统计显著再批评它。
- **F19 额外/推论/轻微或外部未核 · UNSUPPORTED_REVIEWER_INFERENCE**
  摘录：“   - **不可支持**：把 0% 称为「restriction（限制）」、推论编辑部「担心内容原创性」「认为文献综述更适合人类」。这些是缺失提及的动机归因，未被测量。**复核者推论**：0% 更可能反映作者指南的书写惯例——指…”
  依据：p.13/src_a27702bca8444633b1ca-c69; p.14/src_a27702bca8444633b1ca-c71; p.15/src_a27702bca8444633b1ca-c73。
  审核：可列假说，未比较不同解释概率，不能断更可能。
- **F20 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“2. **出版方聚类/观测非独立**：期刊指南常继承出版方统一模板。原文未报告出版方变量，也未处理聚类，可能低估标准误、高估关联强度。”
  依据：p.15/src_a27702bca8444633b1ca-c73。
  审核：样本没有出版方政策材料；全称/频度知识非供给来源。
- **F21 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“1. **时间窗与快照性**：数据收集仅 2024-05-08 至 06-28（c13）。生成式 AI 政策在 2023–2025 年快速变动，结果应明确标注为特定 7 周窗口的快照，并说明未做更新或趋势检验。”
  依据：p.14/src_a27702bca8444633b1ca-c72。
  审核：作者展望未来演变不证明2023–2025已快速变动的纵向事实。
- **F22 额外/推论/轻微或外部未核 · OVERCLAIMED_REPORT_COMPLETENESS**
  摘录：“- 逐项数值与 95% CI 转录完整（V1、V4、V15 = 1 [1,1]；V8/V11/V12/V16 = 0.65 [0.13,1]；V2 = 0.85 [0.69,0.96] 等），未发现转录错误。”
  依据：p.8/src_a27702bca8444633b1ca-c23; p.8/src_a27702bca8444633b1ca-c24; p.8/src_a27702bca8444633b1ca-c30; p.8/src_a27702bca8444633b1ca-c33; p.8/src_a27702bca8444633b1ca-c34; p.8/src_a27702bca8444633b1ca-c38。
  审核：本回答仅列部分CI例子，没有完整转录15项CI；不是逐项转录完整。
- **F23 MATERIAL · COVERAGE_OVERCLAIM**
  摘录：“| 题名、作者、单位、摘要、关键词 | p.1 | c0–c6 |”
  依据：p.1/src_a27702bca8444633b1ca-c0; p.1/src_a27702bca8444633b1ca-c1; p.1/src_a27702bca8444633b1ca-c2; p.1/src_a27702bca8444633b1ca-c3; p.1/src_a27702bca8444633b1ca-c4; p.1/src_a27702bca8444633b1ca-c5; p.1/src_a27702bca8444633b1ca-c6。
  审核：覆盖表列已覆盖，但正文没有实际审核题名、作者名单、单位、关键词；引用c0–c6不是覆盖内容。
- **F24 MATERIAL · COVERAGE_OVERCLAIM**
  摘录：“| Supplementary Information、Funding、Conflict of interests | p.15 | c73–c74 |”
  依据：p.15/src_a27702bca8444633b1ca-c73; p.15/src_a27702bca8444633b1ca-c74。
  审核：正文讨论附录未供给，但未报告no sponsor/funder或no conflict两项原文声明。
- **F25 MATERIAL · COVERAGE_OVERCLAIM**
  摘录：“| Publisher's Note、版权声明 | p.17 | c163–c168 |”
  依据：p.17/src_a27702bca8444633b1ca-c163; p.17/src_a27702bca8444633b1ca-c164; p.17/src_a27702bca8444633b1ca-c165; p.17/src_a27702bca8444633b1ca-c166; p.17/src_a27702bca8444633b1ca-c167; p.17/src_a27702bca8444633b1ca-c168。
  审核：回答没有陈述或审核出版者中立与版权条款。
- **F26 额外/推论/轻微或外部未核 · PARTIAL_COVERAGE_OVERCLAIM**
  摘录：“| References | pp.15–17 | c75–c162 |”
  依据：p.15/src_a27702bca8444633b1ca-c75; p.16/src_a27702bca8444633b1ca-c95; p.16/src_a27702bca8444633b1ca-c115。
  审核：仅抽查两个引用姓名/年份和几处拼写，不是全文参考文献核验；应标抽查。

定位、引用及覆盖声明：

- “5. **第五条：自动翻译与培训几乎无变异（「0.5% occurrence」，c70）**。”：该段及随后隐私/验证标c70，实际相关段c71 p14。
- “4. **第四条：跨学科差异 + 无统计显著差异 → AI 治理尚未按学科分化，COPE 类跨学科标准可直接落地**（c69）。”：COPE无须field customization段实际c70 p13，非c69。
- “- R15 引用更正：正文 p.4（c13）「Goyanes & Piñeiro-Naval, 2014」与参考文献表（p.16, c95）「Goyanes & Piñeiro-Naval, V. (2024)」年份不一致；「Ko…”：Goyanes2024在c95正确，但Kooli姓名在c115非c116。
- “| Introduction（背景与文献定位） | pp.2–3 | c7–c9 |”：同正文仅少量引用c7–c9/前作，未系统梳理引言证据。
- “| 表 1 信度表与脚注 | p.8 | c22–c40 |”：表1脚注c40 p8正确，但V9 pooled澄清脚注c59 p9不属于p8。
- “1. **簇 2–4 的 Yes 语义与全局编码规则冲突（最重要）**。正文 c13/c59 声明「只编码出现/未出现，不区分允许/禁止」，但上表 V5、V6、V7、V8、V10 的 Yes 定义写的是「允许（allowed/pe…”：都是存在的供给chunk引用；cXX后缀唯一可映射，无未知chat引用。

逐项事实覆盖：

- RQ及目标：covered（p.3/src_a27702bca8444633b1ca-c9; p.3/src_a27702bca8444633b1ca-c10）
- 367样本及8学科计数：covered（p.3/src_a27702bca8444633b1ca-c9）
- 2023JCRQ1/WoS范围：covered（p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12）
- 学科选择及Q1局限：covered（p.4/src_a27702bca8444633b1ca-c12）
- 收集日期：covered（p.4/src_a27702bca8444633b1ca-c13）
- 18变量四簇：covered（p.4/src_a27702bca8444633b1ca-c13; p.5/src_a27702bca8444633b1ca-c14; p.5/src_a27702bca8444633b1ca-c15; p.6/src_a27702bca8444633b1ca-c16; p.6/src_a27702bca8444633b1ca-c17; p.6/src_a27702bca8444633b1ca-c18; p.7/src_a27702bca8444633b1ca-c19）
- presence而非permission：covered（p.4/src_a27702bca8444633b1ca-c13; p.9/src_a27702bca8444633b1ca-c59）
- A367/B55随机15%：covered（p.7/src_a27702bca8444633b1ca-c20）
- 首轮.55/.55/.53及二次编码：covered（p.7/src_a27702bca8444633b1ca-c20）
- 最终>=.65/均值.80SD.13：covered（p.7/src_a27702bca8444633b1ca-c20）
- 表2全部18freq/percent：covered（p.9/src_a27702bca8444633b1ca-c41; p.9/src_a27702bca8444633b1ca-c42; p.9/src_a27702bca8444633b1ca-c43; p.9/src_a27702bca8444633b1ca-c44; p.9/src_a27702bca8444633b1ca-c45; p.9/src_a27702bca8444633b1ca-c46; p.9/src_a27702bca8444633b1ca-c47; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c50; p.9/src_a27702bca8444633b1ca-c51; p.9/src_a27702bca8444633b1ca-c52; p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c55; p.9/src_a27702bca8444633b1ca-c56; p.9/src_a27702bca8444633b1ca-c57; p.9/src_a27702bca8444633b1ca-c58; p.9/src_a27702bca8444633b1ca-c59）
- draft73.8/transparency61.3/literature0：covered（p.7/src_a27702bca8444633b1ca-c21; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c56）
- privacy12/verify11.2/IP54.5：covered（p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c56; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 175yes/192no八学科表4：covered（p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64; p.12/src_a27702bca8444633b1ca-c65; p.12/src_a27702bca8444633b1ca-c67）
- χ²10.51p.161V.119原值/复算V.169：covered_with_recalculation_error（p.12/src_a27702bca8444633b1ca-c66）
- 学科叙述与因果边界：covered（p.10/src_a27702bca8444633b1ca-c61; p.11/src_a27702bca8444633b1ca-c62）
- 讨论和规范建议：covered（p.13/src_a27702bca8444633b1ca-c69; p.13/src_a27702bca8444633b1ca-c70; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 四项局限：covered（p.15/src_a27702bca8444633b1ca-c73）
- funder/conflict/endmatter：not_substantively_covered（p.15/src_a27702bca8444633b1ca-c74; p.17/src_a27702bca8444633b1ca-c163; p.17/src_a27702bca8444633b1ca-c164; p.17/src_a27702bca8444633b1ca-c165; p.17/src_a27702bca8444633b1ca-c166; p.17/src_a27702bca8444633b1ca-c167; p.17/src_a27702bca8444633b1ca-c168）

六项来源caveat：

- mention/permission矛盾：correctly_identified
- 描述≠显著及V1范围：identified_but_abstract_mistranslated
- politicalresidual-2.3与none significant冲突：MISSED；虽重建残差，却未指出作者none deviations significant与|-2.3|>1.96的潜在矛盾；应条件于未校正探索性残差标准。
- 表解析破碎/图表3无cell：correctly_disclosed
- A1-A9未另提供：correctly_disclosed
- V9信度常量/full.5与V18zero：correctly_identified_and_c59_resolution

## old-r1-science

基础设施失败，无交付科学回答；从科学质量和runtime均值剔除。原120秒绝对proxydeadline中断持续reasoningSSE，5physical/1effective/4retry；原证据保留、无重跑。

## new-r2-science

Runtime completion：1。19facts：covered/partial/absent=19/0/0，19/19。6caveats：5/1/0，5.5/6。Physical/effective/retry=2/2/0。

全部额外断言与缺陷（material只是分层，不代替完整清单）：

- **F01 额外/推论/轻微或外部未核 · UNSUPPORTED_REVIEWER_INFERENCE**
  摘录：“   - 【审核者推论】各学科 n 与"某类别四分位之一"的数量级相容（例如 24≈4 的整数倍模式），但**本次审核不引用任何 JCR 类别规模数据**；缺少类别分母即无法验证 Q1 抽样框。”
  依据：p.3/src_a27702bca8444633b1ca-c9。
  审核：没有类别总量，24是4倍数不证明Q1数量相容；本句虽标推论，论证无效。
- **F02 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“4. **抽样单位与聚类**：期刊嵌套于少数大型出版商，出版商层面常存在统一的 AI 政策模板。原文未设"出版商"变量、未做嵌套/多层处理。”
  依据：p.4/src_a27702bca8444633b1ca-c12; p.15/src_a27702bca8444633b1ca-c73。
  审核：供给全文无本样本出版方分布/模板；可建议采集，不可陈述已知少数大型出版商聚类。
- **F03 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“- 要求作者公开（a）期刊清单及每刊指南 URL，（b）抓取日期快照，（c）抓取脚本或人工记录表。若无快照，2024 年的指南内容已被大量改写，第三方无法回溯复现。”
  依据：p.14/src_a27702bca8444633b1ca-c72。
  审核：原文只有演变展望，没有2024后指南大量改写的测量或版本证据。
- **F04 额外/推论/轻微或外部未核 · UNSUPPORTED_PROBABILITY_INFERENCE**
  摘录：“   - 【审核者推论】最可能是 V2 实际对全部 367 刊编码（"是否隶属 COPE"），则 codebook 的条件式定义需改写。”
  依据：p.5/src_a27702bca8444633b1ca-c14; p.9/src_a27702bca8444633b1ca-c43。
  审核：全样本分母冲突真实，但实际全部编码/条件成员其余记No/表错误等均可能，无证据排序最可能。
- **F05 MATERIAL · CONTRADICTED_SOURCE_TRANSCRIPTION**
  摘录：“2. **允许/禁止的不可判定性与变量措辞自相矛盾**。原文两处强调编码只记录"提及/未提及"（c13, c59），但 V6/V7/V8/V9/V10 的释义直接写"permitted/allowed/not permitted"…”
  依据：p.5/src_a27702bca8444633b1ca-c15; p.6/src_a27702bca8444633b1ca-c16。
  审核：V9释义只有mention/not mentioned，不写permitted/allowed；混入V9错误，同时漏V5。
- **F06 MATERIAL · UNSUPPORTED_OPERATIONAL_ASSERTION**
  摘录：“3. **V14 的量表强度过高**。"Transparency required"的释义是"require complete transparency…must fully detail"，而编码只判 Yes/No 提及。任何一…”
  依据：p.4/src_a27702bca8444633b1ca-c13; p.6/src_a27702bca8444633b1ca-c17; p.9/src_a27702bca8444633b1ca-c59。
  审核：原文内部编码标准矛盾，实际任何一句应披露都计Yes不能确认；需作者编码手册和实例。
- **F07 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STANDARD**
  摘录：“2. **≥0.65 阈值的来源缺失**。原文只说"acceptable (≥0.65)"，未给出依据；Krippendorff (2004) 的一般建议通常更严。**关键是**：Table 1 中有 4 个变量点估计正好等于 0…”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.16/src_a27702bca8444633b1ca-c120。
  审核：引用条目存在但阈值原著内容未提供/访问；外部常识需定位来源。
- **F08 MATERIAL · UNSUPPORTED_SOURCE_OF_TRUTH_ASSERTION**
  摘录：“5. **85% 的样本（312 例）仅由编码者 A 编码**，其质量无可核验的第二编码者。全文所有最终比例都以 A 的编码为唯一来源。”
  依据：p.7/src_a27702bca8444633b1ca-c20。
  审核：A全编码/B55明确，但final比例基于A或共识修订/复码整合未交代，唯一A来源不能确认。
- **F09 额外/推论/轻微或外部未核 · UNSUPPORTED_DATA_STRUCTURE_ASSERTION**
  摘录：“4. **独立性假设未讨论**。χ² 要求观测独立；期刊嵌套于出版商/同一编辑传统，实质上是聚类数据。原文只检查了期望频次 > 5，未检查独立性来源。”
  依据：p.12/src_a27702bca8444633b1ca-c66。
  审核：可能出版商嵌套并不证明本样本模板相关或影响独立性；缺分布数据。
- **F10 额外/推论/轻微或外部未核 · OVERSTATED_REVIEWER_INFERENCE**
  摘录：“- 索取分析脚本（SPSS 语法/R/Python）。若脚本不存在，公开发表即不可复现。”
  依据：p.4/src_a27702bca8444633b1ca-c13; p.7/src_a27702bca8444633b1ca-c20; p.11/src_a27702bca8444633b1ca-c63; p.12/src_a27702bca8444633b1ca-c66。
  审核：可手工/重写分析复现；真正缺口原始数据/操作化，脚本不存在不必然不可复现。
- **F11 MATERIAL · WRONG_REQUESTED_DATA_SHAPE**
  摘录：“- 用原始 367×8 数据重跑：单项 χ²、按出版商聚类的 χ²（或 GEE/多层 logistic）、Benjamini–Hochberg 校正后的 p 值、以及 V1×V14、V6×V14 的交叉表。”
  依据：p.4/src_a27702bca8444633b1ca-c13; p.7/src_a27702bca8444633b1ca-c20。
  审核：原始编码矩阵应367×18，8是学科数量不是变量列数；回归所需数据需额外学科列。
- **F12 MATERIAL · UNSUPPORTED_CAUSE_ATTRIBUTION**
  摘录：“- No 列 Σ(O−E)²/E = 5.016；Yes 列 = 5.503；**χ² = 10.519 ≈ 10.52**（原文报 10.51；差 0.01 来自手工舍入）。”
  依据：p.12/src_a27702bca8444633b1ca-c66。
  审核：独立复算χ²10.51912正确，原10.51差不能断手工舍入来源；供给整数计数精确。
- **F13 额外/推论/轻微或外部未核 · UNSUPPORTED_PROBABILITY_INFERENCE**
  摘录：“- 【审核者推论】原文的分母很可能误用了"列数 (2)"而非"min(行−1, 列−1) = 1"，等价于把 V 除以 √2。”
  依据：p.12/src_a27702bca8444633b1ca-c66。
  审核：分母2解释数值近似可列假说，原文公式/软件没有提供，不能排序很可能。
- **F14 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STANDARD**
  摘录：“- **结论：效度方向性不受影响（0.119 与 0.169 按 Cohen 惯例都属"small"），但该数值不可复现，须更正。**”
  依据：p.15/src_a27702bca8444633b1ca-c77。
  审核：原文称small且引用Cohen，.169分类属外部规则未给原著内容；应引用规则或仅说仍较小。
- **F15 额外/推论/轻微或外部未核 · OVERSTATED_DENOMINATOR_VERIFICATION**
  摘录：“**审核者复算方法**：用 §3 的学科 n 反推每个百分比对应的整数计数；若百分比 × n 落在整数附近（±0.05），说明学科分母使用正确。”
  依据：p.10/src_a27702bca8444633b1ca-c61; p.11/src_a27702bca8444633b1ca-c62。
  审核：相容证明能由该n还原，不证明实际分母使用正确/数据真实；最后没有发现分母错误应限算术相容。
- **F16 额外/推论/轻微或外部未核 · OVERSTATED_REVIEWER_INFERENCE**
  摘录：“- **可支持范围**：**不成立**。① 零结果不等于"无差异"（小样本、低功效；V1 的最小可检测效应未报告）；② 只检验了 18 个变量中的 1 个；③ 大量描述性学科差异（如 V12 社会学 31.6% vs 经济学 2.…”
  依据：p.4/src_a27702bca8444633b1ca-c13; p.9/src_a27702bca8444633b1ca-c59; p.11/src_a27702bca8444633b1ca-c62; p.13/src_a27702bca8444633b1ca-c70。
  审核：描述mention差异不能直接指向治理碎片化，回答此处亦跨越mention→governance实际层。
- **F17 MATERIAL · CONTRADICTED_BY_SOURCE_HEDGING**
  摘录：“- **可支持范围**：与 C3 同。[审核者推论] c71 给出的三条解释（技术热情遮蔽风险、指南仍在制定中、现有数据保护法规已足够宽泛）在本研究中**没有对应变量或数据**，属未检验的推测；原文未加"推测性"标记。”
  依据：p.14/src_a27702bca8444633b1ca-c71。
  审核：c71明确could be explained、possible、Alternatively、may already、might、may assume等条件措辞，不能称未标推测。
- **F18 MATERIAL · UNPROVIDED_EXTERNAL_FACT**
  摘录：“| **N** | 未说明指南语种范围与多语指南的处理；367 刊中相当部分为非英语期刊，题名与指南语种未报告 | c12–c13（p.4） |”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12; p.4/src_a27702bca8444633b1ca-c13。
  审核：原文无指南语言/期刊语言分布，不能陈述相当部分非英语。
- **F19 额外/推论/轻微或外部未核 · OVERSTATED_MISSING_INFORMATION**
  摘录：“| **P** | 编码团队的构成、人数、身份、是否独立于研究对象（如曾任所编码期刊编委）未报告 | c13、c20（p.4、p.7） |”
  依据：p.4/src_a27702bca8444633b1ca-c13; p.7/src_a27702bca8444633b1ca-c20。
  审核：完整团队未交代，但信度至少两编码者A/B人数角色已提供；应限定具体身份和额外成员缺失。
- **F20 额外/推论/轻微或外部未核 · SOURCE_LOCATION_ERROR**
  摘录：“**编号完整性**：Discussion 采用 First（c69）→ Second（c69）→ Third（c70）→ Fourth（c70）→ Fifth（c70）→ Sixth（c71）→ Finally（c72），编号连续…”
  依据：p.13/src_a27702bca8444633b1ca-c69; p.13/src_a27702bca8444633b1ca-c70; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72。
  审核：顺序编号正确，但Fifth在c71，Sixth起c71末续c72，不是表列Fifthc70。
- **F22 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STYLE_STANDARD**
  摘录：“| 7 | 列表顺序：Goyanes & Demeter (c89) → Goyanes, de Marcos, … (c92) → Goyanes & **Piñeiro-Naval** (c95) → Goyanes & **…”
  依据：p.16/src_a27702bca8444633b1ca-c89; p.16/src_a27702bca8444633b1ca-c92; p.16/src_a27702bca8444633b1ca-c95; p.16/src_a27702bca8444633b1ca-c98。
  审核：题目未规定APA/该刊引用格式；列表多著者同首作者排序可提示核对，不能据未供APA要求定错。
- **F23 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STYLE_STANDARD**
  摘录：“- COPE 条目为网络文档（c79–c80），信息为 URL 与年份，未附访问日期；对会变更的网络资源，通常需要 access date。原文未提供。”
  依据：p.15/src_a27702bca8444633b1ca-c79; p.15/src_a27702bca8444633b1ca-c80。
  审核：网络引用是否需access date由期刊规则与是否持续变动决定，规则未供。
- **F24 MATERIAL · UNSUPPORTED_EXTRA_DISCLOSURE**
  摘录：“5. Funding 与 Conflict 声明互不矛盾，且与全文无资助、无商业关联的表述一致 ✓。”
  依据：p.15/src_a27702bca8444633b1ca-c74。
  审核：no funder/no conflict已供，不等于无商业关联；商业关联可能无冲突或无资助。
- **F25 额外/推论/轻微或外部未核 · APPROXIMATE_COUNT_NOT_VERIFIED**
  摘录：“| I | Table 3 的 144 个单元格只有约 25 个进入”
  依据：p.10/src_a27702bca8444633b1ca-c61; p.11/src_a27702bca8444633b1ca-c62。
  审核：实际按回答表23百分比再含全学科zero的单元格定义不同；约25仅近似应保留，后称约120待核不能当精确。

定位、引用及覆盖声明：

- “- **原文内部冲突**：c13、c59 明说编码不区分允许/禁止；但 c69（p.13）写"this **restriction** likely reflects concerns about preserving the h…”：restriction句实际c71p14非c69，相关absence句不在c70。
- “- c71 写"The fact that 54.5% of **articles** already mention intellectual property issues related to AI"——分析单位是期刊的作者…”：articles54.5%句实际c72p14；重复§13与R6同误。
- “- c70 写"automatic translation and AI training requirements… showed almost no variability (0.5% occurrence)"——0.5% 只…”：0.5%句实际c71p14，R12又标c70。
- “- **可支持范围**：优先权主张不可由论文自身证据支持；且作者自己引用 Kim (2024) 已对 LIS 期刊的 AI 政策做过编码（c9、c114），因此"首个引入专门条目"需收窄到"首个跨 8 个社会科学学科的条目化比较"…”：Kim名称条目c113，c114为续行；原文描述政策研究不提供其实际编码手册。
- “| Limitations + Supplementary + Funding | 15 | c73 | 已审（§11、§15） |”：Funding文本实际c74非coverage表c73。

逐项事实覆盖：

- RQ及目标：covered（p.3/src_a27702bca8444633b1ca-c9; p.3/src_a27702bca8444633b1ca-c10）
- 367样本及8学科计数：covered（p.3/src_a27702bca8444633b1ca-c9）
- 2023JCRQ1/WoS范围：covered（p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12）
- 学科选择及Q1局限：covered（p.4/src_a27702bca8444633b1ca-c12）
- 收集日期：covered（p.4/src_a27702bca8444633b1ca-c13）
- 18变量四簇：covered（p.4/src_a27702bca8444633b1ca-c13; p.5/src_a27702bca8444633b1ca-c14; p.5/src_a27702bca8444633b1ca-c15; p.6/src_a27702bca8444633b1ca-c16; p.6/src_a27702bca8444633b1ca-c17; p.6/src_a27702bca8444633b1ca-c18; p.7/src_a27702bca8444633b1ca-c19）
- presence而非permission：covered（p.4/src_a27702bca8444633b1ca-c13; p.9/src_a27702bca8444633b1ca-c59）
- A367/B55随机15%：covered（p.7/src_a27702bca8444633b1ca-c20）
- 首轮.55/.55/.53及二次编码：covered（p.7/src_a27702bca8444633b1ca-c20）
- 最终>=.65/均值.80SD.13：covered（p.7/src_a27702bca8444633b1ca-c20）
- 表2全部18freq/percent：covered（p.9/src_a27702bca8444633b1ca-c41; p.9/src_a27702bca8444633b1ca-c42; p.9/src_a27702bca8444633b1ca-c43; p.9/src_a27702bca8444633b1ca-c44; p.9/src_a27702bca8444633b1ca-c45; p.9/src_a27702bca8444633b1ca-c46; p.9/src_a27702bca8444633b1ca-c47; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c50; p.9/src_a27702bca8444633b1ca-c51; p.9/src_a27702bca8444633b1ca-c52; p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c55; p.9/src_a27702bca8444633b1ca-c56; p.9/src_a27702bca8444633b1ca-c57; p.9/src_a27702bca8444633b1ca-c58; p.9/src_a27702bca8444633b1ca-c59）
- draft73.8/transparency61.3/literature0：covered（p.7/src_a27702bca8444633b1ca-c21; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c56）
- privacy12/verify11.2/IP54.5：covered（p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c56; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 175yes/192no八学科表4：covered（p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64; p.12/src_a27702bca8444633b1ca-c65; p.12/src_a27702bca8444633b1ca-c67）
- χ²10.51p.161V.119原值/复算V.169：covered（p.12/src_a27702bca8444633b1ca-c66）
- 学科叙述与因果边界：covered（p.10/src_a27702bca8444633b1ca-c61; p.11/src_a27702bca8444633b1ca-c62）
- 讨论和规范建议：covered（p.13/src_a27702bca8444633b1ca-c69; p.13/src_a27702bca8444633b1ca-c70; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 四项局限：covered（p.15/src_a27702bca8444633b1ca-c73）
- funder/conflict/endmatter：covered（p.15/src_a27702bca8444633b1ca-c74; p.17/src_a27702bca8444633b1ca-c163; p.17/src_a27702bca8444633b1ca-c164; p.17/src_a27702bca8444633b1ca-c165; p.17/src_a27702bca8444633b1ca-c166; p.17/src_a27702bca8444633b1ca-c167; p.17/src_a27702bca8444633b1ca-c168）

六项来源caveat：

- mention/permission矛盾：covered
- 描述≠显著及V1范围：covered
- politicalresidual-2.3与none significant冲突：PARTIALLY_COVERED_EXPLORATORY_BONFERRONI_BUT_NO_DIRECT_NONE_SIGNIFICANT_CONTRADICTION；虽重建残差，却未指出作者none deviations significant与|-2.3|>1.96的潜在矛盾；应条件于未校正探索性残差标准。
- 表解析破碎/图表3无cell：covered
- A1-A9未另提供：covered
- V9信度常量/full.5与V18zero：covered

## old-r2-science

Runtime completion：0。19facts：covered/partial/absent=16/3/0，17.5/19。6caveats：5/0/1，5/6。Physical/effective/retry=1/1/0。

全部额外断言与缺陷（material只是分层，不代替完整清单）：

- **F01 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_RULE**
  摘录：“**原文未提供**：数据可得性声明；作者贡献声明；伦理审批声明（内容分析公开文件通常豁免，但未说明）；预注册或分析计划；编码员身份、培训协议与语言能力；原始编码数据与 SPSS 语法。”
  依据：p.15/src_a27702bca8444633b1ca-c73; p.15/src_a27702bca8444633b1ca-c74。
  审核：原文无伦理审批规则，豁免依机构/地区规定而异，未给来源。
- **F02 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_ASSERTION**
  摘录：“- 引言写"selected from the JCR index"（c9, p.3），方法写"sourced from the Web of Science (WoS) database"（c12, p.4）；JCR 与 WoS…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12。
  审核：可要求明确索引与版本，但命名关系外部事实未供。
- **F03 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_CALENDAR**
  摘录：“- "2023 年 Q1"的**具体版本**（2023 年版 JCR 即 2022 JIF，还是 2024 年 6 月发布的 2023 JIF）与四分位算法未说明。数据收集窗口为 2024-05-08 至 2024-06-28（c…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c13。
  审核：JCR发布时间/版本数据映射未在全文提供。
- **F04 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_CLASSIFICATION**
  摘录：“- 八学科被统称 "social science disciplines"（c2, p.1），但 healthcare（及部分 ethics 期刊）属生物医学/临床域，标题与摘要的学科定位需说明。”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12。
  审核：类别映射/期刊名单未供，不能确定本样本具体期刊归类。
- **F05 MATERIAL · UNSUPPORTED_REVIEWER_INFERENCE**
  摘录：“- `[审核者推论]` 各学科 n 与相应 JCR 类别的 Q1 规模量级吻合（如 Economics ≈95、Education ≈70、Political Science ≈49），提示这是**Q1 期刊全样本（census）…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12。
  审核：未访问JCR类别总量却断相应Q1吻合→census，缺对应规模证据。
- **F06 MATERIAL · CONTRADICTED_BY_SOURCE**
  摘录：“**18 个二分变量，4 个主题簇**`[原文]`（c13–c19, p.4–7；完整 12 项条目词见 Online Appendix Table A9，**不在本次片段内**）：”
  依据：p.7/src_a27702bca8444633b1ca-c19; p.8/src_a27702bca8444633b1ca-c40。
  审核：全文18变量而非12完整题项，错误数字。
- **F07 额外/推论/轻微或外部未核 · OVERSTATED_MATHEMATICAL_ASSERTION**
  摘录：“- V1、V4、V15 的 95% CI 均为 [1, 1]；`[审核者推论]` 若样本内为完全一致，则任何 bootstrap 重抽样亦完全一致，CI=[1,1] 是数学必然，不构成额外证据强度。”
  依据：p.8/src_a27702bca8444633b1ca-c40。
  审核：对完美一致且bootstrap样本退化常数时alpha可能undefined，并非任何重抽样都定义alpha=1；未给实现约定。
- **F08 额外/推论/轻微或外部未核 · OVERSTATED_INFERENCE**
  摘录：“- 4 个变量（V8、V11、V12、V16）点估计恰为 0.65，CI 下界为 0.13 —— 等价于"与近乎零一致性不可区分"。”
  依据：p.8/src_a27702bca8444633b1ca-c30; p.8/src_a27702bca8444633b1ca-c33; p.8/src_a27702bca8444633b1ca-c34; p.8/src_a27702bca8444633b1ca-c38。
  审核：CI下界.13仍非zero，近乎零判准未定义；应说宽区间、下界低。
- **F09 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STANDARD**
  摘录：“1. **阈值引用问题**：原文以 ≥0.65 为"acceptable"，并引 Krippendorff (2004) 与 M=0.80 为"满意"。Krippendorff 的通行标准是 α≥0.80 可依赖、0.667 为*…”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.16/src_a27702bca8444633b1ca-c120。
  审核：原著阈值内容未供；参考条目存在不是阈值证据。
- **F10 额外/推论/轻微或外部未核 · OVERSTATED_REVIEWER_INFERENCE**
  摘录：“2. **常数项**：V7、V18 的全样本患病率为 0/367，常数是真实属性；V9 全样本患病率 0.5%（2/367），在 55 例子样本中预期阳性数约 0.3，常数属**抽样假象**，原文 Table 2 注已部分说明（c…”
  依据：p.9/src_a27702bca8444633b1ca-c59。
  审核：V9在随机55中确constant，稀有抽样现象可解释但假象带因果/测量断定，需实际子样本。
- **F11 额外/推论/轻微或外部未核 · OVERSTATED_CONDITIONAL_INFERENCE**
  摘录：“3. **第二轮并非独立**：细化标准后由同两位编码员重编码同一 3 个条目，属于"校准后一致"，会系统性抬高一致性；`[原文未提供]` 第二轮是否使用新的独立子样本、以及 55 例子样本在两轮间是否相同。建议报告"校正后未再抽样…”
  依据：p.7/src_a27702bca8444633b1ca-c20。
  审核：criteriarefinement可能通胀，方向必然抬高未证，后句又承认子样本未知。
- **F12 MATERIAL · UNSUPPORTED_SOURCE_TRANSCRIPTION**
  摘录：“4. **均值来源混合**：M=0.80 混合了第一轮 15 个条目与第二轮 3 个条目的 α，且 V12 从 0.55 提升到 0.65 恰等于阈值，存在"刚好达标"的模式。建议报告各轮 α 与提升幅度。”
  依据：p.7/src_a27702bca8444633b1ca-c20。
  审核：18题项中3constant、15可估；若3二轮，应其余12而非15首轮；实际首/二轮每项值也未完整公开。
- **F13 MATERIAL · OVERSTATED_MATHEMATICAL_ASSERTION**
  摘录：“5. **稀疏类别**：V8（11.2%）、V15（11.2%）、V12（12%）在 n=55 子样本中阳性数仅约 6–7，CI 必然极宽；0.65 的估计精度有限。”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.8/src_a27702bca8444633b1ca-c30; p.8/src_a27702bca8444633b1ca-c34; p.8/src_a27702bca8444633b1ca-c37。
  审核：阳性约6–7是全样本频率推算非实测，且V15alpha1CI[1,1]明确反例不是极宽。
- **F14 MATERIAL · NUMERICAL_RECALCULATION_ERRORS**
  摘录：“- 调整残差复算：Comm −1.03/+1.03、Econ −0.88/+0.92、Edu **−1.76/+1.76**、Ethics +0.92/−0.93、Health −0.72/+0.73、Ling +0.71/−0.…”
  依据：p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64; p.12/src_a27702bca8444633b1ca-c65; p.12/src_a27702bca8444633b1ca-c66; p.12/src_a27702bca8444633b1ca-c67。
  审核：按No/YesComm应+1.033/-1.033，顺序符号错；Econ±.88291、Ethics±.91430、Health±.652645、Soc±.644945，应两侧镜像，回答出现.88/.92 .92/.93 .72/.73等错误，education1.761纠错正确。
- **F15 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STANDARD**
  摘录：“- **Cramér's V 不复现**：8×2 表的 min(r−1,c−1)=1，故 V=√(χ²/N)=√(10.519/367)= **0.169**，而原文报告 **0.119**。原文的 0.119 相当于分母用 N×…”
  依据：p.15/src_a27702bca8444633b1ca-c77。
  审核：Cohen规则没有提供正文/页码；不是本轮阅读验证。
- **F16 MATERIAL · MISASSIGNED_DISCIPLINE_RESULT**
  摘录：“- 透明（V14）：comm 91.7%→22/24 ✓；econ 42.1%→40/95 ✓；linguistics 56.9%→29/51 ✓；sociology 63.2%→24/38 ✓；pol sci 55.1%→27/…”
  依据：p.10/src_a27702bca8444633b1ca-c61。
  审核：sociology63.2/pol55.1/ethics50是伦理方面段，不是明确V14；透明comm/econ/ling段本身V14或V16也未定。
- **F17 额外/推论/轻微或外部未核 · OMITTED_PARALLEL_GROUP**
  摘录：“**小样本效应**`[审核者核算]`：ethics n=14，1 家期刊 = 7.1%；healthcare n=26，1 家 = 3.8%。原文未给任何比例的置信区间，故"econ 2.1% vs comm 29.2%"这类比较…”
  依据：p.3/src_a27702bca8444633b1ca-c9。
  审核：communication24也<=26，遗漏同类；不会改变主结果。
- **F18 额外/推论/轻微或外部未核 · UNVERIFIED_ADDITIONAL_POWER_CALCULATION**
  摘录：“- `[审核者推论]` 检验效能：以 N=367、df=7、α=.05、临界值 14.07 计，检出 w=0.10 的功效约 0.2–0.3，检出 w≈0.17（即观测效应量）约 0.5–0.7，检出 w=0.30 约 0.95+…”
  依据：p.12/src_a27702bca8444633b1ca-c66。
  审核：粗非中心normal近似数值没有计算过程与近似误差；原paper未供功效。已标粗估故不是运行回执伪造，但需独立计算才能核实其具体数值。
- **F19 MATERIAL · CONTRADICTED_BY_SOURCE_HEDGING**
  摘录：“5. **对未提及 12% 隐私的原因给出三种解释**（c71, p.14）：属合理的假设生成，但原文未标记为推测。”
  依据：p.14/src_a27702bca8444633b1ca-c71。
  审核：原段明确could/possible/alternatively/may，已推测措辞，不应断未标。
- **F20 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_CONTENT**
  摘录：“另：codebook 由"COPE 隶属"推出"would endorse the use of AI"（c14, p.5）是解释性跳跃——COPE 2023 声明是关于作者身份与 AI 工具立场，隶属关系不等于认可 AI 使用。…”
  依据：p.5/src_a27702bca8444633b1ca-c14; p.15/src_a27702bca8444633b1ca-c79; p.15/src_a27702bca8444633b1ca-c80。
  审核：reference标题AuthorshipandAItools能支持主题但具体立场条款未访问/供；不应据此确定endorsement关系。
- **F21 MATERIAL · OVERSTATED_CRITICISM**
  摘录：“**D5（中等·必须更正）"absence of a requirement for AI training for authors (100%)"（c70, p.13）。** Table 2 显示 V18：Yes=0%、No=1…”
  依据：p.13/src_a27702bca8444633b1ca-c70; p.9/src_a27702bca8444633b1ca-c59。
  审核：原absence of requirement100%与No100%语义一致，仅易误读，不是真反转。
- **F22 MATERIAL · CIRCULAR_UNSUPPORTED_MAPPING**
  摘录：“**D13（提示）变量数值混用**：c61（p.10）把 communication 87.5%、sociology 63.2%、political science 55.1%、ethics 50% 归为"consider the…”
  依据：p.10/src_a27702bca8444633b1ca-c61。
  审核：同一句中这些百分比本为ethical aspects，回答先误归V14后拿来证明V3/V14混用；无独立表3cells，不能claim吻合。
- **F23 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_CLASSIFICATION**
  摘录：“**D16（提示）学科定位**：八学科在摘要被称为 social science disciplines，但 healthcare（及部分 ethics、economics 类目）横跨生物医学/商业类目；需说明类目映射。”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12。
  审核：本样本类别映射未供，无证据这些横跨生医学/商业归类。
- **F24 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“- **出版社级 vs 期刊级政策未区分**：大型出版社常统一规定 AI 政策，若按期刊为单位计数，同一模板会被重复计入，且会削弱"期刊自主适应"的解释。”
  依据：p.15/src_a27702bca8444633b1ca-c73。
  审核：样本无出版方模板资料/继承分布。
- **F25 MATERIAL · CONTRADICTED_BY_SOURCE_DATE**
  摘录：“- **无时间戳/快照**：指南随时可改，收稿与接收相隔约 10 个月（2024-05/06 采集，2025-06 接收），版本漂移不可控。”
  依据：p.1/src_a27702bca8444633b1ca-c1; p.4/src_a27702bca8444633b1ca-c13。
  审核：实际收稿2024-10-29到录用2025-06-24约8月；括号是采集2024-05/06到录用约12–13月，也非10月。

定位、引用及覆盖声明：

- “1. **把"沉默"读成"限制/禁止"**（c61, c69, p.10/13）："this restriction likely reflects concerns about preserving the human natu…”：实际c71p14，非c61/c69p10/13。
- “4. **"54.5% of articles already mention intellectual property"**（c71, p.14）：分析单元是期刊指南，不是"文章"。属单元混淆。”：实际c72p14非c71；D8重复同错。
- “- **证据基础**：仅使用本次提供的带定位解析片段，覆盖 p.1–p.17、chunk `src_a27702bca8444633b1ca-c0` 至 `c168`。本审核**未**访问原始 PDF、Online Appendi…”：c11供A1–A8，A9定位c19；c73只general supplementary，不是列清单。

逐项事实覆盖：

- RQ及目标：covered（p.3/src_a27702bca8444633b1ca-c9; p.3/src_a27702bca8444633b1ca-c10）
- 367样本及8学科计数：covered（p.3/src_a27702bca8444633b1ca-c9）
- 2023JCRQ1/WoS范围：covered（p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12）
- 学科选择及Q1局限：covered（p.4/src_a27702bca8444633b1ca-c12）
- 收集日期：covered（p.4/src_a27702bca8444633b1ca-c13）
- 18变量四簇：covered（p.4/src_a27702bca8444633b1ca-c13; p.5/src_a27702bca8444633b1ca-c14; p.5/src_a27702bca8444633b1ca-c15; p.6/src_a27702bca8444633b1ca-c16; p.6/src_a27702bca8444633b1ca-c17; p.6/src_a27702bca8444633b1ca-c18; p.7/src_a27702bca8444633b1ca-c19）
- presence而非permission：covered（p.4/src_a27702bca8444633b1ca-c13; p.9/src_a27702bca8444633b1ca-c59）
- A367/B55随机15%：covered（p.7/src_a27702bca8444633b1ca-c20）
- 首轮.55/.55/.53及二次编码：covered（p.7/src_a27702bca8444633b1ca-c20）
- 最终>=.65/均值.80SD.13：covered（p.7/src_a27702bca8444633b1ca-c20）
- 表2全部18freq/percent：covered（p.9/src_a27702bca8444633b1ca-c41; p.9/src_a27702bca8444633b1ca-c42; p.9/src_a27702bca8444633b1ca-c43; p.9/src_a27702bca8444633b1ca-c44; p.9/src_a27702bca8444633b1ca-c45; p.9/src_a27702bca8444633b1ca-c46; p.9/src_a27702bca8444633b1ca-c47; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c50; p.9/src_a27702bca8444633b1ca-c51; p.9/src_a27702bca8444633b1ca-c52; p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c55; p.9/src_a27702bca8444633b1ca-c56; p.9/src_a27702bca8444633b1ca-c57; p.9/src_a27702bca8444633b1ca-c58; p.9/src_a27702bca8444633b1ca-c59）
- draft73.8/transparency61.3/literature0：covered（p.7/src_a27702bca8444633b1ca-c21; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c56）
- privacy12/verify11.2/IP54.5：covered（p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c56; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 175yes/192no八学科表4：covered（p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64; p.12/src_a27702bca8444633b1ca-c65; p.12/src_a27702bca8444633b1ca-c67）
- χ²10.51p.161V.119原值/复算V.169：covered（p.12/src_a27702bca8444633b1ca-c66）
- 学科叙述与因果边界：partial（p.10/src_a27702bca8444633b1ca-c61; p.11/src_a27702bca8444633b1ca-c62）
- 讨论和规范建议：partial（p.13/src_a27702bca8444633b1ca-c69; p.13/src_a27702bca8444633b1ca-c70; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 四项局限：covered（p.15/src_a27702bca8444633b1ca-c73）
- funder/conflict/endmatter：partial（p.15/src_a27702bca8444633b1ca-c74; p.17/src_a27702bca8444633b1ca-c163; p.17/src_a27702bca8444633b1ca-c164; p.17/src_a27702bca8444633b1ca-c165; p.17/src_a27702bca8444633b1ca-c166; p.17/src_a27702bca8444633b1ca-c167; p.17/src_a27702bca8444633b1ca-c168）

六项来源caveat：

- mention/permission矛盾：covered
- 描述≠显著及V1范围：covered
- politicalresidual-2.3与none significant冲突：absent；虽重建残差，却未指出作者none deviations significant与|-2.3|>1.96的潜在矛盾；应条件于未校正探索性残差标准。
- 表解析破碎/图表3无cell：covered
- A1-A9未另提供：covered
- V9信度常量/full.5与V18zero：covered

## new-r3-science

Runtime completion：1。19facts：covered/partial/absent=18/0/1，18/19。6caveats：3/2/1，4/6。Physical/effective/retry=1/1/0。

全部额外断言与缺陷（material只是分层，不代替完整清单）：

- **F01 MATERIAL · SOURCE_SCOPE_ERROR**
  摘录：“**审核材料**：本次可核验对象为带定位的全文解析片段 c0–c168，覆盖 p.1–p.17 正文连续页。**不包含**：Online Appendix（Table A1–A9）、Table 3 热力图的数值矩阵（解析片段仅保留…”
  依据：p.15/src_a27702bca8444633b1ca-c73; p.15/src_a27702bca8444633b1ca-c74。
  审核：Dataavailability没见；Supplementary正文确在c73，不能说材料不含Supplementary正文段。
- **F02 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“1. **抽样框表述不一致**：c9 说"JCR index"，c11–c12 说"Web of Science database""Q1 journals from the Web of Science"。JCR 与 WoS 收…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12。
  审核：JCR/WoS范围关系外部事实未供，需要官方版本资料；可问明确来源。
- **F03 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_CALENDAR_AND_VERSION**
  摘录：“2. **时间线张力**：【审核者复核/推论】数据收集 2024-05-08 起（c13, p.4）。若"2023 年 Q1"指 JCR 2023 版（数据年 2023，通常 2024 年 6 月下旬发布），则 5 月 8 日启动…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c13。
  审核：版本/数据年称法与发布日期均非供给文本，模型又声称可能使用JCR2022版，无法核。
- **F04 MATERIAL · PARTIALLY_CONTRADICTED_BY_SOURCE**
  摘录：“5. **学科样本量极不均衡**（ethics 14，economics 95）：【审核者复核】ethics 中 1 本期刊 = 7.1 个百分点，communication 中 1 本 = 4.2 个百分点。原文的解释与局限章节…”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64。
  审核：无CI正确，n在c9与表4各学科给出；可说百分比旁未附分子/分母而不是没有n。
- **F05 额外/推论/轻微或外部未核 · OVERSTATED_DIRECTIONAL_INFERENCE**
  摘录：“**【审核者推论·口径风险】**若编码页面上出现的是出版商统一模板文本，则多本期刊会被同一条款同时标记为 Yes，人为抬高学科内一致性、压低学科间差异——这会直接削弱本文"学科差异"这一核心结论。此项无法从现有片段证实或排除。”
  依据：p.4/src_a27702bca8444633b1ca-c12; p.15/src_a27702bca8444633b1ca-c73。
  审核：共享模板可能增相关，但模板与学科分布未知，不必然压低学科间差异。
- **F06 MATERIAL · CONTRADICTED_CODEBOOK_TRANSCRIPTION**
  摘录：“- c13 明确"不区分允许/禁止"，但**多数变量定义直接写成了允许性判断**：V5"Yes 表示期刊**允许**用 AI 开发研究"、V6"Yes 表示**获准**支持撰写特定章节"、V7"Yes 表示**允许**"、V8"Y…”
  依据：p.6/src_a27702bca8444633b1ca-c17。
  审核：V15只include clear directives forverifying，不是allowed/permitted，混入许可变量错误。
- **F07 额外/推论/轻微或外部未核 · OVERSTATED_REVIEWER_INFERENCE**
  摘录：“1. **阈值偏低**：以 α≥0.65 为"可接受"（c20, p.7）低于 Krippendorff 常引用的 0.80 常规标准（0.667 仅适用于试探性结论）。且 V8、V11、V12、V16 恰为 0.65，95% C…”
  依据：p.8/src_a27702bca8444633b1ca-c30; p.8/src_a27702bca8444633b1ca-c33; p.8/src_a27702bca8444633b1ca-c34; p.8/src_a27702bca8444633b1ca-c38。
  审核：CI宽仍包含不确定性信息；应写估计不精确，非几乎无精度信息。
- **F08 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STANDARD**
  摘录：“1. **阈值偏低**：以 α≥0.65 为"可接受"（c20, p.7）低于 Krippendorff 常引用的 0.80 常规标准（0.667 仅适用于试探性结论）。且 V8、V11、V12、V16 恰为 0.65，95% C…”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.16/src_a27702bca8444633b1ca-c120。
  审核：原著阈值规则未提供正文，仅reference存在。
- **F09 额外/推论/轻微或外部未核 · UNSUPPORTED_STATISTICAL_INFERENCE**
  摘录：“2. **"无显著差异" ≠ "无差异/等质"**：p=0.161 是不拒绝原假设，不能作为"学科间无差异"的证据；且 V1 在最宽口径（是否提及）上本就最钝，容易不显著。”
  依据：p.5/src_a27702bca8444633b1ca-c14; p.12/src_a27702bca8444633b1ca-c66。
  审核：题项宽不直接决定效应/功效大小；未比较各题项关联，不能断最钝/易不显著。
- **F10 MATERIAL · OVERSTATED_SOURCE_CRITICISM**
  摘录：“3. **摘要与讨论互斥**：摘要称"notable differences across disciplines in their acceptance and regulation of AI"（c2, p.1），讨论却称无显…”
  依据：p.1/src_a27702bca8444633b1ca-c2; p.12/src_a27702bca8444633b1ca-c66; p.13/src_a27702bca8444633b1ca-c70。
  审核：notable描述差异与V1nonsignificant可以同时成立，原文亦说明描述差异；需限定维度而非互斥。
- **F11 额外/推论/轻微或外部未核 · MISCHARACTERIZED_RESULT_INFERENCE**
  摘录：“- c21/c22（p.7–8）把"未提及"直接称为"decisions"，并推断"a shared concern for the quality and accuracy of academic work"；c22 由 V17…”
  依据：p.7/src_a27702bca8444633b1ca-c21; p.8/src_a27702bca8444633b1ca-c22。
  审核：合成数据48.5%作者解释分裂是对近半频率解释，不全部是对缺失解释；应区分未提及/频率证据。
- **F12 额外/推论/轻微或外部未核 · OVERSTATED_EXCLUSIVITY**
  摘录：“1. **Online Appendix Table A1–A8**：367 本期刊名单与学科归属——**判定抽样框可复现性的唯一依据**。”
  依据：p.3/src_a27702bca8444633b1ca-c11; p.4/src_a27702bca8444633b1ca-c12; p.15/src_a27702bca8444633b1ca-c73。
  审核：A1–A8有用，但官方JCR+版本+筛选脚本/期刊名清单等可替代，不是唯一依据。
- **F13 MATERIAL · CONTRADICTED_BY_OWN_LIMITS**
  摘录：“**总体判断（审核者结论）**：该研究的**描述性统计部分高度自洽且可复算**（Table 2/4 的百分比、合计、χ²、信度均值均可由报告值重建），抽样框架与编码方案也已足够具体到可以被下一次研究复现。**主要问题不在算术，而在…”
  依据：p.4/src_a27702bca8444633b1ca-c12; p.4/src_a27702bca8444633b1ca-c13; p.7/src_a27702bca8444633b1ca-c20; p.15/src_a27702bca8444633b1ca-c73。
  审核：回答自己列版本/类别映射/期刊名单/编码判定不明确，不能同时声称已足够复现；后续可据骨架设计新研究不等同重现本研究。
- **F14 MATERIAL · OVERSTATED_GUARANTEE**
  摘录：“**总体判断（审核者结论）**：该研究的**描述性统计部分高度自洽且可复算**（Table 2/4 的百分比、合计、χ²、信度均值均可由报告值重建），抽样框架与编码方案也已足够具体到可以被下一次研究复现。**主要问题不在算术，而在…”
  依据：p.4/src_a27702bca8444633b1ca-c13; p.12/src_a27702bca8444633b1ca-c66; p.15/src_a27702bca8444633b1ca-c73。
  审核：不知原数据/重编码结果，改几项口径不足保证整体链自洽，仍有未审/缺材料。
- **F15 额外/推论/轻微或外部未核 · COVERAGE_OVERCLAIM**
  摘录：“| p.1 | c0–c6 | 题名、DOI、作者与机构、收稿/接受日期、摘要、关键词 |”
  依据：p.1/src_a27702bca8444633b1ca-c0; p.1/src_a27702bca8444633b1ca-c1; p.1/src_a27702bca8444633b1ca-c2; p.1/src_a27702bca8444633b1ca-c3; p.1/src_a27702bca8444633b1ca-c4; p.1/src_a27702bca8444633b1ca-c5; p.1/src_a27702bca8444633b1ca-c6。
  审核：有题名作者关键词实审，但摘要仅引用比例未完整逐句审核；此覆盖表不能证明全文所有页实质完审。
- **F16 MATERIAL · ENDMATTER_COVERAGE_OVERCLAIM**
  摘录：“| p.15 | c73–c80 | Limitations 四条、Supplementary、Funding、Conflict of interests、参考文献起（Bornmann、Cohen、COPE） |”
  依据：p.15/src_a27702bca8444633b1ca-c73; p.15/src_a27702bca8444633b1ca-c74; p.15/src_a27702bca8444633b1ca-c75; p.15/src_a27702bca8444633b1ca-c77; p.15/src_a27702bca8444633b1ca-c79。
  审核：资助无funder、无conflict两声明没有正文报告；仅说声明存在，不算实质审核。
- **F17 MATERIAL · ENDMATTER_COVERAGE_OVERCLAIM**
  摘录：“| p.17 | c141–c168 | 参考文献（Neuendorf 至 Zhang）、Publisher's Note、版权说明 |”
  依据：p.17/src_a27702bca8444633b1ca-c163; p.17/src_a27702bca8444633b1ca-c164; p.17/src_a27702bca8444633b1ca-c165; p.17/src_a27702bca8444633b1ca-c166; p.17/src_a27702bca8444633b1ca-c167; p.17/src_a27702bca8444633b1ca-c168。
  审核：PublisherNote/版权条款未实际陈述或审核。
- **F18 额外/推论/轻微或外部未核 · REFERENCE_COVERAGE_OVERCLAIM**
  摘录：“| p.16 | c81–c140 | 参考文献（de Winter 至 Naik） |”
  依据：p.16/src_a27702bca8444633b1ca-c81; p.16/src_a27702bca8444633b1ca-c140。
  审核：只记录reference页范围且声明未外部真伪，不曾文内完整核对；可标来源范围非审核覆盖。

定位、引用及覆盖声明：

- “| p.5 | c14–c15 | Codebook V1–V5 |”：c15包括V5–V8前段，不止V1–V5；c16页6接V8–V11，coverage行V6–V15错界。
- “| 最小期望频数 | ">5" | 最小为 ethics-Yes 6.675 | ✓ |”：实际14*175/367=6.675749，应3位四舍五入6.676；不影响>5，轻微舍入。
- “| χ²(7) | 10.51 | 逐格重算 Σ(O−E)²/E ≈ **10.52** | ✓（四舍五入） |”：复算10.519常规2位10.52，并非原10.51严格四舍五入吻合；p不变。

逐项事实覆盖：

- RQ及目标：covered（p.3/src_a27702bca8444633b1ca-c9; p.3/src_a27702bca8444633b1ca-c10）
- 367样本及8学科计数：covered（p.3/src_a27702bca8444633b1ca-c9）
- 2023JCRQ1/WoS范围：covered（p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12）
- 学科选择及Q1局限：covered（p.4/src_a27702bca8444633b1ca-c12）
- 收集日期：covered（p.4/src_a27702bca8444633b1ca-c13）
- 18变量四簇：covered（p.4/src_a27702bca8444633b1ca-c13; p.5/src_a27702bca8444633b1ca-c14; p.5/src_a27702bca8444633b1ca-c15; p.6/src_a27702bca8444633b1ca-c16; p.6/src_a27702bca8444633b1ca-c17; p.6/src_a27702bca8444633b1ca-c18; p.7/src_a27702bca8444633b1ca-c19）
- presence而非permission：covered（p.4/src_a27702bca8444633b1ca-c13; p.9/src_a27702bca8444633b1ca-c59）
- A367/B55随机15%：covered（p.7/src_a27702bca8444633b1ca-c20）
- 首轮.55/.55/.53及二次编码：covered（p.7/src_a27702bca8444633b1ca-c20）
- 最终>=.65/均值.80SD.13：covered（p.7/src_a27702bca8444633b1ca-c20）
- 表2全部18freq/percent：covered（p.9/src_a27702bca8444633b1ca-c41; p.9/src_a27702bca8444633b1ca-c42; p.9/src_a27702bca8444633b1ca-c43; p.9/src_a27702bca8444633b1ca-c44; p.9/src_a27702bca8444633b1ca-c45; p.9/src_a27702bca8444633b1ca-c46; p.9/src_a27702bca8444633b1ca-c47; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c50; p.9/src_a27702bca8444633b1ca-c51; p.9/src_a27702bca8444633b1ca-c52; p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c55; p.9/src_a27702bca8444633b1ca-c56; p.9/src_a27702bca8444633b1ca-c57; p.9/src_a27702bca8444633b1ca-c58; p.9/src_a27702bca8444633b1ca-c59）
- draft73.8/transparency61.3/literature0：covered（p.7/src_a27702bca8444633b1ca-c21; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c56）
- privacy12/verify11.2/IP54.5：covered（p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c56; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 175yes/192no八学科表4：covered（p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64; p.12/src_a27702bca8444633b1ca-c65; p.12/src_a27702bca8444633b1ca-c67）
- χ²10.51p.161V.119原值/复算V.169：covered（p.12/src_a27702bca8444633b1ca-c66）
- 学科叙述与因果边界：covered（p.10/src_a27702bca8444633b1ca-c61; p.11/src_a27702bca8444633b1ca-c62）
- 讨论和规范建议：covered（p.13/src_a27702bca8444633b1ca-c69; p.13/src_a27702bca8444633b1ca-c70; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 四项局限：covered（p.15/src_a27702bca8444633b1ca-c73）
- funder/conflict/endmatter：absent（p.15/src_a27702bca8444633b1ca-c74; p.17/src_a27702bca8444633b1ca-c163; p.17/src_a27702bca8444633b1ca-c164; p.17/src_a27702bca8444633b1ca-c165; p.17/src_a27702bca8444633b1ca-c166; p.17/src_a27702bca8444633b1ca-c167; p.17/src_a27702bca8444633b1ca-c168）

六项来源caveat：

- mention/permission矛盾：covered
- 描述≠显著及V1范围：partial
- politicalresidual-2.3与none significant冲突：absent；虽重建残差，却未指出作者none deviations significant与|-2.3|>1.96的潜在矛盾；应条件于未校正探索性残差标准。
- 表解析破碎/图表3无cell：covered
- A1-A9未另提供：covered
- V9信度常量/full.5与V18zero：partial

## old-r3-science

Runtime completion：0。19facts：covered/partial/absent=12/2/5，13/19。6caveats：5/1/0，5.5/6。Physical/effective/retry=1/1/0。

全部额外断言与缺陷（material只是分层，不代替完整清单）：

- **F01 额外/推论/轻微或外部未核 · OVERSTATED_SOURCE_ABSENCE**
  摘录：“4. **表 3 热图单元格值未在本次片段中出现**：p.10 c60 只有表题和图例，所有学科百分比无法从本次片段复核。  ”
  依据：p.10/src_a27702bca8444633b1ca-c60; p.10/src_a27702bca8444633b1ca-c61; p.11/src_a27702bca8444633b1ca-c62。
  审核：无热图cells真实，但正文c61/62供23学科百分比可核原文及整数相容性，非所有无可核。
- **F02 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STANDARD**
  摘录：“6. **表 4 调整残差与文字“均不显著”存在张力**：政治科学 Yes 调整残差约 −2.3，超过常用 ±1.96 参考值；但整体 χ² 不显著且未做多重比较校正。  ”
  依据：p.12/src_a27702bca8444633b1ca-c66。
  审核：以normaluncorrected threshold提出残差张力合理且披露multiplecomparison，但外部标准原著未给；不判materialfalse。
- **F03 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_STANDARD**
  摘录：“7. **信度阈值和精度**：作者用“≥0.65”为可接受（p.7 c20），但 V8、V11、V12、V16 的 95% CI 下限为 0.13（p.8 c30, c33, c34, c38），远低于常用 0.80 门槛。  ”
  依据：p.7/src_a27702bca8444633b1ca-c20; p.16/src_a27702bca8444633b1ca-c120。
  审核：原文>=.65与CI.13正确，外部.8要求未供正文。
- **F04 额外/推论/轻微或外部未核 · OVERSTATED_SAMPLING_INFERENCE**
  摘录：“| 不是随机样本 | 这是对选定 Q1 期刊的普查式/目的性抽样，而非从社会科学期刊总体随机抽样。 | 若目标是描述这 367 本刊，χ² 可作描述性关联；若推断总体，需说明样本框和权重。 |”
  依据：p.3/src_a27702bca8444633b1ca-c9; p.3/src_a27702bca8444633b1ca-c11; p.4/src_a27702bca8444633b1ca-c12。
  审核：Q1选择目的性成立，但类目内具体纳入筛选未供，不能确认普查式；应限制对全部socialscience非概率代表性。
- **F05 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“| 期刊嵌套于出版社 | 作者指南常由出版社统一制定，同一出版社期刊不独立。 | `[审核者推论]` 卡方独立性假设可能被违反；建议按出版社聚类稳健标准误或多层模型。 |”
  依据：p.4/src_a27702bca8444633b1ca-c12; p.15/src_a27702bca8444633b1ca-c73。
  审核：本样本无出版方分布/政策模板，同出版社并不必然观测不独立。
- **F06 额外/推论/轻微或外部未核 · UNSUPPORTED_DIRECTIONAL_INFERENCE**
  摘录：“| Q1 选择截断 | 只取 Q1 会限制变异，可能低估学科差异。 | 作者已在局限 p.15 c73 承认；可补充 Q2–Q4 或 Scopus。 |”
  依据：p.4/src_a27702bca8444633b1ca-c12; p.15/src_a27702bca8444633b1ca-c73。
  审核：限定Q1影响推广，但限制变异不必然低估组间差异，原c73只generalizability非方向。
- **F07 额外/推论/轻微或外部未核 · UNPROVIDED_EXTERNAL_FACT**
  摘录：“| 时间敏感性 | 2024 年 5–6 月快照，AI 政策变化快。 | 建议报告每刊指南抓取日期、版本；做纵向复测。 |”
  依据：p.14/src_a27702bca8444633b1ca-c72。
  审核：当前论文未有policy纵向速率证据，未来展望不能确认速度。

定位、引用及覆盖声明：

- “8. **“首次”主张未提供系统检索证据**：p.3 c9、p.4 c12、p.13 c69 称“first study”“first systematic evidence”，本次片段未提供检索策略或查新依据。`[审核者推论]`…”：first systematic evidence实际c73p15，不在c69；c69说amongfirst非firstsystematic。
- “- **V8 Peer review**（p.5 c15–c16）：是否提及 AI 用于同行评审。  ”：c16页6，标题p5 c15–16页界不精确。

逐项事实覆盖：

- RQ及目标：covered（p.3/src_a27702bca8444633b1ca-c9; p.3/src_a27702bca8444633b1ca-c10）
- 367样本及8学科计数：covered（p.3/src_a27702bca8444633b1ca-c9）
- 2023JCRQ1/WoS范围：covered（p.3/src_a27702bca8444633b1ca-c9; p.4/src_a27702bca8444633b1ca-c12）
- 学科选择及Q1局限：covered（p.4/src_a27702bca8444633b1ca-c12）
- 收集日期：covered（p.4/src_a27702bca8444633b1ca-c13）
- 18变量四簇：covered（p.4/src_a27702bca8444633b1ca-c13; p.5/src_a27702bca8444633b1ca-c14; p.5/src_a27702bca8444633b1ca-c15; p.6/src_a27702bca8444633b1ca-c16; p.6/src_a27702bca8444633b1ca-c17; p.6/src_a27702bca8444633b1ca-c18; p.7/src_a27702bca8444633b1ca-c19）
- presence而非permission：covered（p.4/src_a27702bca8444633b1ca-c13; p.9/src_a27702bca8444633b1ca-c59）
- A367/B55随机15%：covered（p.7/src_a27702bca8444633b1ca-c20）
- 首轮.55/.55/.53及二次编码：covered（p.7/src_a27702bca8444633b1ca-c20）
- 最终>=.65/均值.80SD.13：covered（p.7/src_a27702bca8444633b1ca-c20）
- 表2全部18freq/percent：partial（p.9/src_a27702bca8444633b1ca-c41; p.9/src_a27702bca8444633b1ca-c42; p.9/src_a27702bca8444633b1ca-c43; p.9/src_a27702bca8444633b1ca-c44; p.9/src_a27702bca8444633b1ca-c45; p.9/src_a27702bca8444633b1ca-c46; p.9/src_a27702bca8444633b1ca-c47; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c50; p.9/src_a27702bca8444633b1ca-c51; p.9/src_a27702bca8444633b1ca-c52; p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c55; p.9/src_a27702bca8444633b1ca-c56; p.9/src_a27702bca8444633b1ca-c57; p.9/src_a27702bca8444633b1ca-c58; p.9/src_a27702bca8444633b1ca-c59）
- draft73.8/transparency61.3/literature0：covered（p.7/src_a27702bca8444633b1ca-c21; p.9/src_a27702bca8444633b1ca-c48; p.9/src_a27702bca8444633b1ca-c49; p.9/src_a27702bca8444633b1ca-c56）
- privacy12/verify11.2/IP54.5：partial（p.9/src_a27702bca8444633b1ca-c53; p.9/src_a27702bca8444633b1ca-c54; p.9/src_a27702bca8444633b1ca-c56; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 175yes/192no八学科表4：absent（p.11/src_a27702bca8444633b1ca-c63; p.11/src_a27702bca8444633b1ca-c64; p.12/src_a27702bca8444633b1ca-c65; p.12/src_a27702bca8444633b1ca-c67）
- χ²10.51p.161V.119原值/复算V.169：covered（p.12/src_a27702bca8444633b1ca-c66）
- 学科叙述与因果边界：absent（p.10/src_a27702bca8444633b1ca-c61; p.11/src_a27702bca8444633b1ca-c62）
- 讨论和规范建议：absent（p.13/src_a27702bca8444633b1ca-c69; p.13/src_a27702bca8444633b1ca-c70; p.14/src_a27702bca8444633b1ca-c71; p.14/src_a27702bca8444633b1ca-c72）
- 四项局限：absent（p.15/src_a27702bca8444633b1ca-c73）
- funder/conflict/endmatter：absent（p.15/src_a27702bca8444633b1ca-c74; p.17/src_a27702bca8444633b1ca-c163; p.17/src_a27702bca8444633b1ca-c164; p.17/src_a27702bca8444633b1ca-c165; p.17/src_a27702bca8444633b1ca-c166; p.17/src_a27702bca8444633b1ca-c167; p.17/src_a27702bca8444633b1ca-c168）

六项来源caveat：

- mention/permission矛盾：covered
- 描述≠显著及V1范围：covered
- politicalresidual-2.3与none significant冲突：covered；虽重建残差，却未指出作者none deviations significant与|-2.3|>1.96的潜在矛盾；应条件于未校正探索性残差标准。
- 表解析破碎/图表3无cell：covered
- A1-A9未另提供：covered
- V9信度常量/full.5与V18zero：partial


## A2 来源质量与持久化结果终审（18案例）

同一客观标准：lumen需游标6/v2并正确保存UTC；window需游标61并保存6项明确约定（#1/#15/#30/#45/#60/#61）；tail需当前21天且旧14天历史保留。额外未支持断言另记提案质量，不抵消已保存核心事实。initial失败保持为失败，即使revision调用恢复它。顶层error:null不能替代stage结果。

完整source逐条检查正文、title、payload与rationale；quote可定位不等于整条断言受支持。全source事实支持、短quote完整性、重复/持久实用性分别判断。下表raw分子分母包括完整provider输出（即使fenced/INVALID_EVIDENCE后被拒绝）；实际proposal分母只算实际产生提案。0/0表示无提案，不是100%准确。

| 版本轮次 | 案例 | 客观成功 | 原阶段状态 | 支持raw候选 | 支持实际提案 | 基础设施 | 每题实际原因/结果 |
|---|---|---|---|---|---|---|---|
| new 1 | lumen | 否 | failed / failed | 4/5 | 0/0 | 终结交付故障 | 两个阶段应用交付失败；未完成初版检查点使第二次仍发 #1–4/v1，未发 UTC 修订；游标0。 |
| new 1 | tail | 否 | failed | 4/4 | 0/0 | 终结交付故障 | 完整4候选 stop 后应用交付失败，未比较；14天seed保持。 |
| new 1 | window | 否 | failed | 7/7 | 0/0 | 终结交付故障 | 完整61条和6核心事实候选已返回，但应用交付失败；零保存。 |
| old 1 | lumen | 否 | completed / failed | 6/6 | 2/2 | 无 | 初版完成，修订比较 8192 输出 token 全用于推理，UTC 未保存；4/v1。 |
| old 1 | tail | 否 | failed | 6/6 | 0/0 | 无 | 模型完整 stop，6候选包在 JSON fence，旧严格解析器 INVALID_JSON；零提案、14天保持。 |
| old 1 | window | 否 | failed | 0/0 | 0/0 | 恢复重试 1 | 只发送 #1–22；一次网络重试后 8192 推理耗尽，零事实，游标0。 |
| new 2 | lumen | 是 | failed / completed | 7/9 | 4/5 | 恢复重试 1 | 初版INVALID_EVIDENCE失败；修订调用恢复初版再完成UTC，6/v2。1项目名goal仍被接受；local初版仍active无替代链接。 |
| new 2 | tail | 是 | completed | 5/5 | 4/4 | 无 | 完成2，正确supersede旧14→21，4079字旧协议/snapshot/link保持；3较细记录与旧协议部分语义重叠。 |
| new 2 | window | 否 | completed | 6/6 | 5/5 | 无 | 完成61，5/6事实；frequency正文附过程句未入短quote，比较整条noop、游标前进。 |
| old 2 | lumen | 是 | completed / completed | 4/4 | 3/3 | 无 | 两阶段完成；初版2create，UTC正确supersede、重复终点noop；6/v2。 |
| old 2 | tail | 否 | failed | 0/0 | 0/0 | 无 | 完整来源已送，8192推理耗尽/零文本，MODEL_FAILED；21未保存。 |
| old 2 | window | 否 | completed | 2/3 | 2/2 | 无 | 批次完成22/61，仅保存#1/#15，39条未处理，另一个错误全称episode被noop。 |
| new 3 | lumen | 是 | completed / completed | 4/4 | 3/3 | 无 | 初版完成，UTC正确supersede，独立重复旧方案history noop；6/v2。 |
| new 3 | tail | 是 | completed | 5/5 | 1/1 | 无 | 正确supersede14→21，旧4079字协议及snapshot/link保持，4重复候选noop；游标2。 |
| new 3 | window | 是 | completed | 6/9 | 5/7 | 无 | 61游标+全部6核心事实，另2条接受正文有未支持额外断言；recap错误5/6count noop。 |
| old 3 | lumen | 否 | completed / failed | 3/4 | 1/2 | 无 | 初版完成含轻微未支持英文alias；修订比较8192推理耗尽，4/v1、UTC未保存。 |
| old 3 | tail | 否 | failed | 5/5 | 0/0 | 无 | 完整5支持候选stop返回；旧 INPUT_BUDGET_EXCEEDED 在比较前阻止第二请求，游标0。 |
| old 3 | window | 否 | completed | 3/3 | 2/2 | 无 | 完成22/61，只有#1/#15，后39条未输入，processnote noop。 |

### 三轮均值

| 版本 | 全9案例客观成功 | 排终结infra后客观成功 | 实际提案支持micro | 完整raw候选支持micro（eligible） | 各轮客观成功 |
|---|---|---|---|---|---|
| old | 1/9 (11.1%) | 1/9 (11.1%) | 10/11 (90.9%) | 29/31 (93.5%) | 0/3, 1/3, 0/3 |
| new | 5/9 (55.6%) | 5/6 (83.3%) | 22/25 (88.0%) | 33/38 (86.8%) | 0/3, 2/3, 3/3 |

| 版本 | 题目 | 同题三轮客观成功均值 |
|---|---|---|
| old | lumen | 1/3 (33.3%) |
| old | window | 0/3 (0.0%) |
| old | tail | 0/3 (0.0%) |
| new | lumen | 2/3 (66.7%) |
| new | window | 1/3 (33.3%) |
| new | tail | 2/3 (66.7%) |

new-r1三个A2应用streamdelivery终结故障排除模型质量分母，但留在全应用成功9案例分母。其16raw候选15支持/1未支持，作为描述性证据保留；不纳入eligible raw质量均值。旧window一次网络重试后模型length最终失败、新r2lumen一次恢复网络重试，都保留最终模型/应用结果，不整体排除。原压缩会话均完整，首次251–253字header是derived首zstd帧解码缺陷，已恢复10会话assistant/message+turn/end；不算持久日志损坏或终结infra。

非空案例提案支持macro均值：old 90.00%（5非空case，4空case不当100%），new 91.90%（6eligible非空case）。主要可比较结果是核心任务完成率提高，未支持额外断言仍存在；不声称记忆准确率提高。三轮小样本、顺序执行、new-r1交付故障与后续只补未attempted案例的runner-drain修订需披露，不能把不同分母混成严格因果效应。

### 全部未支持候选与是否落成提案

正文/载荷仅摘取未支持候选，不复制完整fixture或会话。wire序号:index均0-based候选index。source定位按固定原消息编号；“proposed是”均由评测fixture接受，不能误称真实用户审查。

| case / wire:index | 相关正文 | 载荷 | 实际proposed/accepted | 来源定位与判定 |
|---|---|---|---|---|
| new-r1-lumen / 2:0 | 用户编辑的当前纪要新增条目记录研究目标为「微光项目」。对应原始用户消息确立了该项目及其主要终点，但没有给出更细化的交付或验收标准。 | {"project":"微光项目","goal":"微光项目"} | 否 | Titleprojectname doesnotestablishsubstantiveresearchgoal; SOURCE_SUPPORT_RULE explicitly prohibits goalinferredonlyfromname. "没有给出更细化的交付或验收标准" isabsencefromboundedinput, notdurableprojectfact. Userminutesliterally研究目标：微光项目 isweakplaceholder, notscientificgoal. |
| new-r2-lumen / 1:2 | 微光项目本身被列为研究目标。 | {"project":"微光项目","research_goal":"微光项目"} | 否 | Literal minutes heading exists, but treating project name as substantive research goal violates explicit omit-goals-inferred-only-from-project-name rule. Invented minutes-delta-r1 ID is not an original message. |
| new-r2-lumen / 3:0 | 微光项目被记录为研究目标。该批次消息显示微光项目已确定主要终点为夜间照度。 | {"project":"微光项目","goal":"微光项目研究目标"} | 是，fixture接受 | Endpoint clause supported by#1; goal=project-name interpretation remains unsubstantive/inadmissible under SOURCE_SUPPORT_RULE. Exact endpoint quote does not establish goal payload. Literal minutes heading caveat preserved. |
| old-r2-window / 1:2 | 第2至第22次记录均声明“没有新增决定”，且每条单次测量（温度、盐度、传感器漂移）都标注为“这是单次原始观察，不设定新的研究约定”。因此除第1次和第15次确认的约定外，本批次未产生新的研究约定。 | {"recordRange":"第2–22次记录","newDecisions":false,"observationNature":"单次原始观察"} | 否 | Body says everyrecord2–22declaresnonewdecision, butrecord15explicitlyconfirmsanomalyconvention. Finalexcept1/15clause doesnotremove contradictoryuniversalopening andpayloadnewDecisions:false/range2–22. Observationssingle/notnewagreementall22true. Episodeprocessrecap weakdurableutility; comparisonnoop correct; quotedu1differentvalidpassages notintrinsicinconsistency. |
| new-r3-window / 1:1 | 在虚构潮间带研究第15次记录中，用户确认研究约定：异常记录保留原始值并另列质量标记。少数记录以“没有新增决定”开头，表示本次记录未新增决定。 | {"scope":"虚构潮间带研究","convention":"anomalous-record-handling","value":"保留原始值并另列质量标记","messageOrdinal":15,"status":"unconfirmed"} | 是，fixture接受 | Coreanomalyfact exact#15. Added“少数记录以没有新增决定开头” isquantitativefalse:55/61recordsno-newdecision, majority. Comparison calledcontextual butwholebodyincludesit; persistedunsupportedminorquantifier. |
| new-r3-window / 1:6 | 当前批次覆盖虚构潮间带研究第1次至第61次记录，共61条用户消息。每条记录按通道1至通道8报告当次温度（摄氏度）、盐度（PSU）与传感器漂移（PSU）。多数记录标注“没有新增决定”。5条记录中明确确认了研究约定：第1次（采样频率10分钟）、第15次（异常记录保留原始值并另列质量标记）、第30次（盐度仪每周一完成两点校准）、第45次（复核负责人为林砚）、第60次（交付格式采用Parquet）、第61次（数据时间统一记录为UTC）。各记录明确说明当次通道读数是单次原始观察，不设定新的研究约定。当前批次为第1至61条，后续来源部分仍可能存在。 | {"scope":"虚构潮间带研究","recordRange":"1-61","recordCount":61,"channels":8,"decisionRecords":[1,15,30,45,60,61],"status":"unconfirmed","note":"数值为单次原始观察，本文不逐条复制。"} | 否 | Body“5条记录” thenlists6 explicitdecisionrecords; sourceactual6 (#1,15,30,45,60,61). Other61/8channel/majority/rawfacts fullsource true. Speculativefuturepossible unnecessary; controlrecapweakutility. Nooppreventsbadcount. |
| new-r3-window / 1:7 | 每条记录在报告通道1至通道8的温度、盐度与传感器漂移后，均声明该次数值是单次原始观察，不设定新的研究约定。因此这些逐次读数不应被当作研究约定，仅凭当前批次也不能推断常规测量周期、数值范围或漂移阈值。 | {"scope":"虚构潮间带研究","observationType":"single raw observation per channel per record","status":"unconfirmed"} | 是，fixture接受 | Per-channelraw/nonconvention statement truefullsource, butadded“仅凭当前批次也不能推断常规测量周期” conflicts withexplicit#1confirmed10minsamplingfrequency; numericrange availabledirectlyfromdata, unspecifiedcalibrationthresholdnotestablishedabsenceclaim. Atleastperioddenialunsupported; acceptedwholebody. |
| old-r3-lumen / 1:0 | 微光项目（Lumen）的主要终点确定为夜间照度，来源表述为一项内部研究决定。 | {"project":"微光项目","item":"主要终点","value":"夜间照度","status":"determined"} | 是，fixture接受 | Endpoint/internaldecisionexact#1, butbodyaddsEnglishalias(Lumen) notpresentanyactualextractsource/minutesprompt. Messageidprefixlumen islocator, notverifiedprojectalias. Markwholecandidate notfullysupported;minor unsupportednameaddition, notscientificendpointfabrication. |

其中new-r2初始goal/todo另有不存在的minutes-delta-r1 evidence ID：todo内容在用户v1纪要明确出现，事实支持但证据ID无效；该表不把它当事实编造。old-r3英文Lumen是轻微未支持别名，endpoint本身正确。new-r3window“少数”实际55/61多数、额外测量周期否定与#1明确10分钟冲突，core anomaly/frequency仍正确。new-r3window lesson基于多数no-new+全部observation声明，逻辑不从重复pattern新增约定由来源可支持，但复用lesson/过程回顾实用性弱，noop；不把quote短当全source错误。

### 长文与历史、费用

new-r2/new-r3tail均实际比较完整4079字旧协议，尾部14天可见，21天正确supersede并保存旧状态/快照/链接。所有paid候选body仍小于3000字符；不能声称这组付费实验已证明>3000新候选接收。new-r2lumen初始失败恢复形成pending初版与revision提案，fixture最后统一接受，比较items确实空；old-r2/new-r3初版先接受后revision能取supersede目标，时序差异需说明。new-r2tail3create粒度细事实已经出现在旧完整协议，是部分语义重叠/检索覆盖问题；new-r3取fullseed后4noop。没有严格同事实重复accepted计数不代表无所有语义重叠。

A2费用canonicalledger：old 150484 known tokens + 1 unknown-usage requests，21physical/20effective/1retry；new 302049 known tokens + 1 unknown-usage requests，22physical/21effective/1retry。cached与reasoning是input/output子集，不重复相加。Product预算reservation估计不加到provider账单。全部本审计零paidcalls/零key或用户DB读取/未修改原结果或产品。

可复核ignored artifacts：a2-paid-matrix.json（18行/denominator/hashes）、a2-paid-r1-raw-erratum.json、各case a2-paid-*-r*-*.json与inspect.json。
