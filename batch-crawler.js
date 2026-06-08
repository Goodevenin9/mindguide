/**
 * 中山大学教师信息批量采集程序
 *
 * 功能：
 *   1. 读取信息采集表 Excel（含 姓名、主页URL 等信息）
 *   2. 自动爬取教师主页
 *   3. 提取结构化信息（学科方向、论文、出版物/著作、专利等）
 *   4. 输出"提取结果_xx学院.xlsx"和"提取失败_xx学院.xlsx"
 *
 * 支持两种提取模式：
 *   - AI 模式：调用大模型 API（DeepSeek / OpenAI）提取，效果最好
 *   - 直接解析模式：无需 API，从页面文本中提取关键段落（覆盖面有限）
 *
 * 使用方法:
 *   node batch-crawler.js                        # 处理 inputDir 下所有采集表
 *   node batch-crawler.js --file 文件名.xlsx     # 处理指定文件
 *   node batch-crawler.js --dry-run              # 只展示要处理的老师列表
 *   node batch-crawler.js --mode direct          # 使用直接解析模式（无需API）
 */

const XLSX = require('xlsx');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const pinyin = require('pinyin');

// ============================================================
// 配置
// ============================================================
const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// 命令行参数
const args = {};
process.argv.slice(2).forEach((arg, i, arr) => {
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const val = arr[i + 1];
    if (val && !val.startsWith('--')) {
      args[key] = val;
      arr[i + 1] = ''; // consumed
    } else {
      args[key] = true;
    }
  }
});

// ============================================================
// 工具函数
// ============================================================

/** 音调符号去除 */
function stripTones(s) {
  const toneMap = {
    'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
    'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
    'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
    'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
    'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
    'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v',
    'Ā': 'A', 'Á': 'A', 'Ǎ': 'A', 'À': 'A',
    'Ē': 'E', 'É': 'E', 'Ě': 'E', 'È': 'E',
    'Ī': 'I', 'Í': 'I', 'Ǐ': 'I', 'Ì': 'I',
    'Ō': 'O', 'Ó': 'O', 'Ǒ': 'O', 'Ò': 'O',
    'Ū': 'U', 'Ú': 'U', 'Ǔ': 'U', 'Ù': 'U',
  };
  return s.split('').map(c => toneMap[c] || c).join('');
}

/** 中文姓名 -> 拼音 URL 路径 (如 蔡穗华 -> CaiSuihua) */
function nameToPinyinUrl(name) {
  if (!name) return '';
  const parts = pinyin.pinyin(name).map(arr => stripTones(arr[0]));
  const surname = parts[0][0].toUpperCase() + parts[0].slice(1);
  const givenFull = parts.slice(1).join('').toLowerCase();
  if (!givenFull) return surname;
  return surname + givenFull[0].toUpperCase() + givenFull.slice(1);
}

/** 根据姓名和学院确定主页 URL */
function determineUrl(teacher) {
  // 如果输入已有主页，直接使用
  if (teacher['主页'] && teacher['主页'].trim()) {
    let url = teacher['主页'].trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    return url;
  }

  // 根据学院匹配 URL 模式
  const college = teacher['学院'] || '';
  const pinyinName = nameToPinyinUrl(teacher['姓名']);
  if (!pinyinName) return '';

  for (const [collegeKey, baseUrl] of Object.entries(config.urlPatterns)) {
    if (college.includes(collegeKey)) {
      return baseUrl + pinyinName;
    }
  }

  // 默认模式：生成 cse.sysu.edu.cn 路径
  return `https://cse.sysu.edu.cn/teacher/${pinyinName}`;
}

/** 生成输出文件名 - 基于教师所属学院 */
function getOutputFilename(teachers, suffix) {
  // 从教师数据中提取学院名称
  let collegeName = '未知学院';
  for (const t of teachers) {
    const c = t['学院'] || '';
    // 提取学院简称
    let short = c
      .replace('中山大学', '')
      .replace(/学院$/, '')
      .trim();
    if (short) {
      collegeName = short + '学院';
      break;
    }
  }
  // 兜底：从输入文件名提取
  if (collegeName === '未知学院') {
    // 什么也不做
  }
  return `${suffix}_${collegeName}.xlsx`;
}

/** 睡眠 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Web 请求
// ============================================================

/** 发起 HTTP/HTTPS 请求（含重试和回退） */
/** 全局 cookie 存储，模拟浏览器同域名共享 cookie */
const cookieJar = {};

/** 解压 gzip/deflate 响应 */
function decodeBody(res, data) {
  const encoding = res.headers['content-encoding'];
  if (!encoding) return data;
  const zlib = require('zlib');
  try {
    if (encoding.includes('gzip')) return zlib.gunzipSync(data).toString('utf8');
    if (encoding.includes('deflate')) return zlib.inflateSync(data).toString('utf8');
    if (encoding.includes('br')) return zlib.brotliDecompressSync(data).toString('utf8');
  } catch (e) {
    // 解压失败则返回原始数据
  }
  return data.toString('utf8');
}

/** 从响应头提取 cookies 并存入 jar */
function saveCookies(res, url) {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return;
  const domain = new URL(url).hostname;
  if (!cookieJar[domain]) cookieJar[domain] = {};
  setCookie.forEach(c => {
    const match = c.match(/^([^=]+)=([^;]*)/);
    if (match) cookieJar[domain][match[1]] = match[2];
  });
}

/** 从 cookie jar 获取域名的 cookie 字符串 */
function getCookieString(url) {
  const domain = new URL(url).hostname;
  const cookies = cookieJar[domain];
  if (!cookies || !Object.keys(cookies).length) return '';
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 获取一组浏览器级别的请求头 */
function getBrowserHeaders(url) {
  const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 Edg/132.0.0.0',
  ];
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const headers = {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': new URL(url).origin + '/',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="132", "Chromium";v="132"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive',
  };
  // 添加已有 cookie
  const cookie = getCookieString(url);
  if (cookie) headers['Cookie'] = cookie;
  return headers;
}

async function httpRequest(url, timeout = config.requestTimeout, retries = config.retryCount) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const headers = getBrowserHeaders(url);
        const req = client.get(url, { headers, timeout }, (res) => {
          // 保存 cookies
          saveCookies(res, url);

          // 收集数据（保持二进制以便解压）
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks);
            const body = decodeBody(res, raw);

            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(body);
            } else if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              const redirectUrl = new URL(res.headers.location, url).href;
              httpRequest(redirectUrl, timeout, 0).then(resolve).catch(reject);
            } else if (res.statusCode === 403) {
              reject(new Error('HTTP 403 (被拦截)'));
            } else if (res.statusCode === 429) {
              reject(new Error('HTTP 429 (请求过快)'));
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      });
      return result;
    } catch (err) {
      if (attempt < retries) {
        // 指数退避 + 随机抖动，每次重试递增
        const baseDelay = (attempt + 1) * 4000;
        const jitter = Math.random() * 3000;
        await sleep(baseDelay + jitter);
      } else {
        throw err;
      }
    }
  }
}

/** 将 HTML 转为文本行（去除标签，保留段落） */
function htmlToLines(html) {
  if (!html) return [];
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(div|p|section|article|h[1-6]|li|tr|table|br|blockquote|pre|span|a)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{4,}/g, '\n\n');

  return text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

/** 从文本行中找到教师内容区域（跳过导航菜单） */
function findTeacherContentLines(lines, teacherName) {
  // 策略：找到教师姓名 → 其后的内容才是有效信息
  let startIdx = -1;
  let endIdx = lines.length;

  // 查找教师姓名出现的位置，且后文是教师信息（职称、邮箱等）
  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    const l = lines[i];
    if (l === teacherName || l.startsWith(teacherName + ' |') || l.startsWith(teacherName + '（') || l.startsWith(teacherName + '(')) {
      // 验证后面跟着的是教师信息内容
      const lookahead = lines.slice(i + 1, i + 5).join('');
      if (/教授|副教授|讲师|研究员|工程师|邮箱|mail|研究领域|研究方向|个人简介/i.test(lookahead)) {
        startIdx = i;
        break;
      }
    }
  }

  // 如果没找到，扩大搜索范围
  if (startIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === teacherName) {
        startIdx = i;
        break;
      }
    }
  }

  // 如果仍然没找到，跳过前 30%（导航区域）
  if (startIdx === -1) {
    startIdx = Math.floor(lines.length * 0.25);
  }

  // 查找结束位置：页脚区域
  for (let i = startIdx; i < lines.length; i++) {
    const l = lines[i].toLowerCase();
    if (/版权所有|copyright|地址：.*邮编|技术支持.*联系/i.test(l)) {
      endIdx = i;
      break;
    }
  }

  return lines.slice(Math.max(0, startIdx), Math.min(endIdx, lines.length));
}

/** 从 HTML 提取纯文本内容（定位到教师信息区域） */
function extractTextFromHtml(html, teacherName) {
  const allLines = htmlToLines(html);
  const contentLines = findTeacherContentLines(allLines, teacherName || '');
  return contentLines.join('\n');
}

// ============================================================
// AI 提取
// ============================================================

/** 调用 AI API 提取教师信息 */
async function extractWithAI(pageText, teacher) {
  const { provider, apiKey, model, baseUrl, temperature, maxTokens } = config.ai;

  if (!apiKey) {
    throw new Error('AI API Key 未配置。请在 config.json 中设置 ai.apiKey，或使用 --mode direct 运行直接解析模式');
  }

  const prompt = `你是一个专门从中国大学教师主页提取结构化信息的助手。请从以下教师主页内容中提取信息。

注意：
1. 学科方向、论文、出版物/著作、专利 这些字段要尽可能完备，不要省略任何内容
2. 论文包括期刊论文和会议论文，列出所有能找到的
3. 专利包括已授权和已申请的
4. 联系方式优先提取邮箱
5. 职称使用页面中显示的职称（教授/副教授/讲师等）

请以 JSON 格式输出，只输出 JSON，不要包含其他内容：

{
  "姓名": "",
  "职称": "",
  "学院": "${teacher['学院'] || ''}",
  "学校": "${teacher['学校'] || ''}",
  "联系方式": "",
  "手机号": "",
  "学科方向": "",
  "论文": "",
  "出版物/著作": "",
  "专利": "",
  "来源URL": "${teacher._url || ''}"
}

以下是教师主页的文本内容：
---
${pageText.slice(0, 80000)}
---`;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是数据提取助手，从大学教师主页提取结构化信息。仅输出 JSON。' },
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`AI API 错误 (${response.status}): ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('AI 返回内容为空');

  // 尝试解析 JSON
  try {
    // 如果返回被包裹在 ```json ``` 中
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`AI 返回格式非 JSON: ${content.slice(0, 100)}`);
  }
}

// ============================================================
// 直接解析模式（无需 AI API）
// ============================================================

/** 从页面文本中直接提取信息（改进版） */
function extractDirect(pageText, teacher) {
  const result = {
    姓名: teacher['姓名'] || '',
    职称: teacher['职称'] || '',
    学院: teacher['学院'] || '',
    学校: teacher['学校'] || '',
    联系方式: '',
    手机号: '',
    学科方向: '',
    论文: '',
    '出版物/著作': '',
    专利: '',
    来源URL: teacher._url || '',
  };

  const lines = pageText.split('\n');

  // ---- 1. 提取邮箱 ----
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = pageText.match(emailRegex);
  if (emails) {
    const personalEmails = emails.filter(e =>
      !e.includes('example') && !e.includes('domain') && !e.includes('test')
    );
    if (personalEmails.length > 0) {
      result.联系方式 = personalEmails[0];
    }
  }

  // ---- 2. 提取手机号 ----
  const phoneRegex = /1[3-9]\d{9}/g;
  const phones = pageText.match(phoneRegex);
  if (phones) {
    result.手机号 = phones[0];
  }

  // ---- 3. 提取各个章节 ----
  let currentSection = '';
  const sections = {};

  const sectionHeaders = [
    '研究领域', '研究方向', '学科方向', '学科领域',
    '代表性论著', '代表性论文', '期刊论文', '主要论文', '发表论文', '论著', '著作',
    '专利', '发明专利', '授权专利',
    '出版', '出版物', '教材',
    '科研项目', '科研课题', '在研项目',
    '教育背景', '工作经历', '获奖', '荣誉',
    '学术兼职', '教授课程', '教学', '个人简介',
  ];

  // 先扫描所有行，标记章节标题
  const sectionLineMap = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    for (const header of sectionHeaders) {
      if ((l === header || l.startsWith(header + ' ') || l.startsWith(header + ':')) && l.length < 40) {
        sectionLineMap[i] = header;
        break;
      }
    }
  }

  // 分配到各个章节
  const sectionLineNumbers = Object.keys(sectionLineMap).map(Number).sort((a, b) => a - b);
  for (let si = 0; si < sectionLineNumbers.length; si++) {
    const start = sectionLineNumbers[si];
    const end = si + 1 < sectionLineNumbers.length ? sectionLineNumbers[si + 1] : lines.length;
    const header = sectionLineMap[start];
    if (!sections[header]) sections[header] = [];
    for (let i = start + 1; i < end; i++) {
      const l = lines[i].trim();
      if (l && l.length > 1) {
        sections[header].push(l);
      }
    }
  }

  // ---- 4. 提取学科方向 ----
  for (const key of ['研究领域', '研究方向', '学科方向', '学科领域']) {
    if (sections[key] && sections[key].length > 0) {
      result.学科方向 = sections[key].join('; ');
      break;
    }
  }
  if (!result.学科方向) {
    if (teacher['简介']) {
      result.学科方向 = teacher['简介'];
    } else if (sections['个人简介'] && sections['个人简介'].length > 0) {
      result.学科方向 = sections['个人简介'].slice(0, 3).join(' ');
    }
  }

  // ---- 5. 提取论文 ----
  const paperKeys = ['代表性论著', '代表性论文', '论著', '期刊论文', '主要论文', '发表论文'];
  let paperParts = [];
  for (const key of paperKeys) {
    if (sections[key] && sections[key].length > 0) {
      paperParts = paperParts.concat(sections[key]);
    }
  }

  // 查找 [J] [C] 格式的论文行
  const jcLines = lines.filter(l => /^\s*[\[\(][JCjC][\]\)]\s*/.test(l.trim()));
  if (jcLines.length >= 3) {
    result.论文 = jcLines.join('\n');
  } else if (paperParts.length > 0) {
    result.论文 = paperParts.join('\n');
  }

  // ---- 6. 提取出版物/著作 ----
  for (const key of ['出版', '出版物', '著作', '教材']) {
    if (sections[key] && sections[key].length > 0) {
      const existing = result['出版物/著作'] || '';
      const newContent = sections[key].join('\n');
      result['出版物/著作'] = existing ? existing + '\n' + newContent : newContent;
    }
  }
  if (!result['出版物/著作'] && sections['著作'] && sections['著作'].length > 0) {
    result['出版物/著作'] = sections['著作'].join('\n');
  }

  // ---- 7. 提取专利 ----
  for (const key of ['专利', '发明专利', '授权专利']) {
    if (sections[key] && sections[key].length > 0) {
      result.专利 = sections[key].join('\n');
      break;
    }
  }

  if (!result.专利) {
    const patentLines = lines.filter(l => {
      const t = l.trim();
      return (t.includes('专利') && (t.includes('授权') || t.includes('申请') || t.includes('发明') ||
              t.includes('CN') || t.includes('ZL') || t.includes('号')))
        && !(t.includes('申请及授权专利') && t.length < 30);
    });
    if (patentLines.length > 0) {
      const detailedPatents = patentLines.filter(l =>
        /CN\d|ZL\d|专利[号号]|授权.*专利|发明.*专利|\d+项专利/.test(l)
      );
      if (detailedPatents.length >= 1) {
        result.专利 = detailedPatents.join('\n');
      }
    }
  }

  return result;
}

// ============================================================
// 处理单个教师
// ============================================================

async function processTeacher(teacher, useAI) {
  const name = teacher['姓名'] || '未知';
  const url = determineUrl(teacher);

  if (!url) {
    return { success: false, reason: '无法确定 URL' };
  }

  teacher._url = url;

  try {
    process.stdout.write(`  [爬取] ${name} -> ${url} ... `);
    const html = await httpRequest(url);
    const pageText = extractTextFromHtml(html, name);
    console.log(`OK (${pageText.length} 字符)`);

    if (pageText.length < 50) {
      return { success: false, reason: '页面内容过少' };
    }

    process.stdout.write(`  [提取] ${name} ... `);

    let result;
    if (useAI) {
      result = await extractWithAI(pageText, teacher);
    } else {
      result = extractDirect(pageText, teacher);
    }

    // 补充基本信息（如果 AI 没有提取到）
    if (!result['姓名']) result['姓名'] = teacher['姓名'] || '';
    if (!result['职称']) result['职称'] = teacher['职称'] || '';
    if (!result['学院']) result['学院'] = teacher['学院'] || '';
    if (!result['学校']) result['学校'] = teacher['学校'] || '中山大学';
    if (!result['来源URL']) result['来源URL'] = url;

    console.log('OK');
    return { success: true, data: result };
  } catch (err) {
    console.log(`失败: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

// ============================================================
// 读取输入 Excel
// ============================================================

function readTeachersFromExcel(filepath) {
  const wb = XLSX.readFile(filepath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws);
  return data;
}

// ============================================================
// 写入输出 Excel
// ============================================================

function writeExcel(filepath, data, columns) {
  // Excel 单单元格最多 32767 字符，保守限制
  const MAX_CELL = 30000;
  const filtered = data.map(row => {
    const obj = {};
    for (const col of columns) {
      let val = row[col] !== undefined ? String(row[col]) : '';
      if (val.length > MAX_CELL) {
        val = val.slice(0, MAX_CELL) + '...(因篇幅限制已截断)';
      }
      obj[col] = val;
    }
    return obj;
  });

  // 再次验证：强制所有值不超过 20000 字符（Excel 上限为 32767）
  for (const row of filtered) {
    for (const col of columns) {
      if (row[col] && row[col].length > 20000) {
        row[col] = row[col].slice(0, 20000) + '...(篇幅受限，已截断)';
      }
    }
  }

  let ws;
  try {
    ws = XLSX.utils.json_to_sheet(filtered);
  } catch (e) {
    // 如果仍然超长，进一步截断所有字段
    console.log(`  警告: 写入出错 (${e.message})，进一步截断后重试`);
    for (const row of filtered) {
      for (const col of columns) {
        if (row[col] && row[col].length > 10000) {
          row[col] = row[col].slice(0, 10000) + '...(篇幅受限)';
        }
      }
    }
    ws = XLSX.utils.json_to_sheet(filtered);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

  // 自动列宽
  const colWidths = columns.map(col => {
    let maxLen = col.length * 2; // 中文字符宽度
    for (const row of filtered) {
      const val = String(row[col] || '');
      const len = val.length;
      // 估算中文字符宽度
      let width = 0;
      for (const ch of val) {
        width += (ch.charCodeAt(0) > 127 ? 2 : 1);
      }
      maxLen = Math.max(maxLen, Math.min(width, 80));
    }
    return { wch: Math.min(maxLen + 2, 80) };
  });
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, filepath);
  console.log(`  -> 已写入: ${filepath}`);
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('中山大学教师信息批量采集程序');
  console.log('='.repeat(60));
  console.log();

  const inputDir = config.inputDir;

  // 查找输入文件
  let inputFiles = [];

  if (args.file) {
    const fp = path.isAbsolute(args.file) ? args.file : path.join(inputDir, args.file);
    if (fs.existsSync(fp)) {
      inputFiles.push(fp);
    } else {
      console.error(`错误: 文件不存在: ${fp}`);
      process.exit(1);
    }
  } else {
    // 扫描目录
    for (const pattern of config.inputFilePatterns) {
      const prefix = pattern.replace(/\*/g, '');
      const files = fs.readdirSync(inputDir)
        .filter(f => f.endsWith('.xlsx') && f.includes('采集') || f.includes('收集'))
        .filter(f => !f.startsWith('~$')) // 排除临时文件
        .map(f => path.join(inputDir, f));
      inputFiles.push(...files);
    }
    // 去重
    inputFiles = [...new Set(inputFiles)];
  }

  if (inputFiles.length === 0) {
    console.log(`在 ${inputDir} 中未找到采集表文件`);
    console.log('请将采集表 Excel 文件放入该目录，或使用 --file 指定文件路径');
    return;
  }

  const useAI = args.mode !== 'direct' && config.ai.apiKey;
  if (args.mode === 'direct') {
    console.log('模式: 直接解析（无需 API，覆盖面有限）');
  } else if (config.ai.apiKey) {
    console.log(`模式: AI 提取 (${config.ai.provider}/${config.ai.model})`);
  } else {
    console.log('模式: 直接解析（未配置 AI API Key。如需更好效果，请在 config.json 中设置 ai.apiKey）');
  }
  console.log();

  for (const filepath of inputFiles) {
    const filename = path.basename(filepath);
    console.log(`\n处理文件: ${filename}`);

    const teachers = readTeachersFromExcel(filepath);
    console.log(`  共 ${teachers.length} 名教师`);

    if (args['dry-run']) {
      for (const t of teachers) {
        const url = determineUrl(t);
        console.log(`  ${t['姓名'] || '?'} -> ${url || '无 URL'}`);
      }
      continue;
    }

    // 处理每个教师
    const results = [];
    const failures = [];

    // 控制并发
    const concurrency = Math.min(config.concurrency, teachers.length);
    const queue = [...teachers];
    let active = 0;
    let completed = 0;
    let errored = false;

    async function worker() {
      while (queue.length > 0 && !errored) {
        const teacher = queue.shift();
        const name = teacher['姓名'] || '未知';
        const result = await processTeacher(teacher, useAI);
        if (result.success) {
          results.push(result.data);
        } else {
          failures.push({
            姓名: name,
            学校: teacher['学校'] || '',
            学院: teacher['学院'] || '',
            URL: teacher._url || '',
            失败原因: result.reason,
          });
        }
        completed++;
        process.stdout.write(`  进度: ${completed}/${teachers.length}\n`);
        // 请求间延时 3~6 秒，模拟真实浏览节奏
        await sleep(3000 + Math.random() * 3000);
      }
    }

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    // 写入输出
    console.log(`\n  结果: ${results.length} 成功, ${failures.length} 失败`);

    if (results.length > 0) {
      const outPath = path.join(config.outputDir, getOutputFilename(teachers, '提取结果'));
      writeExcel(outPath, results, config.outputColumns);
    }

    if (failures.length > 0) {
      const failPath = path.join(config.outputDir, getOutputFilename(teachers, '提取失败'));
      writeExcel(failPath, failures, config.failureColumns);
    }

    console.log();
  }

  console.log('='.repeat(60));
  console.log('程序执行完毕');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('程序出错:', err);
  process.exit(1);
});
