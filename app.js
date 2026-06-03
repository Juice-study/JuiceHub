// ============================================
// CalStack - 前端逻辑
// 支持多日历：侧边栏选择、总览模式、动态主题色
// ============================================

// ---- 应用状态 ----
const state = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  calendars: [],                      // 日历列表 [{ id, name, icon, color, createdAt }]
  activeCalendarId: 'overview',       // 当前激活的日历ID，'overview' 表示总览模式
  records: {},                        // 各日历的记录 { calendarId: { "YYYY-MM-DD": {...} } }
  selectedDate: null,                 // 弹窗中正在编辑的日期
  editCalId: null                     // 编辑记录弹窗对应的日历ID（从总览编辑时设置）
};

// 弹窗中的临时变量
let selectedMood = '';
let selectedWeather = '';
let editingCalendarId = null;         // 日历管理弹窗中正在编辑的日历ID（null=新建模式）
let selectedCalIcon = '';             // 日历管理弹窗中选中的图标
let selectedCalColor = '#E8756D';     // 日历管理弹窗中选中的颜色

// ---- 页面加载完成后初始化 ----

document.addEventListener('DOMContentLoaded', () => {
  initApp();

  // 日历导航按钮
  document.getElementById('prevMonth').addEventListener('click', goPrevMonth);
  document.getElementById('nextMonth').addEventListener('click', goNextMonth);

  // 快捷跳转选择器（嵌入在导航栏，可输入可下拉）
  initJumpSelects(state.currentYear, state.currentMonth, new Date().getDate());
  document.getElementById('jumpGoBtn').addEventListener('click', jumpToSelectedDate);
  document.getElementById('jumpTodayBtn').addEventListener('click', jumpGoToday);

  // 年/月/日 输入框：失焦/选择时校验并重新生成日选项；回车键跳转
  const yearInput = document.getElementById('jumpYearInput');
  const monthInput = document.getElementById('jumpMonthInput');
  const dayInput = document.getElementById('jumpDayInput');
  [yearInput, monthInput, dayInput].forEach(inp => {
    inp.addEventListener('change', () => {
      sanitizeJumpInputs();
      refreshDayOptions();
    });
    inp.addEventListener('blur', () => {
      sanitizeJumpInputs();
      refreshDayOptions();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sanitizeJumpInputs();
        refreshDayOptions();
        jumpToSelectedDate();
      }
    });
  });

  // 展开下拉选项的▾ 按钮
  document.querySelectorAll('.jump-combo-arrow').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleJumpCombo(btn.dataset.target);
    });
  });

  // 点击页面其他位置：关闭所有已展开的下拉
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.jump-combo')) closeAllJumpCombos();
  });

  // 编辑记录弹窗按钮
  document.getElementById('saveBtn').addEventListener('click', saveMeeting);
  document.getElementById('deleteBtn').addEventListener('click', deleteMeeting);
  document.getElementById('closeBtn').addEventListener('click', closeEditModal);
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') closeEditModal();
  });

  // 总览日详情弹窗
  document.getElementById('overviewDayCloseBtn').addEventListener('click', closeOverviewDayModal);
  document.getElementById('overviewDayModal').addEventListener('click', (e) => {
    if (e.target.id === 'overviewDayModal') closeOverviewDayModal();
  });

  // 日历管理弹窗
  document.getElementById('addCalendarBtn').addEventListener('click', () => openCalendarModal());
  document.getElementById('calSaveBtn').addEventListener('click', saveCalendar);
  document.getElementById('calDeleteBtn').addEventListener('click', deleteCalendar);
  document.getElementById('calCloseBtn').addEventListener('click', closeCalendarModal);
  // 日历弹窗：+ 添加统计项
  const _calAddStatBtn = document.getElementById('calAddStatBtn');
  if (_calAddStatBtn) _calAddStatBtn.addEventListener('click', () => addCalStatRow(''));
  document.getElementById('calendarModal').addEventListener('click', (e) => {
    if (e.target.id === 'calendarModal') closeCalendarModal();
  });

  // 设置心情/天气 emoji 选择器
  setupEmojiPicker('moodPicker', (emoji) => { selectedMood = emoji; }, { multi: true, max: 3 });
  setupEmojiPicker('weatherPicker', (emoji) => { selectedWeather = emoji; }, { multi: true, max: 3 });

  // 设置日历图标选择器
  setupEmojiPicker('calIconPicker', (emoji) => { selectedCalIcon = emoji; });

  // 设置日历颜色选择器
  setupColorPicker();
});

// ---- 初始化：加载数据 ----

async function initApp() {
  await loadCalendars();
  await loadAllRecords();
  renderSidebar();
  applyDefaultTheme();
  renderMainArea();
}

/** 从服务器加载日历列表 */
async function loadCalendars() {
  try {
    const response = await fetch('/api/calendars');
    state.calendars = await response.json();
  } catch (err) {
    console.error('加载日历列表失败:', err);
    state.calendars = [];
  }
}

/** 从服务器加载所有日历的记录 */
async function loadAllRecords() {
  state.records = {};
  for (const cal of state.calendars) {
    try {
      const response = await fetch(`/api/calendars/${cal.id}/records`);
      state.records[cal.id] = await response.json();
    } catch (err) {
      console.error(`加载日历 ${cal.name} 记录失败:`, err);
      state.records[cal.id] = {};
    }
  }
}

// ---- 颜色工具函数 ----

/** 将十六进制颜色转为 RGB 对象 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 232, g: 117, b: 109 };
}

/** 让颜色变亮（amount: 0-1，越大越浅） */
function lightenColor(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
}

/** 让颜色变暗（amount: 0-1，越大越深） */
function darkenColor(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const dr = Math.round(r * (1 - amount));
  const dg = Math.round(g * (1 - amount));
  const db = Math.round(b * (1 - amount));
  return `#${dr.toString(16).padStart(2,'0')}${dg.toString(16).padStart(2,'0')}${db.toString(16).padStart(2,'0')}`;
}

/** 应用日历的主题色到 CSS 变量 */
function applyTheme(color) {
  const root = document.documentElement;
  root.style.setProperty('--theme-color', color);
  root.style.setProperty('--theme-color-light', lightenColor(color, 0.6));
  root.style.setProperty('--theme-color-lighter', lightenColor(color, 0.75));
  root.style.setProperty('--theme-color-dark', darkenColor(color, 0.15));
}

/** 恢复默认珊瑚色主题（总览模式用） */
function applyDefaultTheme() {
  applyTheme('#E8756D');
}

// ---- 侧边栏渲染 ----

/** 渲染侧边栏的日历列表 */
function renderSidebar() {
  const list = document.getElementById('sidebarList');
  list.innerHTML = '';

  // 1. 总览项（固定在最上方）
  const overviewItem = document.createElement('div');
  overviewItem.className = 'sidebar-item overview-item' + (state.activeCalendarId === 'overview' ? ' active' : '');
  overviewItem.innerHTML = `
    <span class="sidebar-item-icon">📋</span>
    <span class="sidebar-item-name">日历总览</span>
  `;
  overviewItem.addEventListener('click', () => selectCalendar('overview'));
  list.appendChild(overviewItem);

  // 2. 各个日历项
  state.calendars.forEach(cal => {
    const item = document.createElement('div');
    item.className = 'sidebar-item' + (state.activeCalendarId === cal.id ? ' active' : '');
    item.innerHTML = `
      <div class="sidebar-item-color" style="background:${cal.color}"></div>
      <span class="sidebar-item-icon">${cal.icon}</span>
      <span class="sidebar-item-name">${cal.name}</span>
      <button class="sidebar-item-edit" title="编辑日历">✏️</button>
    `;
    // 点击日历名称 → 选中该日历
    item.addEventListener('click', (e) => {
      // 如果点击的是编辑按钮，打开编辑弹窗而不是选中
      if (e.target.classList.contains('sidebar-item-edit')) {
        e.stopPropagation();
        openCalendarModal(cal.id);
        return;
      }
      selectCalendar(cal.id);
    });
    list.appendChild(item);
  });
}

/** 选中一个日历（或总览），更新侧边栏高亮和主区域 */
function selectCalendar(calendarId) {
  state.activeCalendarId = calendarId;

  // 应用对应日历的主题色，或恢复默认
  if (calendarId === 'overview') {
    applyDefaultTheme();
  } else {
    const cal = state.calendars.find(c => c.id === calendarId);
    if (cal) applyTheme(cal.color);
  }

  renderSidebar();
  renderMainArea();
}

// ---- 日历导航 ----

function goPrevMonth() {
  state.currentMonth--;
  if (state.currentMonth < 1) {
    state.currentMonth = 12;
    state.currentYear--;
  }
  renderMainArea();
}

function goNextMonth() {
  state.currentMonth++;
  if (state.currentMonth > 12) {
    state.currentMonth = 1;
    state.currentYear++;
  }
  renderMainArea();
}

// ---- 跳转日期选择器（年/月/日 可输入可下拉 + 跳转按钮） ----

/** 初始化 年/月/日 输入框与下拉候选项 */
function initJumpSelects(year, month, day) {
  const yearInput = document.getElementById('jumpYearInput');
  const monthInput = document.getElementById('jumpMonthInput');

  // 年份候选：2000 - 2099
  const years = [];
  for (let y = 2000; y <= 2099; y++) years.push(y);
  populateComboList('jumpYearList', years, 'jumpYearInput');
  yearInput.value = year;

  // 月份候选：01 - 12
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(String(m).padStart(2, '0'));
  populateComboList('jumpMonthList', months, 'jumpMonthInput');
  monthInput.value = String(month).padStart(2, '0');

  // 日期根据年月动态生成
  refreshDayOptions(day);
}

/** 填充某个下拉列表（<ul>）的选项，点击某项时写入对应 input 并触发后续逻辑 */
function populateComboList(listId, values, inputId) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  values.forEach(v => {
    const li = document.createElement('li');
    li.className = 'jump-combo-item';
    li.textContent = v;
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      const inp = document.getElementById(inputId);
      inp.value = v;
      closeAllJumpCombos();
      sanitizeJumpInputs();
      refreshDayOptions();
      inp.focus();
    });
    list.appendChild(li);
  });
}

/** 根据当前输入的年月，重新生成日候选项（处理闰年、月底） */
function refreshDayOptions(preferDay) {
  const dayInput = document.getElementById('jumpDayInput');
  const { year, month } = readJumpInputs();
  const maxDay = new Date(year, month, 0).getDate();

  // 优先使用传入值，否则保留之前输入；超出月底则取最大日
  const prev = preferDay !== undefined ? preferDay : (parseInt(dayInput.value) || 1);
  const target = Math.max(1, Math.min(prev, maxDay));

  const days = [];
  for (let d = 1; d <= maxDay; d++) days.push(String(d).padStart(2, '0'));
  populateComboList('jumpDayList', days, 'jumpDayInput');
  dayInput.value = String(target).padStart(2, '0');
}

/** 展开/收起某个下拉列表（年/月/日） */
function toggleJumpCombo(field) {
  const map = { year: 'jumpYearList', month: 'jumpMonthList', day: 'jumpDayList' };
  const listId = map[field];
  if (!listId) return;
  const list = document.getElementById(listId);
  const isOpen = !list.classList.contains('hidden');
  closeAllJumpCombos();
  if (!isOpen) {
    list.classList.remove('hidden');
    // 滚动到当前值对应的选项
    const inputId = field === 'year' ? 'jumpYearInput' : (field === 'month' ? 'jumpMonthInput' : 'jumpDayInput');
    const cur = document.getElementById(inputId).value;
    const items = list.querySelectorAll('.jump-combo-item');
    items.forEach(it => {
      it.classList.toggle('active', it.textContent === cur);
      if (it.textContent === cur) it.scrollIntoView({ block: 'nearest' });
    });
  }
}

/** 关闭所有下拉列表 */
function closeAllJumpCombos() {
  document.querySelectorAll('.jump-combo-list').forEach(l => l.classList.add('hidden'));
}

/** 读取当前三个输入框的数值（不校验范围，错误时返回默认值） */
function readJumpInputs() {
  const y = parseInt(document.getElementById('jumpYearInput').value);
  const m = parseInt(document.getElementById('jumpMonthInput').value);
  const d = parseInt(document.getElementById('jumpDayInput').value);
  return {
    year: isNaN(y) ? state.currentYear : y,
    month: isNaN(m) ? state.currentMonth : m,
    day: isNaN(d) ? 1 : d
  };
}

/** 校验并纠正输入框的值（年 2000-2099、月 1-12、日 1-当月最大） */
function sanitizeJumpInputs() {
  const yearInput = document.getElementById('jumpYearInput');
  const monthInput = document.getElementById('jumpMonthInput');
  const dayInput = document.getElementById('jumpDayInput');

  let y = parseInt(yearInput.value);
  let m = parseInt(monthInput.value);
  let d = parseInt(dayInput.value);

  if (isNaN(y)) y = state.currentYear;
  y = Math.max(2000, Math.min(2099, y));

  if (isNaN(m)) m = state.currentMonth;
  m = Math.max(1, Math.min(12, m));

  const maxDay = new Date(y, m, 0).getDate();
  if (isNaN(d)) d = 1;
  d = Math.max(1, Math.min(maxDay, d));

  yearInput.value = y;
  monthInput.value = String(m).padStart(2, '0');
  dayInput.value = String(d).padStart(2, '0');
}

/** 点击“跳转”：将主日历切换到输入的年月 */
function jumpToSelectedDate() {
  sanitizeJumpInputs();
  const { year, month } = readJumpInputs();
  if (!year || !month) {
    alert('请输入有效的年月');
    return;
  }
  state.currentYear = year;
  state.currentMonth = month;
  renderMainArea();
}

/** 快捷按钮：跳到今天（同时刷新主日历） */
function jumpGoToday() {
  const t = new Date();
  initJumpSelects(t.getFullYear(), t.getMonth() + 1, t.getDate());
  state.currentYear = t.getFullYear();
  state.currentMonth = t.getMonth() + 1;
  renderMainArea();
}

// ---- 主区域渲染 ----

/** 根据当前激活的日历，渲染主区域 */
function renderMainArea() {
  if (state.activeCalendarId === 'overview') {
    renderOverviewCalendar();
  } else {
    renderSingleCalendar();
  }
  updateCounter();
}

/** 渲染单个日历的月视图（和原来类似，但使用日历主题色） */
function renderSingleCalendar() {
  const cal = state.calendars.find(c => c.id === state.activeCalendarId);
  if (!cal) return;

  // 更新标题和导航栏
  document.getElementById('mainTitle').textContent = `${cal.icon} ${cal.name}`;
  document.getElementById('currentMonth').textContent = `${state.currentYear}年${state.currentMonth}月`;

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  const year = state.currentYear;
  const month = state.currentMonth;
  const records = state.records[state.activeCalendarId] || {};

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();

  const today = new Date();
  const todayStr = formatDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // 填充开头：上月末日期（灰色）
  fillLeadingOtherMonth(grid, year, month, firstDayOfWeek);

  // 渲染每一天
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = formatDate(year, month, day);
    const record = records[dateStr];
    const isToday = dateStr === todayStr;

    const cell = createDayCell(day, dateStr, isToday, record);
    // 点击打开编辑弹窗
    cell.addEventListener('click', () => openEditModal(dateStr));
    grid.appendChild(cell);
  }

  // 填充末尾：下月初日期（灰色）
  fillTrailingOtherMonth(grid, year, month, firstDayOfWeek, daysInMonth);
}

/** 渲染总览模式的月视图 */
function renderOverviewCalendar() {
  document.getElementById('mainTitle').textContent = 'CalStack';
  document.getElementById('currentMonth').textContent = `${state.currentYear}年${state.currentMonth}月`;

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  const year = state.currentYear;
  const month = state.currentMonth;

  // 获取总览数据：合并所有日历的记录
  const overviewData = getOverviewRecords();

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();

  const today = new Date();
  const todayStr = formatDate(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // 填充开头：上月末日期（灰色）
  fillLeadingOtherMonth(grid, year, month, firstDayOfWeek);

  // 渲染每一天
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = formatDate(year, month, day);
    const dayRecords = overviewData[dateStr];  // [{ calendar, record }, ...]
    const isToday = dateStr === todayStr;

    const cell = document.createElement('div');
    cell.className = 'day-cell';
    if (isToday) cell.classList.add('today');

    // 日期数字
    const dateNum = document.createElement('span');
    dateNum.className = 'date-num';
    dateNum.textContent = day;
    cell.appendChild(dateNum);

    if (dayRecords && dayRecords.length > 0) {
      if (dayRecords.length === 1) {
        // 只有一个日历有记录：和单日历模式类似，用该日历的颜色
        const { calendar, record } = dayRecords[0];
        cell.classList.add('has-meeting');
        cell.style.background = lightenColor(calendar.color, 0.6);
        cell.style.borderLeftColor = calendar.color;

        if (record.mood) {
          const moodSpan = document.createElement('span');
          moodSpan.className = 'mood-emoji';
          moodSpan.textContent = record.mood;
          cell.appendChild(moodSpan);
        }
        if (record.location) {
          const locSpan = document.createElement('span');
          locSpan.className = 'location-text';
          locSpan.textContent = record.location;
          cell.appendChild(locSpan);
        }
        if (record.weather) {
          const weatherSpan = document.createElement('span');
          weatherSpan.className = 'weather-emoji';
          weatherSpan.textContent = record.weather;
          cell.appendChild(weatherSpan);
        }
        // 右上角统计计数角标
        const total = sumRecordStats(record);
        if (total > 0) cell.appendChild(createStatsBadge(total, calendar.color));
      } else {
        // 多个日历有记录：显示彩色指示点 + 日历图标
        cell.classList.add('has-meeting', 'overview-multi');

        // 彩色指示点
        const indicators = document.createElement('div');
        indicators.className = 'overview-indicators';
        dayRecords.forEach(({ calendar }) => {
          const dot = document.createElement('span');
          dot.className = 'overview-dot';
          dot.style.background = calendar.color;
          indicators.appendChild(dot);
        });
        cell.appendChild(indicators);

        // 日历图标
        const icons = document.createElement('div');
        icons.className = 'overview-icons';
        dayRecords.forEach(({ calendar }) => {
          const icon = document.createElement('span');
          icon.className = 'overview-icon';
          icon.textContent = calendar.icon;
          icons.appendChild(icon);
        });
        cell.appendChild(icons);

        // 右上角统计计数角标（多日历汇总）
        let totalAll = 0;
        dayRecords.forEach(({ record }) => { totalAll += sumRecordStats(record); });
        if (totalAll > 0) cell.appendChild(createStatsBadge(totalAll));
      }

      // 总览模式点击：显示该日所有记录的只读摘要
      cell.addEventListener('click', () => openOverviewDayModal(dateStr, dayRecords));
    }

    grid.appendChild(cell);
  }

  // 填充末尾：下月初日期（灰色）
  fillTrailingOtherMonth(grid, year, month, firstDayOfWeek, daysInMonth);
}

/** 计算总览数据：合并所有日历的记录 */
function getOverviewRecords() {
  const combined = {};
  state.calendars.forEach(cal => {
    const calRecords = state.records[cal.id] || {};
    Object.entries(calRecords).forEach(([date, record]) => {
      // 只统计有实际内容的记录（至少一个字段非空）
      if (record.mood || record.location || record.weather || record.diary) {
        if (!combined[date]) combined[date] = [];
        combined[date].push({ calendar: cal, record });
      }
    });
  });
  return combined;
}

// ---- 日历单元格辅助函数 ----

/** 计算一条记录的 stats 总计数（多项求和） */
function sumRecordStats(record) {
  if (!record || !record.stats || typeof record.stats !== 'object') return 0;
  let s = 0;
  Object.values(record.stats).forEach(v => {
    const n = parseInt(v);
    if (!isNaN(n) && n > 0) s += n;
  });
  return s;
}

/** 创建右上角统计计数角标元素 */
function createStatsBadge(total, color) {
  const badge = document.createElement('span');
  badge.className = 'stats-badge';
  badge.textContent = total > 99 ? '99+' : String(total);
  if (color) badge.style.background = color;
  return badge;
}

/** 创建跨月灰色日期格（上月末或下月初），点击跳转到对应月份并打开该日期的日记弹窗 */
function createOtherMonthCell(targetYear, targetMonth, day) {
  const cell = document.createElement('div');
  cell.className = 'day-cell other-month';
  const dateNum = document.createElement('span');
  dateNum.className = 'date-num';
  dateNum.textContent = day;
  cell.appendChild(dateNum);
  cell.addEventListener('click', () => {
    state.currentYear = targetYear;
    state.currentMonth = targetMonth;
    renderMainArea();
    // 切换后弹出该日期的日记弹窗
    const dateStr = formatDate(targetYear, targetMonth, day);
    if (state.activeCalendarId === 'overview') {
      // 总览模式：如果该天有记录则弹出汇总摘要
      const overviewData = getOverviewRecords();
      const dayRecords = overviewData[dateStr];
      if (dayRecords && dayRecords.length > 0) {
        openOverviewDayModal(dateStr, dayRecords);
      }
    } else {
      // 单日历模式：直接打开编辑弹窗
      openEditModal(dateStr);
    }
  });
  return cell;
}

/** 填充当月开头的上月末日期 */
function fillLeadingOtherMonth(grid, year, month, firstDayOfWeek) {
  if (firstDayOfWeek === 0) return;
  // 上个月份
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }
  const daysInPrev = new Date(prevYear, prevMonth, 0).getDate();
  // 从上月末倒推 firstDayOfWeek 天
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = daysInPrev - i;
    grid.appendChild(createOtherMonthCell(prevYear, prevMonth, day));
  }
}

/** 填充当月末尾的下月初日期，使网格对齐 */
function fillTrailingOtherMonth(grid, year, month, firstDayOfWeek, daysInMonth) {
  const totalCells = firstDayOfWeek + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  if (remaining === 0) return;
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
  for (let day = 1; day <= remaining; day++) {
    grid.appendChild(createOtherMonthCell(nextYear, nextMonth, day));
  }
}

/** 创建空白格 */
function createEmptyCell() {
  const cell = document.createElement('div');
  cell.className = 'day-cell empty';
  return cell;
}

/** 创建有内容的日历格（单日历模式） */
function createDayCell(day, dateStr, isToday, record) {
  const cell = document.createElement('div');
  cell.className = 'day-cell';
  cell.dataset.date = dateStr;

  if (record && (record.mood || record.location || record.weather || record.diary)) {
    cell.classList.add('has-meeting');
  }
  if (isToday) cell.classList.add('today');

  // 日期数字
  const dateNum = document.createElement('span');
  dateNum.className = 'date-num';
  dateNum.textContent = day;
  cell.appendChild(dateNum);

  // 如果有记录，显示心情、地点、天气
  if (record) {
    if (record.mood) {
      const moodSpan = document.createElement('span');
      moodSpan.className = 'mood-emoji';
      moodSpan.textContent = record.mood;
      cell.appendChild(moodSpan);
    }
    if (record.location) {
      const locSpan = document.createElement('span');
      locSpan.className = 'location-text';
      locSpan.textContent = record.location;
      cell.appendChild(locSpan);
    }
    if (record.weather) {
      const weatherSpan = document.createElement('span');
      weatherSpan.className = 'weather-emoji';
      weatherSpan.textContent = record.weather;
      cell.appendChild(weatherSpan);
    }
    // 右上角统计计数角标
    const total = sumRecordStats(record);
    if (total > 0) cell.appendChild(createStatsBadge(total));
  }

  return cell;
}

/** 填充日历末尾的空白格，使网格对齐 */
function fillTrailingEmpty(grid, firstDayOfWeek, daysInMonth) {
  const totalCells = firstDayOfWeek + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let i = 0; i < remaining; i++) {
    grid.appendChild(createEmptyCell());
  }
}

// ---- 更新计数器 ----

function updateCounter() {
  let count = 0;
  // 汇总该日历所有记录的统计项计数
  const statsAgg = {};
  const statsOrder = [];

  function aggregate(recordObj) {
    if (!recordObj || !recordObj.stats || typeof recordObj.stats !== 'object') return;
    Object.entries(recordObj.stats).forEach(([k, v]) => {
      const n = parseInt(v);
      if (isNaN(n) || n < 1) return;
      if (!(k in statsAgg)) { statsAgg[k] = 0; statsOrder.push(k); }
      statsAgg[k] += n;
    });
  }

  if (state.activeCalendarId === 'overview') {
    // 总览模式：统计所有日历的有内容记录总数（不显示 stats 汇总）
    state.calendars.forEach(cal => {
      const recs = state.records[cal.id] || {};
      Object.values(recs).forEach(r => {
        if (r.mood || r.location || r.weather || r.diary) count++;
      });
    });
  } else {
    // 单日历模式
    const recs = state.records[state.activeCalendarId] || {};
    Object.values(recs).forEach(r => {
      if (r.mood || r.location || r.weather || r.diary) count++;
      aggregate(r);
    });
  }

  const counterEl = document.getElementById('mainCounter');
  if (!counterEl) return;

  // 构造顶部汇总标签 HTML
  let summaryHtml = '';
  if (state.activeCalendarId !== 'overview') {
    const cal = state.calendars.find(c => c.id === state.activeCalendarId);
    const calStats = (cal && Array.isArray(cal.stats)) ? cal.stats : [];
    // 按日历配置顺序输出，只展示有计数的项
    calStats.forEach(name => {
      if (statsAgg[name]) {
        summaryHtml += `<span class="stats-summary-item">${escapeHtml(name)} ${statsAgg[name]}</span>`;
      }
    });
  }

  counterEl.innerHTML =
    `<span class="counter-base">共 <span id="meetingCount">${count}</span> 条记录</span>` +
    (summaryHtml ? `<span class="stats-summary">${summaryHtml}</span>` : '<span class="stats-summary"></span>');
}

// ---- 日期格式化 ----

function formatDate(year, month, day) {
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDateFriendly(dateStr) {
  const parts = dateStr.split('-');
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  const day = parseInt(parts[2]);
  const dateObj = new Date(year, month - 1, day);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${month}月${day}日 (${weekdays[dateObj.getDay()]})`;
}

// ---- 编辑记录弹窗 ----

/** 打开编辑弹窗，可以指定日历ID（从总览跳转编辑时需要） */
function openEditModal(dateStr, calendarId) {
  // 如果从总览模式编辑，使用传入的日历ID；否则使用当前选中的日历
  const calId = calendarId || state.activeCalendarId;
  if (!calId || calId === 'overview') return;

  state.selectedDate = dateStr;
  // 记住正在编辑哪个日历（保存/删除时要用）
  state.editCalId = calId;
  selectedMood = '';
  selectedWeather = '';

  // 临时切换主题色为该日历的颜色，让弹窗也使用对应主题
  const cal = state.calendars.find(c => c.id === calId);
  if (cal) applyTheme(cal.color);

  const records = state.records[calId] || {};
  const record = records[dateStr];

  document.getElementById('modalDate').textContent = formatDateFriendly(dateStr);

  if (record) {
    selectedMood = record.mood || '';
    selectedWeather = record.weather || '';
    document.getElementById('locationInput').value = record.location || '';
    document.getElementById('diaryInput').value = record.diary || '';
  } else {
    document.getElementById('locationInput').value = '';
    document.getElementById('diaryInput').value = '';
  }

  // 渲染该日历的自定义统计项计数控件
  renderRecordStatsControls(cal, record);

  updateEmojiSelection('moodPicker', selectedMood, { multi: true });
  updateEmojiSelection('weatherPicker', selectedWeather, { multi: true });
  document.getElementById('deleteBtn').style.display = record ? 'inline-block' : 'none';

  document.getElementById('editModal').classList.remove('hidden');
}

/** 关闭编辑弹窗 */
function closeEditModal() {
  document.getElementById('editModal').classList.add('hidden');
  state.selectedDate = null;
  state.editCalId = null;

  // 恢复当前选中日历的主题色（编辑总览中的记录时会临时切换主题）
  if (state.activeCalendarId === 'overview') {
    applyDefaultTheme();
  } else {
    const cal = state.calendars.find(c => c.id === state.activeCalendarId);
    if (cal) applyTheme(cal.color);
  }
}

// ---- 总览日详情弹窗 ----

/** 打开总览模式某天的所有记录摘要（每条记录可点击编辑） */
function openOverviewDayModal(dateStr, dayRecords) {
  // 记住当前日期，供编辑按钮使用
  const currentDateStr = dateStr;

  document.getElementById('overviewDayDate').textContent = formatDateFriendly(dateStr);

  const content = document.getElementById('overviewDayContent');
  content.innerHTML = '';

  dayRecords.forEach(({ calendar, record }) => {
    const item = document.createElement('div');
    item.className = 'overview-record-item';
    item.style.borderLeftColor = calendar.color;

    let detailsHtml = '<div class="overview-record-header">';
    detailsHtml += `<span class="overview-record-cal-icon">${calendar.icon}</span>`;
    detailsHtml += `<span class="overview-record-cal-name" style="color:${calendar.color}">${calendar.name}</span>`;
    detailsHtml += `<button class="overview-edit-btn" style="color:${calendar.color}">编辑</button>`;
    detailsHtml += '</div>';

    detailsHtml += '<div class="overview-record-details">';
    if (record.mood) detailsHtml += `<span>${record.mood}</span>`;
    if (record.weather) detailsHtml += `<span>${record.weather}</span>`;
    if (record.location) detailsHtml += `<span>📍 ${record.location}</span>`;
    detailsHtml += '</div>';

    if (record.diary) {
      detailsHtml += `<div class="overview-record-diary">${escapeHtml(record.diary)}</div>`;
    }

    item.innerHTML = detailsHtml;

    // 点击"编辑"按钮：关闭总览弹窗，打开对应日历的编辑弹窗
    const editBtn = item.querySelector('.overview-edit-btn');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeOverviewDayModal();
      // 打开编辑弹窗，指定日历ID和日期
      openEditModal(currentDateStr, calendar.id);
    });

    content.appendChild(item);
  });

  document.getElementById('overviewDayModal').classList.remove('hidden');
}

/** 关闭总览日详情弹窗 */
function closeOverviewDayModal() {
  document.getElementById('overviewDayModal').classList.add('hidden');
}

/** 转义 HTML 特殊字符，防止 XSS */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---- Emoji 选择器 ----

/**
 * 初始化 emoji 选择器
 * @param {string} pickerId 选择器容器 id
 * @param {Function} onSelect 选择变动回调，传入当前选中的字符串（多选时拼接）
 * @param {Object} options { multi: 多选; max: 最大选中数 }
 */
function setupEmojiPicker(pickerId, onSelect, options) {
  const picker = document.getElementById(pickerId);
  if (!picker) return;
  const opts = options || {};
  const multi = !!opts.multi;
  const max = opts.max || 3;
  const buttons = picker.querySelectorAll('.emoji-btn');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      if (multi) {
        // 多选：toggle，限制最大个数
        if (btn.classList.contains('selected')) {
          btn.classList.remove('selected');
        } else {
          const selectedCount = picker.querySelectorAll('.emoji-btn.selected').length;
          if (selectedCount >= max) {
            // 超过最大数，不动作、给个提示
            picker.classList.remove('flash-warn');
            void picker.offsetWidth; // 重启动画
            picker.classList.add('flash-warn');
            return;
          }
          btn.classList.add('selected');
        }
        // 收集选中的 emoji 并拼接
        const list = [];
        picker.querySelectorAll('.emoji-btn.selected').forEach(b => list.push(b.dataset.emoji));
        onSelect(list.join(''));
      } else {
        // 单选：原逻辑
        if (btn.classList.contains('selected')) {
          btn.classList.remove('selected');
          onSelect('');
          return;
        }
        buttons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        onSelect(emoji);
      }
    });
  });
}

/**
 * 根据存储的 emoji 字符串设置选中状态
 * 多选时，字符串可能包含多个 emoji 拼接，以按钮字典反向匹配
 */
function updateEmojiSelection(pickerId, emoji, options) {
  const picker = document.getElementById(pickerId);
  if (!picker) return;
  const opts = options || {};
  const multi = !!opts.multi;
  const buttons = picker.querySelectorAll('.emoji-btn');
  buttons.forEach(b => b.classList.remove('selected'));
  if (!emoji) return;
  if (multi) {
    // 遍历按钮词典，如果 emoji 字符串包含该按钮的 emoji 则选中
    buttons.forEach(b => {
      if (b.dataset.emoji && emoji.indexOf(b.dataset.emoji) !== -1) {
        b.classList.add('selected');
      }
    });
  } else {
    buttons.forEach(b => {
      if (b.dataset.emoji === emoji) b.classList.add('selected');
    });
  }
}

// ---- 颜色选择器（日历管理弹窗） ----

function setupColorPicker() {
  const picker = document.getElementById('calColorPicker');
  if (!picker) return;

  // 预设色块点击事件
  const swatches = picker.querySelectorAll('.color-swatch:not(.custom-color-swatch)');
  swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      swatches.forEach(s => s.classList.remove('selected'));
      // 取消自定义取色器的选中状态
      const customSwatch = picker.querySelector('.custom-color-swatch');
      if (customSwatch) customSwatch.classList.remove('selected');
      swatch.classList.add('selected');
      selectedCalColor = swatch.dataset.color;
    });
  });

  // 自定义取色器（色盘）
  const customInput = document.getElementById('customColorInput');
  if (customInput) {
    customInput.addEventListener('input', (e) => {
      const color = e.target.value;
      // 取消所有预设色块的选中
      swatches.forEach(s => s.classList.remove('selected'));
      // 选中自定义色块
      const customSwatch = picker.querySelector('.custom-color-swatch');
      if (customSwatch) customSwatch.classList.add('selected');
      selectedCalColor = color;
    });
  }
}

function updateColorSelection(color) {
  const picker = document.getElementById('calColorPicker');
  if (!picker) return;

  const swatches = picker.querySelectorAll('.color-swatch:not(.custom-color-swatch)');
  const customSwatch = picker.querySelector('.custom-color-swatch');

  // 先清除所有选中
  swatches.forEach(s => s.classList.remove('selected'));
  if (customSwatch) customSwatch.classList.remove('selected');

  // 尝试匹配预设色块
  let matched = false;
  swatches.forEach(s => {
    if (s.dataset.color && s.dataset.color.toUpperCase() === color.toUpperCase()) {
      s.classList.add('selected');
      matched = true;
    }
  });

  // 如果没匹配到预设色块，使用自定义取色器
  if (!matched && customSwatch) {
    customSwatch.classList.add('selected');
    const customInput = document.getElementById('customColorInput');
    if (customInput) customInput.value = color;
  }

  selectedCalColor = color;
}

// ---- 保存记录 ----

async function saveMeeting() {
  const date = state.selectedDate;
  // 优先使用 editCalId（从总览编辑时设置），否则用当前选中的日历
  const calId = state.editCalId || state.activeCalendarId;
  if (!date || !calId) return;

  const data = {
    mood: selectedMood,
    location: document.getElementById('locationInput').value.trim(),
    weather: selectedWeather,
    diary: document.getElementById('diaryInput').value.trim(),
    stats: collectRecordStats()
  };

  try {
    const response = await fetch(`/api/calendars/${calId}/records/${date}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (response.ok) {
      const saved = await response.json();
      if (!state.records[calId]) state.records[calId] = {};
      state.records[calId][date] = saved;
      renderMainArea();
      closeEditModal();
    } else {
      alert('保存失败，请重试');
    }
  } catch (err) {
    console.error('保存请求出错:', err);
    alert('保存失败，请检查网络连接');
  }
}

// ---- 删除记录 ----

async function deleteMeeting() {
  const date = state.selectedDate;
  // 优先使用 editCalId（从总览编辑时设置），否则用当前选中的日历
  const calId = state.editCalId || state.activeCalendarId;
  if (!date || !calId) return;

  if (!confirm('确定要删除这条记录吗？')) return;

  try {
    const response = await fetch(`/api/calendars/${calId}/records/${date}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      delete state.records[calId][date];
      renderMainArea();
      closeEditModal();
    } else {
      alert('删除失败，请重试');
    }
  } catch (err) {
    console.error('删除请求出错:', err);
    alert('删除失败，请检查网络连接');
  }
}

// ---- 日历管理弹窗 ----

/** 打开日历管理弹窗（新建或编辑模式） */
function openCalendarModal(calendarId) {
  editingCalendarId = calendarId || null;
  selectedCalIcon = '';
  selectedCalColor = '#E8756D';

  if (calendarId) {
    // 编辑模式：填入已有数据
    const cal = state.calendars.find(c => c.id === calendarId);
    if (!cal) return;

    document.getElementById('calendarModalTitle').textContent = '编辑日历';
    document.getElementById('calNameInput').value = cal.name;
    selectedCalIcon = cal.icon;
    selectedCalColor = cal.color;
    document.getElementById('calSaveBtn').textContent = '保存';
    document.getElementById('calDeleteBtn').style.display = 'inline-block';
    renderCalStatsEditor(Array.isArray(cal.stats) ? cal.stats : []);
  } else {
    // 新建模式
    document.getElementById('calendarModalTitle').textContent = '新建日历';
    document.getElementById('calNameInput').value = '';
    document.getElementById('calSaveBtn').textContent = '创建';
    document.getElementById('calDeleteBtn').style.display = 'none';
    renderCalStatsEditor([]);
  }

  updateEmojiSelection('calIconPicker', selectedCalIcon);
  updateColorSelection(selectedCalColor);

  document.getElementById('calendarModal').classList.remove('hidden');
}

/** 关闭日历管理弹窗 */
function closeCalendarModal() {
  document.getElementById('calendarModal').classList.add('hidden');
  editingCalendarId = null;
}

/** 保存日历（新建或编辑） */
async function saveCalendar() {
  const name = document.getElementById('calNameInput').value.trim();
  if (!name) {
    alert('请输入日历名称');
    return;
  }
  if (!selectedCalIcon) {
    alert('请选择一个图标');
    return;
  }

  try {
    let response;
    const stats = collectCalStats();
    if (editingCalendarId) {
      // 编辑模式：PUT
      response = await fetch(`/api/calendars/${editingCalendarId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon: selectedCalIcon, color: selectedCalColor, stats })
      });
    } else {
      // 新建模式：POST
      response = await fetch('/api/calendars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, icon: selectedCalIcon, color: selectedCalColor, stats })
      });
    }

    if (response.ok) {
      // 重新加载日历列表
      await loadCalendars();
      // 重新加载该日历记录（服务端可能因删除某些 stats 项而在记录中同步清理）
      if (editingCalendarId) {
        await loadAllRecords();
      }
      renderSidebar();

      // 如果是编辑当前选中的日历，刷新主题
      if (editingCalendarId === state.activeCalendarId) {
        const cal = state.calendars.find(c => c.id === editingCalendarId);
        if (cal) applyTheme(cal.color);
        renderMainArea();
      }

      // 如果是新建，自动选中新日历
      if (!editingCalendarId && state.calendars.length > 0) {
        const newCal = state.calendars[state.calendars.length - 1];
        selectCalendar(newCal.id);
      }

      closeCalendarModal();
    } else {
      const err = await response.json();
      alert(err.error || '操作失败');
    }
  } catch (err) {
    console.error('保存日历出错:', err);
    alert('操作失败，请检查网络连接');
  }
}

/** 删除日历 */
async function deleteCalendar() {
  if (!editingCalendarId) return;
  if (!confirm('确定要删除这个日历及其所有记录吗？此操作不可撤销！')) return;

  try {
    const response = await fetch(`/api/calendars/${editingCalendarId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      // 如果删除的是当前选中的日历，切换到总览
      if (state.activeCalendarId === editingCalendarId) {
        selectCalendar('overview');
      }

      await loadCalendars();
      await loadAllRecords();
      renderSidebar();
      renderMainArea();
      closeCalendarModal();
    } else {
      const err = await response.json();
      alert(err.error || '删除失败');
    }
  } catch (err) {
    console.error('删除日历出错:', err);
    alert('删除失败，请检查网络连接');
  }
}

// ---- 自定义统计项 · 日历弹窗编辑 ----

/** 渲染日历弹窗的统计项编辑列表 */
function renderCalStatsEditor(statsArr) {
  const container = document.getElementById('calStatsContainer');
  if (!container) return;
  container.innerHTML = '';
  (statsArr || []).forEach(name => addCalStatRow(name));
}

/** 在日历弹窗统计项列表中加一行 */
function addCalStatRow(initialValue) {
  const container = document.getElementById('calStatsContainer');
  if (!container) return;
  if (container.querySelectorAll('.cal-stat-row').length >= 20) {
    alert('最多只能添加 20 个统计项');
    return;
  }
  const row = document.createElement('div');
  row.className = 'cal-stat-row';
  row.innerHTML = `
    <input type="text" class="cal-stat-input" maxlength="10" placeholder="例：见面" value="${escapeHtml(initialValue || '')}">
    <button type="button" class="cal-stat-remove" aria-label="删除">×</button>
  `;
  row.querySelector('.cal-stat-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
  if (!initialValue) {
    const inp = row.querySelector('input');
    if (inp) inp.focus();
  }
}

/** 从弹窗中收集统计项标签数组（去重、去空、限制长度） */
function collectCalStats() {
  const inputs = document.querySelectorAll('#calStatsContainer .cal-stat-input');
  const result = [];
  const seen = new Set();
  inputs.forEach(inp => {
    const v = (inp.value || '').trim();
    if (!v || v.length > 10) return;
    if (seen.has(v)) return;
    seen.add(v);
    result.push(v);
  });
  return result;
}

// ---- 自定义统计项 · 记录弹窗计数控件 ----

/** 根据日历的 stats 配置，在记录弹窗中渲染计数控件 */
function renderRecordStatsControls(cal, record) {
  const field = document.getElementById('recordStatsField');
  const container = document.getElementById('recordStatsContainer');
  if (!field || !container) return;

  const statsList = (cal && Array.isArray(cal.stats)) ? cal.stats : [];
  container.innerHTML = '';

  if (statsList.length === 0) {
    field.style.display = 'none';
    return;
  }
  field.style.display = '';

  const recordStats = (record && record.stats && typeof record.stats === 'object') ? record.stats : {};

  statsList.forEach(name => {
    const row = document.createElement('div');
    row.className = 'record-stat-row';
    row.dataset.name = name;
    const enabled = name in recordStats;
    const value = enabled ? Math.max(1, parseInt(recordStats[name]) || 1) : 1;
    row.innerHTML = `
      <label class="record-stat-toggle">
        <input type="checkbox" class="record-stat-check" ${enabled ? 'checked' : ''}>
        <span class="record-stat-name">${escapeHtml(name)}</span>
      </label>
      <div class="record-stat-counter ${enabled ? '' : 'disabled'}">
        <button type="button" class="record-stat-btn record-stat-minus" aria-label="减少">−</button>
        <span class="record-stat-value">${value}</span>
        <button type="button" class="record-stat-btn record-stat-plus" aria-label="增加">+</button>
      </div>
    `;
    const checkBox = row.querySelector('.record-stat-check');
    const counter = row.querySelector('.record-stat-counter');
    const valueEl = row.querySelector('.record-stat-value');
    const minusBtn = row.querySelector('.record-stat-minus');
    const plusBtn = row.querySelector('.record-stat-plus');

    checkBox.addEventListener('change', () => {
      if (checkBox.checked) counter.classList.remove('disabled');
      else counter.classList.add('disabled');
    });
    minusBtn.addEventListener('click', () => {
      if (counter.classList.contains('disabled')) return;
      let v = parseInt(valueEl.textContent) || 1;
      if (v > 1) valueEl.textContent = String(v - 1);
    });
    plusBtn.addEventListener('click', () => {
      if (counter.classList.contains('disabled')) return;
      let v = parseInt(valueEl.textContent) || 1;
      if (v < 999) valueEl.textContent = String(v + 1);
    });

    container.appendChild(row);
  });
}

/** 从记录弹窗中收集勾选状态的 stats 计数对象 */
function collectRecordStats() {
  const result = {};
  document.querySelectorAll('#recordStatsContainer .record-stat-row').forEach(row => {
    const name = row.dataset.name;
    const checked = row.querySelector('.record-stat-check').checked;
    if (!checked) return;
    const v = parseInt(row.querySelector('.record-stat-value').textContent) || 1;
    if (v >= 1 && v <= 999) result[name] = v;
  });
  return result;
}
