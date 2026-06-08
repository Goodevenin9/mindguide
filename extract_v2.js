/**
 * 高校导师信息提取工具 v2.0 (Node.js)
 * 读取 01-原始表格/ 下所有 xlsx → 抓取 → AI提取 → 输出到 03-提取结果
 */
const XLSX = require('xlsx');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ============================================================
// 配置
// ============================================================
const API_KEY = "sk-edaad1dbc96248589f7e43a31dbb68e2";
const API_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";

const INPUT_DIR = "C:/Users/19546/Desktop/提交/01-原始表格";
const OUTPUT_DIR = "C:/Users/19546/Desktop/提交/03-提取结果";
const REQUEST_DELAY = 500; // ms
const BATCH_SIZE = 50;

const VALID_TITLES = ["教授", "副教授", "研究员", "副研究员", "博导"];
const OUTPUT_FIELDS = ["姓名", "原始邮箱", "职称", "学校", "学院",
                       "公示手机号", "研究学科方向", "出版物/著作", "专利"];

// ============================================================
// 工具函数
// ============================================================
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** 简单HTTP GET，用和Python版一样的简洁headers */
function httpGet(url, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    };
    const req = client.get(url, { headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];
        let body;
        if (encoding && encoding.includes('gzip')) {
          body = zlib.gunzipSync(raw).toString('utf8');
        } else if (encoding && encoding.includes('deflate')) {
          body = zlib.inflateSync(raw).toString('utf8');
        } else {
          body = raw.toString('utf8');
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirect = new URL(res.headers.location, url).href;
          httpGet(redirect, timeout).then(resolve).catch(reject);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
  });
}

/** HTML → 纯文本 */
function htmlToText(html) {
  if (!html) return '';
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
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
  return text.split('\n').map(l => l.trim()).filter(l => l).join('\n');
}

/** 调DeepSeek API */
async function callAI(systemMsg, userMsg) {
  const payload = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user', content: userMsg }
    ],
    temperature: 0.01,
    max_tokens: 4096,
  });

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const url = new URL(API_URL);
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 90000,
        }, (res) => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            try { resolve(JSON.parse(raw)); }
            catch(e) { reject(new Error(`JSON解析失败: ${raw.slice(0,200)}`)); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('API超时')); });
        req.write(payload);
        req.end();
      });
      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new Error('API返回内容为空');
      return content;
    } catch (e) {
      if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

/** 从AI响应中提取JSON */
function extractJSON(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) text = m[1];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.substring(start, end + 1);
  }
  try { return JSON.parse(text); } catch(e) { return null; }
}

/** 标准化职称 */
function normalizeTitle(title) {
  if (!title) return '';
  for (const t of VALID_TITLES) {
    if (title.includes(t)) return t;
  }
  return '';
}

/** 数组→字符串 */
function fmt(val) {
  if (Array.isArray(val)) return val.filter(v => v).map(v => String(v).trim()).join('; ');
  return val ? String(val).trim() : '';
}

// ============================================================
// 核心处理
// ============================================================
async function processOne(name, email, rawTitle, school, college, url) {
  process.stdout.write(`  [抓取] `);
  try {
    const html = await httpGet(url);
    const text = htmlToText(html);
    if (text.length < 50) {
      console.log('❌ 页面内容过少');
      return { ok: false, data: { 姓名: name, 原始邮箱: email,
        职称: normalizeTitle(rawTitle), 学校: school, 学院: college, 失败原因: '页面内容过少' } };
    }
    console.log(`OK(${text.length}字) [AI提取]`);

    const systemMsg = '你是一个严谨的学术信息提取助手。严格根据网页公开公示内容提取信息，无内容则为空，严禁编造、补全、推测任何信息。';
    const userMsg = `已知导师信息（用于核对）：
- 姓名：${name}
- 学校：${school}
- 学院：${college}

===== 个人主页正文开始 =====
${text.slice(0, 50000)}
===== 个人主页正文结束 =====

请从以上正文中提取该导师的信息，输出标准JSON：

1. "姓名"：导师姓名
2. "职称"：仅从以下选择——教授、副教授、研究员、副研究员、博导，无则null
3. "学院"：所在学院
4. "学校"：所属大学
5. "公示手机号"：仅11位手机号，无则null
6. "研究学科方向"：完整罗列研究方向，用分号分隔，无则null
7. "出版物/著作"：仅收录专著、编著/主编/参编、译著、教材。格式"《书名》+类型"。无则null。
8. "专利"：仅列专利名称，用分号分隔。无则null。

规则：职称不在白名单内则null；出版物不收录论文；手机号仅明文11位；缺失字段null；严禁编造。
最终只输出JSON。`;

    const result = await callAI(systemMsg, userMsg);
    const data = extractJSON(result);
    if (!data) {
      console.log('  ❌ JSON解析失败');
      return { ok: false, data: { 姓名: name, 原始邮箱: email,
        职称: normalizeTitle(rawTitle), 学校: school, 学院: college, 失败原因: 'JSON解析失败' } };
    }

    const aiName = data.姓名;
    if (!aiName || aiName === '【非个人主页】') {
      console.log('  ⚠ 非个人主页');
      return { ok: false, data: { 姓名: name, 原始邮箱: email,
        职称: normalizeTitle(rawTitle), 学校: school, 学院: college, 失败原因: '非个人主页' } };
    }

    const title = normalizeTitle(data.职称) || normalizeTitle(rawTitle);

    console.log(`  ✅ ${aiName} | ${title || '(无职称)'}`);
    return {
      ok: true,
      data: {
        姓名: aiName || name,
        原始邮箱: email,
        职称: title,
        学校: data.学校 || school,
        学院: data.学院 || college,
        公示手机号: fmt(data['公示手机号']),
        研究学科方向: fmt(data['研究学科方向']),
        '出版物/著作': fmt(data['出版物/著作']),
        专利: fmt(data.专利),
      }
    };
  } catch (e) {
    console.log(`❌ ${e.message}`);
    return { ok: false, data: { 姓名: name, 原始邮箱: email,
      职称: normalizeTitle(rawTitle), 学校: school, 学院: college, 失败原因: e.message } };
  }
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log('='.repeat(55));
  console.log('  高校导师信息提取工具 v2.0');
  console.log('='.repeat(55));

  // 读取Excel
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`目录不存在: ${INPUT_DIR}`);
    return;
  }
  const files = fs.readdirSync(INPUT_DIR).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
  if (files.length === 0) {
    console.error('没有找到xlsx文件');
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const fname of files) {
    const fpath = path.join(INPUT_DIR, fname);
    console.log(`\n读取: ${fname}`);
    const wb = XLSX.readFile(fpath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // 解析（跳过标题行）
    const records = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[1]) continue;
      const name = String(r[1] || '').trim();
      const rawTitle = String(r[2] || '').trim();
      const email = String(r[3] || '').trim();
      const school = String(r[4] || '').trim();
      const college = String(r[5] || '').trim();
      const url = String(r[9] || '').trim();
      if (name && url) {
        records.push({ name, email, rawTitle, school, college, url });
      }
    }
    console.log(`  有效记录: ${records.length} 条`);

    // 分批
    for (let b = 0; b < records.length; b += BATCH_SIZE) {
      const batch = records.slice(b, b + BATCH_SIZE);
      const batchNum = Math.floor(b / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(records.length / BATCH_SIZE);
      console.log(`\n  --- 批次 ${batchNum}/${totalBatches} (${batch.length} 人) ---`);

      const success = [];
      const failure = [];

      for (let i = 0; i < batch.length; i++) {
        const r = batch[i];
        const idx = b + i + 1;
        console.log(`\n[${idx}/${records.length}] ${r.name} | ${r.school} ${r.college}`);
        console.log(`  ${r.url}`);
        const result = await processOne(r.name, r.email, r.rawTitle, r.school, r.college, r.url);
        if (result.ok) {
          success.push(result.data);
        } else {
          failure.push(result.data);
        }
        if (i < batch.length - 1) await sleep(REQUEST_DELAY);
      }

      // 写文件
      const base = fname.replace('.xlsx', '');
      if (success.length > 0) {
        const sp = path.join(OUTPUT_DIR, `提取成功_${base}_批次${batchNum}.xlsx`);
        const wsOut = XLSX.utils.json_to_sheet(success);
        const wbOut = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wbOut, wsOut, '成功');
        // 确保列顺序
        wsOut['!cols'] = OUTPUT_FIELDS.map(f => ({ wch: Math.max(f.length * 2, 12) }));
        XLSX.utils.sheet_add_aoa(wsOut, [OUTPUT_FIELDS], { origin: 'A1' });
        // 重新排序
        const ordered = success.map(row => {
          const obj = {};
          OUTPUT_FIELDS.forEach(f => obj[f] = row[f] || '');
          return obj;
        });
        const wsFinal = XLSX.utils.json_to_sheet(ordered, { header: OUTPUT_FIELDS });
        const wbFinal = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wbFinal, wsFinal, '成功');
        XLSX.writeFile(wbFinal, sp);
        console.log(`  ✅ 成功 ${success.length} 条 → ${path.basename(sp)}`);
      }
      if (failure.length > 0) {
        const failFields = ['姓名', '原始邮箱', '职称', '学校', '学院', '失败原因'];
        const fp = path.join(OUTPUT_DIR, `提取失败_${base}_批次${batchNum}.xlsx`);
        const wsFail = XLSX.utils.json_to_sheet(failure, { header: failFields });
        const wbFail = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wbFail, wsFail, '失败');
        XLSX.writeFile(wbFail, fp);
        console.log(`  ⚠ 失败 ${failure.length} 条 → ${path.basename(fp)}`);
      }
    }
  }

  console.log(`\n${'='.repeat(55)}`);
  console.log(`  全部完成！结果在: ${OUTPUT_DIR}`);
  console.log(`${'='.repeat(55)}`);
}

main().catch(e => { console.error('程序出错:', e); process.exit(1); });
