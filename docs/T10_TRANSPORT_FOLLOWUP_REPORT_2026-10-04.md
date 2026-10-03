# T10 传输补充交付报告（2026-10-04）

交付分支：`codex/t10-transport-followup-20261003`，直接叠加已推送的 T10 传输 `4f5506d29ed69c060a168d64e9e2d48784fad307`。本分支不含独立 T21 `codex/t21-secret-isolation-20261003@a337af9757659c26a4861317c365dfd71b51b616` 的产品改动；两条分支需由 Claude 协调审阅。最终远端 SHA 见同轮用户交付报告。不开 PR、不合并。工作区为 H:\ScienceScope_v0.1-desktop，origin 为 peroperoyui-lab/sciencescope_v0.1。

本轮完成复合引用解析、未知格式审计、三处不稳定测试加固，以及修复后的 52 题三轮观察。此前六题独立补跑核心 6/6、22 请求、334380 tokens 已在 4f5506d 交付，原记录保留。历史 43/42/39 均为单轮；不能凭本次三轮和历史单轮断言改动的因果效果。严格前后对照仍应各至少三轮。

先前六题诊断：评测显式 maxRetries:0，且把 attempt-failed 当成终态，导致第一次连接错误即结束；正式应用原本使用 DSH 默认暂时错误重试。旧六题均没有 retry 或 cap 拦截，所以“重试耗尽每题6请求上限”不是其原因；旧代理缺少连接错误码，不能恢复当时 socket/DNS/TLS/隧道的具体根因。现已将每题6个有效模型步骤与重试分开计数，并保留有限实际请求上限。真实 DSH＋本地先失败两次再成功夹具的生产 API 和 UI 回执见实施记录 2026-10-03 六题传输节。

三轮均使用 deepseek-v4.1-flash、相同题序/问法、相同八篇原文/1412 段、相同模型步骤预算 6、模型请求超时 120 秒/题目 180 秒。模型提示和工具相关八项源码哈希保持一致；第二轮中断后仅评测落盘修复改变 harness SHA。第三轮完成后只修答案后/DOM 提取未知引用候选，并另存离线派生语法回执，不改模型工具解析或原始结果。

| 轮次 | 核心完整 / 52 | 基础设施失败 | 质量分母 | 核心完整率 | 全部论断有依据且引用完整 | 实际请求 / 有效步骤 / 重试 | 用量未知请求 |
|---|---:|---:|---:|---:|---:|---|---:|
| 第1轮 | 40/52 | 1 | 51 | 78.43% | 22/51 | 229/216/13 | 14 |
| 第2轮（中断＋未尝试六题） | 41/52 | 2 | 50 | 82.00% | 20/50 | 211/203/8 | 9 |
| 第3轮 | 42/52 | 1 | 51 | 82.35% | 23/51 | 224/211/13 | 14 |

三轮平均核心完整 **41.00/52**；排除基础设施失败后的平均核心完整率 **80.93%**，平均全部论断有依据且引用完整 **21.67 题**。核心完整只判断题目要求，不能替代额外论断和引用支持审计。金标准冲突单列，不改题集、不把冲突答案刷成 full。

| 轮次 | 部分完整 | 错误 | 拒答 | 预算失败 | 工具偏离 | 金标准冲突 | 实质无依据论断数 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 第1轮 | 4 | 2 | 1 | 2 | 1 | 1 | 18 |
| 第2轮（中断＋未尝试六题） | 1 | 1 | 1 | 3 | 2 | 1 | 17 |
| 第3轮 | 0 | 1 | 0 | 3 | 4 | 1 | 10 |

第二轮原始进程在 45 题终结、know04 已完成三个模型请求后因 request-ledger 的 renameSync EPERM 崩溃。原 results、ledger、next、lock 保留。已提交账本有 191 次实际转发；next 的 192 含一个 transport 创建之前的预记请求，不能算付费流量。know04 不重发，仅六个尚未尝试题在独立 run 补齐，报告以 46＋6 的派生合成轮列明。第二轮原始 run 没有正常完成。

失败分类及每题请求/重试、末次 HTTP/连接类型完整记录在 ignored 多轮 JSON；传输失败不算科学回答错误，已恢复的早期网络错误不污染之后的失败分类。本地 budget429 与真实上游限流分开。

三轮共有3题传输超时（第1轮 dig03、第2轮补测 know06、第3轮 guide05）和1题本地 EPERM 基础设施中断。三次超时都是120秒代理 TIMEOUT/504 后发起一次 DSH 重试，题目180秒期限到达时取消该重试并记录499/TIMEOUT；upstreamStatus/errorCode 未取得，不能把代理504/499说成上游HTTP错误。know04末次真实上游200，失败发生在本地落盘。

| 轮次 | 题目 | 未成功原因 | 实际请求 / 步骤 / 重试 |
|---|---|---|---|
| 第1轮 | dig-03 | TIMEOUT (infrastructure) | 3/2/1 |
| 第1轮 | delphi-04 | budget (budget) | 6/6/0 |
| 第1轮 | phys-02 | tool_drift (tool_drift) | 5/5/0 |
| 第1轮 | know-07 | budget (budget) | 6/6/0 |
| 第2轮（中断＋未尝试六题） | eth-06 | tool_drift (tool_drift) | 3/3/0 |
| 第2轮（中断＋未尝试六题） | uslib-06 | budget (budget) | 6/6/0 |
| 第2轮（中断＋未尝试六题） | phys-02 | tool_drift (tool_drift) | 3/3/0 |
| 第2轮（中断＋未尝试六题） | phys-06 | budget (budget) | 7/6/1 |
| 第2轮（中断＋未尝试六题） | guide-02 | budget (budget) | 6/6/0 |
| 第2轮（中断＋未尝试六题） | know-04 | EPERM (infrastructure) | 3/3/0 |
| 第2轮（中断＋未尝试六题） | know-06 | TIMEOUT (infrastructure) | 2/1/1 |
| 第3轮 | uslib-04 | tool_drift (tool_drift) | 3/3/0 |
| 第3轮 | uslib-05 | tool_drift (tool_drift) | 3/3/0 |
| 第3轮 | uslib-06 | tool_drift (tool_drift) | 6/6/0 |
| 第3轮 | delphi-05 | tool_drift (tool_drift) | 5/4/1 |
| 第3轮 | guide-05 | TIMEOUT (infrastructure) | 2/1/1 |
| 第3轮 | know-04 | budget (budget) | 6/6/0 |
| 第3轮 | know-05 | budget (budget) | 7/6/1 |
| 第3轮 | know-07 | budget (budget) | 6/6/0 |

guide04 的 frozen gold 写了作者身份，但实际代码本是四组、18 个变量，并无作者身份变量；保留原 gold，源准确回答记 gold_conflict。错页引用、正确但未引注的方法建议单列；可人读且有原文支持的 pp./重复 p/页列表格式不会因解析器不认识就被判无科学依据。

真实请求用量（三轮本次新增，不加旧六题，不加独立 T21）：

| 轮次 | prompt | completion | 已知 total tokens | cached（prompt 子集） | reasoning（completion 子集） |
|---|---:|---:|---:|---:|---:|
| 第1轮 | 3079361 | 77363 | 3156724 | 2595328 | 29836 |
| 第2轮（中断＋未尝试六题） | 2800450 | 70084 | 2870534 | 2368256 | 27495 |
| 第3轮 | 3082474 | 75747 | 3158221 | 2593536 | 29814 |

合计 **664** 次实际转发、630 个有效步骤、34 次网络重试；已知 token **9185479**，另有 37 次请求没有 usage，未估填。离线来源审计及本地模拟 smoke 不调用付费判分。key 不打印、不复制、不进入 Git。

## 逐题对比

F=核心完整，P=部分，W=错误，A=拒答，X=无完整答案，G=金标准冲突；本次 X 的具体预算/工具/基础设施原因见上表。旧六题补跑不覆盖历史 39 分记录。

| 题目 | 第1批43 | 第3批42 | 回答改进39 | 本轮1 | 本轮2合成 | 本轮3 |
|---|---|---|---|---|---|---|
| eth-01 | F | F | X | F | F | F |
| eth-02 | F | F | F | F | F | F |
| eth-03 | F | F | F | F | F | F |
| eth-04 | F | F | X | F | F | F |
| eth-05 | F | F | F | F | F | F |
| eth-06 | F | F | F | F | X | F |
| uslib-01 | X | F | F | F | F | F |
| uslib-02 | F | F | F | F | F | F |
| uslib-03 | F | F | X | F | F | F |
| uslib-04 | F | X | P | P | P | X |
| uslib-05 | F | F | F | P | F | X |
| uslib-06 | X | F | F | F | X | X |
| talent-01 | F | F | F | F | F | F |
| talent-02 | F | F | F | F | F | F |
| talent-03 | F | F | F | F | F | F |
| talent-04 | F | F | F | F | F | F |
| talent-05 | F | F | F | F | F | F |
| talent-06 | F | F | X | F | F | F |
| dig-01 | F | F | F | F | F | F |
| dig-02 | F | F | X | F | F | F |
| dig-03 | F | F | F | X | F | F |
| dig-04 | F | F | X | F | F | F |
| dig-05 | F | F | F | F | F | F |
| dig-06 | F | F | F | F | F | F |
| delphi-01 | F | F | F | F | F | F |
| delphi-02 | F | F | F | F | F | F |
| delphi-03 | A | W | W | W | W | W |
| delphi-04 | F | F | F | X | F | F |
| delphi-05 | W | X | X | F | A | X |
| delphi-06 | F | F | F | F | F | F |
| phys-01 | F | F | F | P | F | F |
| phys-02 | F | X | F | X | X | F |
| phys-03 | F | X | F | F | F | F |
| phys-04 | F | F | F | F | F | F |
| phys-05 | F | F | F | F | F | F |
| phys-06 | F | P | P | P | X | F |
| guide-01 | F | F | F | F | F | F |
| guide-02 | F | F | F | F | X | F |
| guide-03 | X | F | F | F | F | F |
| guide-04 | G | G | G | G | G | G |
| guide-05 | X | X | X | F | F | X |
| guide-06 | F | F | F | F | F | F |
| know-01 | F | F | F | A | F | F |
| know-02 | F | F | F | F | F | F |
| know-03 | F | F | F | F | F | F |
| know-04 | F | F | F | W | X | X |
| know-05 | F | F | X | F | F | X |
| know-06 | F | F | F | F | X | F |
| phys-07 | F | F | F | F | F | F |
| guide-07 | F | F | F | F | F | F |
| know-07 | X | X | F | X | F | X |
| dig-07 | X | X | F | F | F | F |

## 额外无依据论断，逐题记录

以下仅为实质无依据或与原文矛盾的论断；逐题审计和原回答哈希在本地 audit JSON。具体来源矛盾附原文引文及段哈希；全库缺失断言若只经过有界检索，按证据不足单列，不声称有穷尽性反证。原回答、日志和论文原件不入 Git。

| 轮次 | 题目 | 论断摘录 | 原因 |
|---|---|---|---|
| 第1轮 | eth-04 | 主题化的成熟度 | Indicator granularity and counts do not establish comparative maturity; this heading interprets the source without labeling the inference. |
| 第1轮 | eth-04 | 资源投入差异 | The survey records activities/content and counts, not comparative resource investment. The cited p2 sampling passage does not measure resource inputs. |
| 第1轮 | uslib-02 | 未见 K-12 或社会公众层面的证据 | A bounded search/read does not establish absence across the full corpus. This uncited corpus-wide absence/coverage assertion exceeds the inspected evidence. |
| 第1轮 | uslib-02 | 文献未提供中小学或职业/终身学习层次的具体划分 | S4 p2 discusses US K12 and Finnish whole-population education. No searched excerpt is sufficient to establish broad absence of all these categories. |
| 第1轮 | uslib-04 | 现有资料对该小组仅有上述概括性描述 | Overstates absence of organizational mechanisms: p9c77 explicitly supplies multi-institution sponsorship/support and collaboration/discussion mechanism, missed in the answer. |
| 第1轮 | talent-01 | 没有**专门针对 | A bounded search/read does not establish absence across the full corpus. This uncited corpus-wide absence/coverage assertion exceeds the inspected evidence. |
| 第1轮 | dig-01 | 依次加入个体、家庭、地区特征后系数为 3.0450、3.7847、3.6760 | These are columns1–3: no controls, individual controls, then household controls; full region-control column4 is0.5264. Answer incorrectly assigns the first3 numbers to the three added control tiers. |
| 第1轮 | dig-05 | 我只能据 \|t\|≈3.96 推断其显著 | S8p10c36 explicitly states Dige11.3205,SSL3.9146 andSSL×Dige−36.8256都通过了1%水平的显著性检验; no inference is required. Table-body stars might be imperfect, but ignoring explicit prose falsely understates available evidence. |
| 第1轮 | phys-01 | 覆盖 **2 个国家**：美国与加纳；另有约旦的 1 所大学也属于选定对象 | Abstract says four universities in Ghana, Jordan, and USA; methods includes Jordan university as surveyed participant, not a non-survey supplement. |
| 第1轮 | phys-03 | 正文先后称 TAM 有"五个构念"却列出 PEU、PU、ATU、BI、UB ... 此处表述并不自洽 | Five labels are exactly five constructs; expansion into a later extended model does not establish a source inconsistency. Corpus describes TAM2/UTAUT expansion explicitly. |
| 第1轮 | phys-05 | CFI/TLI(≥0.95 为满意) | CFI is >=0.95 in c43, but TLI is strictly greater than0.95 in c44; grouped inequality wrongly includes the boundary for TLI. |
| 第1轮 | phys-06 | 其措辞属于两类：变量间**关系/关联强度** ... **调节作用** ... **群体差异** | The answer enumerates three classes after claiming two. More importantly source lists five study questions, including explicit frequency relation absent from the answer. |
| 第1轮 | guide-01 | 论文把 ethics、healthcare 也归入"社会科学学科"，这一归类属作者的界定，可能有争议 | Source gives the selected fields and broader-scope limitation, but does not raise a controversy about ethics/healthcare classification. This is an unsupported additional interpretive concern. |
| 第1轮 | guide-02 | 结果部分出现「所有类别合计 192 篇指南」的表述 [S6 p.14–15]，与前述 367 本期刊样本量的关系，摘录中未交代清楚 | pp14-15 have no such total;192 is the Table2 No count for mentionAI (175Yes+192No=367). Ambiguity is invented rather than source uncertainty. |
| 第1轮 | guide-05 | 库内没有其他证据可以佐证或反驳上述发现 | Returned snippets/selectedsource reads do not prove an exhaustive absence of all corroboration or contradiction across8sources. S4 itself discusses AI literature-review services, so excluding all other evidence is overbroad even if its population differs. |
| 第1轮 | know-02 | 本地库中只有一篇与"知识图谱"研究方法直接相关的文献 | Search/read evidence identifies S1 as relevant but is not exhaustive verification that only one source can be relevant. |
| 第1轮 | know-04 | 交叉是"技术—应用"驱动的，尚未形成理论层面的整合 ... 学科间概念融合度低 | Keywordclusters andsame-school sparsecooperation do not measureconceptualfusion or absenceoftheoreticalintegration; answer turns plausibleinterpretation into assertion. |
| 第1轮 | know-06 | 本地资料库中**唯一直接回答"AI 在课堂上的负面影响"的文献**是 [S1] | S5p3 expressly discusses overreliance, losscriticalthinking/reducedhumaninteraction ineducation; cannot assertS1unique directsource onclassroomharms. |
| 第2轮（中断＋未尝试六题） | eth-04 | 内容基本限于隐私泄露提醒 | Sourcep8gives concrete privacy-policy inspection, datahandling criteria, choosingclearer tools, and avoidingpersonal/confidential/researchdata; callingcontent basically onlyreminders understates this. |
| 第2轮（中断＋未尝试六题） | uslib-01 | 说明馆员实际已承担资源建设与培训授课职能 | Institutional AIguides/trainingcounts do not identify which personnel taught orbuiltresources; the answer infers individual librarian actualduties frominstitution activities. |
| 第2轮（中断＋未尝试六题） | uslib-04 | 本库中仅有文献提出的 | Answerp9suggestiononlyclaim overlooks samep9 paragraph givingPenn actualsponsorship/support andAIcollaboration/socialdiscussion,notjust should-do guidance. |
| 第2轮（中断＋未尝试六题） | uslib-05 | 说明这是被制度化的工作 | Having a published evalframework doesnot demonstrate institutions adopted aformalized assessment duty. |
| 第2轮（中断＋未尝试六题） | uslib-05 | 也属于"评估能力与局限"的制度化形态 | EUlegalsafety-risk classification isnot thesame asassessingmodeltaskabilities/limitations; source doesnotstate equivalence. |
| 第2轮（中断＋未尝试六题） | talent-01 | 而将其并入技能/应用维度 | S7doesexplicitlyincludeevaluation andtoolcombination,but autonomyandcollaborationcrosswalk isnot stated; inference aboutwhereallthreeED-AI categorieswent isunsupported. |
| 第2轮（中断＋未尝试六题） | dig-01 | 作者亦指出数字经济对就业同时存在积极与消极影响 | p10sayssocialsecuritypositive/negativeemployment impacts, includingcapital/laborsubstitution; itdoesnotattributespecificnegativeargumenttodigitaleconomy. |
| 第2轮（中断＋未尝试六题） | delphi-03 | 以上是本地库中唯一集中回答该问题的来源 [S4] | S3p3 explicitly summarizesanAI-literacyframework andisfrozen targetsource; S4notexclusive. |
| 第2轮（中断＋未尝试六题） | delphi-05 | 馆藏另外两篇（波兰图书馆员 Delphi 研究 [S3]、国外高校图书馆 AI 伦理教育调研 [S2]）...未提供"早期两类行动"的证据 | S3p4 explicitlyhighestagreementmonitoringAItools andactions togainproficiency; absenceclaimfalse despiteinitialfailedretrieval. |
| 第2轮（中断＋未尝试六题） | phys-03 | 文中未给出其量表化定义，仅作为结果/相关问题变量使用 | SurveydevelopmentexplainsSLOitemsfromSELFI andTable1givesSLOitem. Notmerelyunoperationalizedresultlabel. |
| 第2轮（中断＋未尝试六题） | phys-05 | CFI/TLI（≥0.95 佳） | CFI>=.95 butTLI>.95 source; equalityboundaryunsupportedforTLI. |
| 第2轮（中断＋未尝试六题） | phys-05 | 评估 EU 在BI→SLO、BI→UB关系中的中介作用，共做六组中介分析 | SixanalysesTable6arePU/ATU/BI mediatorsonTAMpaths; EUtworelationships haveH19/H20 Table7. Answerattachessixcounttothewronganalyses. |
| 第2轮（中断＋未尝试六题） | guide-03 | 「在读稿过程中声明 AI 使用」（变量 16）为 221 家（60.2%） | Variable16 declarationinmethodology, notduringreading/reviewofmanuscript. Countcorrectbutvariablemeaningwrong. |
| 第2轮（中断＋未尝试六题） | guide-06 | 上述来源都没有直接研究AI在科研中应当扮演什么角色这一规范性问题...用于回答科研角色问题属于跨情境间接外推 | S6literaturediscussionexplicitlystateshumanresponsibility andAItoolratherthanautonomousentity in scientificprocess; answerquotesit thenincorrectlydeniesdirectnormativeevidence. |
| 第2轮（中断＋未尝试六题） | guide-06 | 提供培训，如哈佛Artificial Intelligence for Research and Scholarship、西北Using AI Tools in Your Research | TwoexacttitlesinS4p4Table1areLibGuidesresourcenames; p6Table2actualHarvardtrainingJumpstartyourresearchwithAI, NorthwesternCopilotLibraryDatabases. Titlestruebutassertedtrainingtypewrong. |
| 第2轮（中断＋未尝试六题） | know-02 | 其他检索命中（[S2]–[S5]、[S7]）均为高校图书馆 AI 素养/伦理教育调研 | S5isphysicsstudentChatGPTTAMsurvey notlibraryeducationstudy. Catalograngedescriptionfalse. |
| 第2轮（中断＋未尝试六题） | guide-07 | 因此 73.8% 是在涉及 AI 的条款中出现起草用途提及的占比口径 | AllTable2variablesuse367journals (271yes96no);73.8%isnotconditionedon175genericAI-mentionjournals norclausecount. Answerinventsalternatebaseline toexplaincrossvariablecounts. |
| 第3轮 | eth-04 | 三重差异 | Sourcecomparescoverageandprovidestopicdescriptions, butdoesnot establishmeasuredcontentdepth/valueorientationrank asadditionalcomparisonfindings. |
| 第3轮 | eth-04 | 两个二级指标 | Table5hasteachingintegrity,researchintegrity,andcommoncitationstandardsformats as3secondaryindicators,not2. |
| 第3轮 | talent-04 | 作者夏烨女 | Authoris夏烨;biography夏烨女，1985年生 uses女asgender,notauthornamesuffix. |
| 第3轮 | dig-01 | 中高技能劳动力的虚拟集聚效应 | Sourcehasparallelmechanismtests:skillstructuredgroupsandvirtualagglomerationmediator. Itdoesnotestablishvirtualagglomerationeffectspecificallyamongmid/highskills. |
| 第3轮 | dig-04 | 交互后如何保留地区间横截面差异 | Nationaleconomicseries×regional historicalindicators explicitlyretainsregionaldifferentvalues by multiplication. Suggestedunresolvedabsence overstatesambiguity; province/timefixedeffects already definedmodel2p4. |
| 第3轮 | dig-06 | 提高了工作保障与工作时长 | Guaranteeimprovesbutworkingtimefalls−1.7631 (shorterhours improvesquality). 提高工作时长 isliteralincreaseoppositetable7. |
| 第3轮 | delphi-06 | 以上均来自中美高校图书馆语境...S3为波兰大学馆员Delphi研究 | PolandisneitherChinanorUSA; answerexplicitlistsPolandthenrestrictsallsourcecontextsChinaUSA. |
| 第3轮 | phys-05 | 评估欧盟伦理使用（EU）...中介作用 | EUisethicaluse; noEuropeanUnionmodifierinphysicsstudyvariable. Misexpansionaddsfalseinstitutionalmeaning. |
| 第3轮 | guide-03 | 不宜把61.3%直接解读为61.3%的期刊明文要求披露 | SourceVariable14explicitlywhetherguidelinesrequirecompletetransparency; abstractmandate. GeneralAIpermissiondistinctiondoesnotmeanrequirementvariableisnotrequirement. |
| 第3轮 | know-03 | 第3–9名...频次均>10 | Bodyp9says>10butTable1ninthfrequency9andanswerowntable9. Answernotesanotherbodyrankingconflictyetdoesnotqualifythisgreater-than10claim. |

## 发现 → 原因 → 修复 → 验证

- 复合引用不能解析 → 宿主/UI/评测各自单标签匹配 → 共享纯解析器，API additive 字段，复合来源菜单、页范围、未知原文和 bounded 记录 → 单元、生产资源路由、浏览器/原生完整调用和中英浅深截图。畸形候选漏记另有修前两项失败、修后通过；只修 extraction，不猜未知写法。
- 采纳点击丢失 → 已完成后的 60ms 排队 paint 再次替换未变按钮，pointerdown/up 间 detach → 语义状态不变时保留按钮 → 真鼠标跨排队 paint、一次 API 请求；旧代码负例失败，修复 smoke 两轮通过。
- 并发断言偶发失败 → 固定 300ms 观察窗口测了 child 启动速度 → 两个请求在任一响应释放前同时 pending 的屏障 → 两轮 4/4，强制顺序负例失败；10秒只为失败退出边界。
- 分页断言偶发超时 → Playwright 自动滚动不可见按钮先触发滚动分页，又与 click 竞争 → 按钮 dispatch 与滚动路径分开，精确 cursor/count 断言 → 两轮通过。旧第二页 expected20 超时保留，本次旧点击诊断未重现完整历史事件，不冒称重现。
- 第二轮账本进程崩溃 → 同步 rename 缺少 Windows 临时锁处理 → 同一快照最多20次受限 rename，不新增模型重试，永久错误仍抛出 → 真 FileShare.Read 锁 EPERM 后释放并成功、原六代理回归仍过；当次具体持锁进程未知。
- 多轮汇总可能夸大成功 → completed 先于明确失败，或将已恢复网络错误误判终态 → 明确失败优先、终态错误链分类、基础设施单列、未知 usage 不填零 → 单元回归与逐题原账本复核。
- 构建测试漏报生成资源 → 旧静态导入断言只检查 DESKTOP_ASSETS/vendor，未包含已生成且生产路由允许的 citation-parser.mjs → 加入 GENERATED_ASSETS 并断言 parser 生成字节等于共享源码 → 定向构建1/1及最终全量281/281；首轮280/281的原失败保留。
- 菜单截图偏淡且有源片段浮层 → 仅等待selector/译文就截图，尚在ss-pop动画中且指针仍悬停引用 → 截图时移到菜单空白、等待animation.finished并检查opacity=1/无chip hover → browser/native中英浅深8张稳定菜单图经root逐张复核。产品样式未改。

## 验证、截图与文件

- npm test：281/281，fail/cancel/skip/todo=0，exit=0，372.131秒；日志 H:\ScienceScope_v0.1-desktop\.sciencescope-local\temp\t10-followup-validation\acceptance\run-9LSW07\npm-test\stdout-stderr.log。实际npm11.11.0、Node25.8.1、默认并发2；真实paid评测使用Node24.19.0。
- 完整验收首轮run-BQv8wd为27/28：既有23 smoke、branch/semantic、重试UI及research-base原生均通过，npm唯一上述清单断言失败。修复后run-9LSW07定向build＋受影响browser/native＋完整npm为4/4；派生有效28/28，不声称一次无失败28/28。原两套summary/log未覆盖，最终回执 .sciencescope-local/temp/t10-followup-validation/acceptance/final-acceptance-receipt.json，索引final-summary.json。
- Windows原生生产桥通过，PID68300正常退出，36张图；使用本地模拟模型（2轮Main、1次expert、付费0）。真实模型证据来自上述paid DSH评测，二者分开。未验安装包、签名或数据升级。
- 截图根 H:\ScienceScope_v0.1-desktop\.sciencescope-local\temp\t10-followup-validation\acceptance\run-9LSW07\：research-base-ui-smoke/artifacts 与 research-base-native/artifacts 各36图；citation-choices-{zh-light,zh-dark,en-light,en-dark}.png共8图由root逐张复核。早期引用/采纳证据在.sciencescope-local/temp/t10-followup-flaky/；首轮动画中截图仍留在run-BQv8wd。
- i18n 检查 3197 fragments/1750 历史 missing；本轮新增5个界面词条均有英文，新增 missing0。生产原型 ScienceScope.html 未改。
- root逐题验真155条回答/815个原文引文及段哈希，零不匹配；独立代理重算统计一致。交付前37项原始结果/账本/历史审计/gold/语料哈希不变，见final-preservation-receipt.json。
- 交付前扫描497个源码/文档文件与231个验收证据文件，key精确匹配零命中、忽略目录文件未入Git、新增词条missing0；security-i18n-receipt.json只记录计数及路径，不记录凭据值。
- 未知语法原回执数第1/2/3轮11/18/25；三轮结束后的候选提取修复只生成独立派生回执（11/18/26），额外找回合法组17/25/22。模型工具使用的parseCitationLabel未变，原回答、判分与语法回执未改；不能声称三轮运行了最后的DOM候选提取版本。

- `desktop/discussion.mjs`
- `desktop/i18n-en.mjs`
- `desktop/research-citations.mjs`
- `docs/DESKTOP_IMPLEMENTATION.md`
- `docs/README.md`
- `docs/ROADMAP.md`
- `docs/SYSTEM_SPEC.md`
- `docs/tasks/QUEUE.md`
- `scripts/build-desktop.mjs`
- `scripts/context/research-tools.mjs`
- `scripts/discussion-ui-smoke.mjs`
- `scripts/evals/hybrid-live-retrieval.mjs`
- `scripts/research-base-ui-smoke.mjs`
- `scripts/research-base/index.mjs`
- `scripts/research-base/search.mjs`
- `scripts/workspace-ui-smoke.mjs`
- `tests/build-desktop.test.mjs`
- `tests/desktop-server.test.mjs`
- `tests/expert-discussion-runtime.test.mjs`
- `tests/hybrid-live-proxy.test.mjs`
- `tests/research-read-citation.test.mjs`
- `docs/T10_TRANSPORT_FOLLOWUP_REPORT_2026-10-04.md`
- `scripts/evals/multi-run-report.mjs`
- `scripts/research-base/citations.mjs`
- `tests/multi-run-report.test.mjs`
- `tests/research-citations.test.mjs`

白名单之外的最小改动：search/index/scoped tool 用于任务已要求的复合引用/范围并保留权限回归；build/router 用于共享 parser 的生产传递导入；discussion 只修已明确根因的按钮稳定性；评测落盘和离线报告只修本次验证发现的缺陷。无新依赖、检索权重/嵌入/gold/题目不改。

与任务书差异及未完成项：第二轮基础设施崩溃导致不能宣称三个连续无中断原始 run；采用原中断＋仅未尝试六题的明确派生轮，中断题从模型质量分母排除，失败不重试。本次是三轮当前状态观察，没有补前后各三轮因果实验。额外无依据论断、工具偏离和预算失败仍存在，本轮记录问题、不按新分数继续改提示刷分。未知引用超出支持语法时仍保留字面。原 T21 独立交付等待 Claude 审阅，本轮不重做、不开始 T09。
