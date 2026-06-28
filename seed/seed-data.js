/* seed-data.js — 初始示例提示词与分类
 * 挂载到 PH.seed。含中文标题，便于验证拼音/首字母检索。
 */
(function (root) {
  'use strict';
  const NS = root.PH || (root.PH = {});

  const categories = [
    { id: 'c_write', name: '写作', sortOrder: 0 },
    { id: 'c_code', name: '编程', sortOrder: 1 },
    { id: 'c_market', name: '营销', sortOrder: 2 },
    { id: 'c_study', name: '学习', sortOrder: 3 },
    { id: 'c_life', name: '生活', sortOrder: 4 }
  ];

  const prompts = [
    {
      title: '写一封商务邮件',
      description: '快速生成正式的商务沟通邮件，支持指定主题、语气与收件对象。',
      categoryId: 'c_write',
      tags: ['邮件', '商务', '职场'],
      models: ['OpenAI/GPT-5.5', 'Anthropic/Claude Fable 5', 'Zhipu/GLM-5.2'],
      favorite: true,
      content: '请帮我撰写一封商务邮件。\n主题：{{邮件主题|请输入邮件主题}}\n收件对象：{{收件人|如：客户 / 主管}}\n语气：{{语气|如：正式 / 友好 / 委婉=正式}}\n核心要点：\n{{要点|逐条列出要点}}\n\n要求：开头寒暄简短，正文条理清晰，结尾给出明确的下一步行动。'
    },
    {
      title: '文章润色与改写',
      description: '把一段文字改得更通顺、专业或更有感染力。',
      categoryId: 'c_write',
      tags: ['润色', '改写', '文案'],
      models: ['Anthropic/Claude Opus 4.7', 'Alibaba/Qwen3.7-Max'],
      content: '请对以下文字进行润色改写，使其更{{风格|如：专业 / 生动 / 简洁}}，并保持原意不变：\n\n{{原文}}'
    },
    {
      title: '会议纪要整理',
      description: '把零散的会议记录整理成结构化纪要。',
      categoryId: 'c_write',
      tags: ['会议', '纪要', '职场'],
      content: '请把以下会议记录整理成规范的会议纪要，包含：会议主题、时间地点、参会人、讨论要点、决议事项、待办事项（含负责人与截止时间）。\n\n记录：\n{{会议记录}}'
    },
    {
      title: '代码解释器',
      description: '用通俗语言解释一段代码的作用与原理。',
      categoryId: 'c_code',
      tags: ['代码', '解释', '学习'],
      models: ['OpenAI/GPT-5.5 Pro', 'Moonshot/Kimi K2.7 Code', 'DeepSeek/DeepSeek-V4-Pro'],
      favorite: true,
      content: '请解释下面这段{{语言|如：Python / JavaScript}}代码的作用，逐行说明关键逻辑，并指出可能的改进点：\n\n```\n{{代码}}\n```'
    },
    {
      title: '生成单元测试',
      description: '为指定函数或模块生成测试用例。',
      categoryId: 'c_code',
      tags: ['测试', '代码', '质量'],
      content: '请为下面的{{语言=JavaScript}}代码编写单元测试，覆盖正常路径、边界条件与异常情况，使用主流测试框架：\n\n```\n{{代码}}\n```'
    },
    {
      title: 'SQL查询优化建议',
      description: '分析 SQL 查询并给出性能优化建议。',
      categoryId: 'c_code',
      tags: ['SQL', '数据库', '优化'],
      models: ['xAI/Grok 4.3', 'ByteDance/Doubao-Seed-2.0-Pro'],
      content: '请分析以下 SQL 查询，指出潜在的性能问题（如全表扫描、缺少索引、N+1 查询等），并给出优化后的 SQL 与索引建议：\n\n```sql\n{{SQL}}\n```'
    },
    {
      title: '产品文案撰写',
      description: '为产品撰写吸引人的卖点文案。',
      categoryId: 'c_market',
      tags: ['文案', '营销', '产品'],
      content: '请为以下产品撰写营销文案，目标受众是{{受众|如：年轻白领 / 学生}}，突出{{核心卖点}}，风格{{风格=有吸引力}}，输出 3 个版本：标题 + 一段正文。\n\n产品：{{产品名称}}'
    },
    {
      title: '社交媒体帖子',
      description: '生成适合发布在社交平台的短内容。',
      categoryId: 'c_market',
      tags: ['社交', '文案', '营销'],
      content: '请为{{平台|如：微博 / 小红书 / Twitter}}写一条关于{{话题}}的帖子，字数适中，带 2-3 个相关话题标签，语气{{语气=轻松活泼}}。'
    },
    {
      title: '概念通俗讲解',
      description: '用费曼技巧把复杂概念讲清楚。',
      categoryId: 'c_study',
      tags: ['学习', '讲解', '费曼'],
      favorite: true,
      content: '请用费曼学习法，把“{{概念}}”这个概念讲解给一个初学者听：先用一句话定义，再举一个生活中的类比，最后指出 2 个常见误区。'
    },
    {
      title: '制定学习计划',
      description: '为某个主题制定分阶段学习计划。',
      categoryId: 'c_study',
      tags: ['学习', '计划', '规划'],
      content: '请为零基础学习者制定一份学习{{主题}}的计划，总时长{{周期|如：4 周}}，每周列出学习目标、推荐资源与一个练习任务。'
    },
    {
      title: '日常饮食建议',
      description: '根据目标给出健康的饮食搭配建议。',
      categoryId: 'c_life',
      tags: ['健康', '饮食', '生活'],
      content: '请根据我的目标“{{目标|如：减脂 / 增肌}}”，结合我的条件（身高{{身高}}cm、体重{{体重}}kg），给出一天三餐的饮食搭配建议，注意营养均衡。'
    },
    {
      title: '旅行行程规划',
      description: '快速生成一份旅行行程安排。',
      categoryId: 'c_life',
      tags: ['旅行', '规划', '生活'],
      content: '请为我规划一份{{目的地}}的{{天数|如：5}}天旅行行程，每天上午/下午/晚上各安排一个活动，考虑交通与餐饮，并标注大致预算。'
    }
  ];

  NS.seed = { categories, prompts };
})(typeof self !== 'undefined' ? self : this);
