// ============================================
// CalStack - 后端服务器
// 支持多日历功能，每个日历有独立的记录
// 使用 Express 框架，提供 API 接口和静态文件服务
// ============================================

const express = require('express');
const fs = require('fs');
const path = require('path');

// 创建 Express 应用
const app = express();
const PORT = 3000;

// data.json 文件的路径（和 server.js 在同一目录）
const DATA_FILE = path.join(__dirname, 'data.json');

// ---- 中间件 ----

// 解析 JSON 请求体（处理 POST/PUT 请求时需要）
app.use(express.json());

// 提供静态文件服务（public 目录下的 HTML/CSS/JS 直接可访问）
app.use(express.static('public'));

// ---- 启动时检查数据文件 ----

// 如果 data.json 不存在，自动创建一个带默认日历的空数据
if (!fs.existsSync(DATA_FILE)) {
  const defaultData = {
    calendars: [
      { id: 'cal_default', name: '见面日历', icon: '❤️', color: '#E8756D', createdAt: new Date().toISOString() }
    ],
    records: { cal_default: {} }
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
  console.log('已自动创建 data.json 文件（含默认日历）');
}

// ---- 辅助函数：读写数据 ----

/**
 * 归一化统计项标签数组：
 * - 过滤非字符串、去除首尾空格、去重、限制长度 1-10、最多 20 项
 */
function normalizeStats(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const result = [];
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (!t || t.length > 10) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    result.push(t);
    if (result.length >= 20) break;
  }
  return result;
}

/**
 * 归一化记录中的 stats 计数对象：只保留在允许名称集合内、值为正整数 (>=1, <=999) 的项
 */
function normalizeRecordStats(obj, allowedNames) {
  if (!obj || typeof obj !== 'object') return {};
  const allow = new Set(allowedNames || []);
  const result = {};
  for (const k of Object.keys(obj)) {
    if (!allow.has(k)) continue;
    const n = parseInt(obj[k]);
    if (!isNaN(n) && n >= 1 && n <= 999) result[k] = n;
  }
  return result;
}

/**
 * 读取 data.json 的全部内容
 * 如果文件损坏或读取失败，返回安全的空结构作为兜底
 */
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('读取数据文件失败:', err.message);
    return {
      calendars: [{ id: 'cal_default', name: '见面日历', icon: '❤️', color: '#E8756D', createdAt: new Date().toISOString() }],
      records: { cal_default: {} }
    };
  }
}

/**
 * 将数据写回 data.json
 * 使用格式化输出（缩进2空格），方便人工查看和编辑
 */
function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('写入数据文件失败:', err.message);
    return false;
  }
}

// ---- 数据格式迁移 ----
// 检查是否需要从旧格式（扁平日期键值对）迁移到新格式（多日历嵌套结构）

(function migrateData() {
  const data = readData();
  // 新格式必须有 calendars 数组；如果没有，说明是旧格式
  if (!Array.isArray(data.calendars)) {
    const oldRecords = data;  // 旧格式：{ "2026-06-01": { mood, ... } }
    const defaultCalendar = {
      id: 'cal_default',
      name: '见面日历',
      icon: '❤️',
      color: '#E8756D',
      stats: [],
      createdAt: new Date().toISOString()
    };
    const newData = {
      calendars: [defaultCalendar],
      records: { cal_default: oldRecords }
    };
    writeData(newData);
    console.log('已将旧格式数据迁移为多日历格式');
    return;
  }
  // 为旧日历补齐 stats 字段（默认空数组）
  let changed = false;
  data.calendars.forEach(c => {
    if (!Array.isArray(c.stats)) { c.stats = []; changed = true; }
  });
  if (changed) {
    writeData(data);
    console.log('已为旧日历补齐 stats 字段');
  }
})();

// ---- 验证正则 ----

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;        // 日期格式 YYYY-MM-DD
const CALENDAR_ID_REGEX = /^cal_\w+$/;            // 日历 ID 格式
const COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;          // 颜色格式 #RRGGBB

// ============================================
// 日历管理 API（CRUD）
// ============================================

/**
 * GET /api/calendars
 * 获取所有日历的元数据列表
 */
app.get('/api/calendars', (req, res) => {
  const data = readData();
  res.json(data.calendars);
});

/**
 * POST /api/calendars
 * 创建一个新日历
 * 请求体: { name, icon, color }
 */
app.post('/api/calendars', (req, res) => {
  const { name, icon, color } = req.body;

  // 验证必填字段
  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 20) {
    return res.status(400).json({ error: '日历名称不能为空，且不超过20个字符' });
  }
  if (!icon || typeof icon !== 'string') {
    return res.status(400).json({ error: '请选择一个图标' });
  }
  if (!color || !COLOR_REGEX.test(color)) {
    return res.status(400).json({ error: '请选择一个有效的主题颜色' });
  }

  const data = readData();

  // 生成新日历的 ID（用时间戳确保唯一）
  const newId = 'cal_' + Date.now();
  const newCalendar = {
    id: newId,
    name: name.trim(),
    icon,
    color,
    stats: normalizeStats(req.body.stats),
    createdAt: new Date().toISOString()
  };

  // 添加到日历列表，并初始化空记录
  data.calendars.push(newCalendar);
  data.records[newId] = {};

  if (!writeData(data)) {
    return res.status(500).json({ error: '保存数据失败' });
  }

  res.json(newCalendar);
});

/**
 * PUT /api/calendars/:id
 * 更新日历的元数据（名称、图标、颜色）
 * 请求体: { name?, icon?, color? } — 只更新提供的字段
 */
app.put('/api/calendars/:id', (req, res) => {
  const calId = req.params.id;

  if (!CALENDAR_ID_REGEX.test(calId)) {
    return res.status(400).json({ error: '日历 ID 格式不正确' });
  }

  const data = readData();
  const calIndex = data.calendars.findIndex(c => c.id === calId);

  if (calIndex === -1) {
    return res.status(404).json({ error: '日历不存在' });
  }

  // 只更新请求中提供的字段
  const cal = data.calendars[calIndex];
  if (req.body.name !== undefined) {
    if (typeof req.body.name !== 'string' || req.body.name.trim().length === 0 || req.body.name.length > 20) {
      return res.status(400).json({ error: '日历名称不能为空，且不超过20个字符' });
    }
    cal.name = req.body.name.trim();
  }
  if (req.body.icon !== undefined) {
    cal.icon = req.body.icon;
  }
  if (req.body.color !== undefined) {
    if (!COLOR_REGEX.test(req.body.color)) {
      return res.status(400).json({ error: '请选择一个有效的主题颜色' });
    }
    cal.color = req.body.color;
  }
  if (req.body.stats !== undefined) {
    const newStats = normalizeStats(req.body.stats);
    cal.stats = newStats;
    // 同步清理该日历记录中不再存在的统计项
    const calRecords = data.records[calId] || {};
    Object.values(calRecords).forEach(r => {
      if (r && r.stats && typeof r.stats === 'object') {
        Object.keys(r.stats).forEach(k => {
          if (!newStats.includes(k)) delete r.stats[k];
        });
      }
    });
  }

  if (!writeData(data)) {
    return res.status(500).json({ error: '保存数据失败' });
  }

  res.json(cal);
});

/**
 * DELETE /api/calendars/:id
 * 删除一个日历及其所有记录
 * 不允许删除最后一个日历
 */
app.delete('/api/calendars/:id', (req, res) => {
  const calId = req.params.id;

  if (!CALENDAR_ID_REGEX.test(calId)) {
    return res.status(400).json({ error: '日历 ID 格式不正确' });
  }

  const data = readData();

  // 不允许删除最后一个日历
  if (data.calendars.length <= 1) {
    return res.status(400).json({ error: '至少需要保留一个日历' });
  }

  const calIndex = data.calendars.findIndex(c => c.id === calId);
  if (calIndex === -1) {
    return res.status(404).json({ error: '日历不存在' });
  }

  // 从日历列表中移除
  data.calendars.splice(calIndex, 1);
  // 删除该日历的所有记录
  delete data.records[calId];

  if (!writeData(data)) {
    return res.status(500).json({ error: '保存数据失败' });
  }

  res.json({ success: true });
});

// ============================================
// 日历记录 API（每个日历独立）
// ============================================

/**
 * GET /api/calendars/:id/records
 * 获取某个日历的全部记录
 */
app.get('/api/calendars/:id/records', (req, res) => {
  const calId = req.params.id;

  if (!CALENDAR_ID_REGEX.test(calId)) {
    return res.status(400).json({ error: '日历 ID 格式不正确' });
  }

  const data = readData();
  const cal = data.calendars.find(c => c.id === calId);

  if (!cal) {
    return res.status(404).json({ error: '日历不存在' });
  }

  res.json(data.records[calId] || {});
});

/**
 * POST /api/calendars/:id/records/:date
 * 创建或更新某个日历中某一天的记录
 * 请求体: { mood?, location?, weather?, diary? }
 */
app.post('/api/calendars/:id/records/:date', (req, res) => {
  const calId = req.params.id;
  const date = req.params.date;

  if (!CALENDAR_ID_REGEX.test(calId)) {
    return res.status(400).json({ error: '日历 ID 格式不正确' });
  }
  if (!DATE_REGEX.test(date)) {
    return res.status(400).json({ error: '日期格式不正确，请使用 YYYY-MM-DD' });
  }

  const data = readData();
  const cal = data.calendars.find(c => c.id === calId);

  if (!cal) {
    return res.status(404).json({ error: '日历不存在' });
  }

  // 确保该日历的记录对象存在
  if (!data.records[calId]) data.records[calId] = {};

  const existing = data.records[calId][date] || {};

  // 合并记录：请求中提供的字段覆盖已有字段，空字符串也保存（用户主动清空）
  data.records[calId][date] = {
    mood: req.body.mood !== undefined ? req.body.mood : (existing.mood || ''),
    location: req.body.location !== undefined ? req.body.location : (existing.location || ''),
    weather: req.body.weather !== undefined ? req.body.weather : (existing.weather || ''),
    diary: req.body.diary !== undefined ? req.body.diary : (existing.diary || ''),
    stats: req.body.stats !== undefined
      ? normalizeRecordStats(req.body.stats, cal.stats || [])
      : (existing.stats && typeof existing.stats === 'object' ? existing.stats : {})
  };

  if (!writeData(data)) {
    return res.status(500).json({ error: '保存数据失败' });
  }

  res.json(data.records[calId][date]);
});

/**
 * DELETE /api/calendars/:id/records/:date
 * 删除某个日历中某一天的记录
 */
app.delete('/api/calendars/:id/records/:date', (req, res) => {
  const calId = req.params.id;
  const date = req.params.date;

  if (!CALENDAR_ID_REGEX.test(calId)) {
    return res.status(400).json({ error: '日历 ID 格式不正确' });
  }
  if (!DATE_REGEX.test(date)) {
    return res.status(400).json({ error: '日期格式不正确，请使用 YYYY-MM-DD' });
  }

  const data = readData();

  if (!data.records[calId]) {
    return res.json({ success: true });  // 没有记录也算删除成功
  }

  delete data.records[calId][date];

  if (!writeData(data)) {
    return res.status(500).json({ error: '保存数据失败' });
  }

  res.json({ success: true });
});

// ============================================
// 旧版 API（兼容，代理到默认日历）
// ============================================

/**
 * GET /api/meetings → 等同于 GET /api/calendars/cal_default/records
 */
app.get('/api/meetings', (req, res) => {
  const data = readData();
  res.json(data.records.cal_default || {});
});

/**
 * POST /api/meetings/:date → 等同于操作默认日历
 */
app.post('/api/meetings/:date', (req, res) => {
  req.params.id = 'cal_default';
  // 复用新路由的逻辑
  const date = req.params.date;
  if (!DATE_REGEX.test(date)) {
    return res.status(400).json({ error: '日期格式不正确' });
  }
  const data = readData();
  if (!data.records.cal_default) data.records.cal_default = {};
  const existing = data.records.cal_default[date] || {};
  data.records.cal_default[date] = {
    mood: req.body.mood !== undefined ? req.body.mood : (existing.mood || ''),
    location: req.body.location !== undefined ? req.body.location : (existing.location || ''),
    weather: req.body.weather !== undefined ? req.body.weather : (existing.weather || ''),
    diary: req.body.diary !== undefined ? req.body.diary : (existing.diary || '')
  };
  if (!writeData(data)) return res.status(500).json({ error: '保存数据失败' });
  res.json(data.records.cal_default[date]);
});

/**
 * DELETE /api/meetings/:date → 等同于删除默认日历的记录
 */
app.delete('/api/meetings/:date', (req, res) => {
  const date = req.params.date;
  if (!DATE_REGEX.test(date)) {
    return res.status(400).json({ error: '日期格式不正确' });
  }
  const data = readData();
  if (data.records.cal_default) delete data.records.cal_default[date];
  if (!writeData(data)) return res.status(500).json({ error: '保存数据失败' });
  res.json({ success: true });
});

// ---- 启动服务器 ----

app.listen(PORT, () => {
  console.log(`CalStack 服务器已启动！`);
  console.log(`请在浏览器打开: http://localhost:${PORT}`);
});