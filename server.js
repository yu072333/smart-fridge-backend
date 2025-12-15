// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());

// ===================================
// 0️⃣ 健康檢查與首頁測試
// ===================================
app.get('/', (req, res) => {
  res.send('🚀 Smart Fridge Backend 正常運作中！');
});

app.get('/api/ping', (req, res) => {
  res.json({ message: '✅ Server 運作中' });
});

// ✅ CORS：允許前端（Vercel）及本地端連線
app.use(
  cors({
    origin: ['http://localhost:3000', 'https://smart-fridge-yuxuan.vercel.app'],
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type'],
  })
);

// ✅ Render / 本地 Port
const PORT = process.env.PORT || 3001;

// ✅ Google Sheet 設定
const SHEET_ID =
  process.env.SHEET_ID || '1xM_i7qcu6aiOFfXiBPBdtzLxo9RlXNKE88cSKP-JKAA';

const serviceAccountAuth = new JWT({
  email:
    process.env.GOOGLE_CLIENT_EMAIL ||
    'yu072333@gen-lang-client-0103108306.iam.gserviceaccount.com',
  key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function loadSheet() {
  const doc = new GoogleSpreadsheet(SHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  return doc.sheetsByIndex[0];
}

// ✅ Gemini 設定
let genAI;
try {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} catch (err) {
  console.warn('⚠️ 尚未設定 GEMINI_API_KEY，AI 功能將無法使用');
}

// ===================================
// 0️⃣ 健康檢查
// ===================================
app.get('/api/ping', (req, res) => {
  res.json({ message: '✅ Server 運作中' });
});

// ===================================
// 1️⃣ 讀取庫存資料
// ===================================
app.get('/api/items', async (req, res) => {
  try {
    const sheet = await loadSheet();
    const rows = await sheet.getRows();
    const items = rows.map((r) => ({
      id: r.rowIndex,
      name: r.get('name'),
      price: Number(r.get('price')) || 0,
      weight: r.get('weight') || '未標示',
      expiry: r.get('expiry'),
      remaining: Number(r.get('remaining')) || 0,
      averageDays: Number(r.get('averageDays')) || 3,
      shelfLife: Number(r.get('shelfLife')) || 7,
    }));
    res.json(items);
  } catch (err) {
    console.error('❌ /api/items 錯誤:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================================
// 2️⃣ 新增食材
// ===================================
app.post('/api/item', async (req, res) => {
  try {
    const sheet = await loadSheet();
    await sheet.addRow({
      name: req.body.name,
      price: req.body.price,
      weight: req.body.weight,
      expiry: req.body.expiry,
      remaining: req.body.remaining || 100,
      averageDays: req.body.averageDays || 3,
      shelfLife: req.body.shelfLife || 7,
    });
    res.json({ message: '✅ 已新增食材' });
  } catch (err) {
    console.error('❌ /api/item 錯誤:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================================
// 3️⃣ 更新剩餘量
// ===================================
app.put('/api/update-item/:id', async (req, res) => {
  try {
    const sheet = await loadSheet();
    const rows = await sheet.getRows();
    const row = rows.find((r) => r.rowIndex == req.params.id);
    if (!row) return res.status(404).json({ error: '找不到該筆資料' });
    row.set('remaining', req.body.remaining);
    await row.save();
    res.json({ message: '✅ 更新成功' });
  } catch (err) {
    console.error('❌ /api/update-item 錯誤:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================================
// 4️⃣ 一般 AI 聊天
// ===================================
app.post('/api/ask-ai', async (req, res) => {
  const { question } = req.body;

  try {
    // 先讀取冰箱庫存
    const sheet = await loadSheet();
    const rows = await sheet.getRows();

    const inventory = rows.map((r) => ({
      name: r.get('name'),
      price: Number(r.get('price')) || 0,
      weight: r.get('weight') || '',
      expiry: r.get('expiry') || '',
      remaining: Number(r.get('remaining')) || 0,
      shelfLife: Number(r.get('shelfLife')) || 7,
    }));

    if (!genAI) {
      return res.json({
        answer:
          '⚠️ 尚未設定 GEMINI_API_KEY，目前為示意模式。\n' +
          '你的冰箱目前有：\n' +
          inventory.map(i => `- ${i.name}（剩 ${i.remaining}%）`).join('\n') +
          '\n你可以先把剩餘量低或快過期的食材排進這幾天的料理。',
      });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `
你是一位友善但精準的冰箱料理顧問，必須「直接根據冰箱現有食材」給建議。
請用繁體中文回答，條列清楚，不要再叫使用者提供冰箱內容，也不要反問問題。

【使用者提問】
${question}

【冰箱庫存】
${inventory
  .map(
    (i) =>
      `- ${i.name}：剩 ${i.remaining}%｜耐放約 ${i.shelfLife} 天｜到期日 ${i.expiry || '未填'}｜單價約 $${i.price}`
  )
  .join('\n')}

請依照下面原則回答：
1. 如果問題是要規劃菜單或食譜，請直接根據上面的庫存，給出具體料理建議（可以列出 3～5 道菜，說明主要食材）。
2. 優先使用「剩餘量低或耐放天數少」的食材。
3. 回答要簡短實用，不要廢話，不要客套，也不要再問使用者問題。
`;

    const result = await model.generateContent(prompt);
    res.json({ answer: result.response.text() });
  } catch (err) {
    console.error('❌ /api/ask-ai 錯誤:', err.message);
    res.json({
      answer:
        'AI 暫時無法連線，但你可以先把剩餘量低或快過期的食材排進這幾天的菜單。',
    });
  }
});

// ===================================
// 5️⃣ 智慧冰箱顧問 × 一週菜單規劃
// ===================================
app.post('/api/smart-suggest', async (req, res) => {
  const { goal, capacity } = req.body;

  try {
    const sheet = await loadSheet();
    const rows = await sheet.getRows();

    // 🧾 統整食材資料
    const inventory = rows.map((r) => {
      const expiry = r.get('expiry');
      let shelfLife = Number(r.get('shelfLife')) || 7;
      if (expiry) {
        const diff =
          (new Date(expiry).getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24);
        shelfLife = Math.max(1, Math.round(diff));
      }
      return {
        name: r.get('name'),
        price: Number(r.get('price')) || 0,
        remaining: Number(r.get('remaining')) || 0,
        shelfLife,
        averageDays: Number(r.get('averageDays')) || 3,
      };
    });

    // 📊 計算基本資訊
    const urgent = inventory.filter((i) => i.remaining < 40 || i.shelfLife < 5);
    const avgDays = Math.round(
      inventory.reduce((a, b) => a + b.averageDays, 0) /
        (inventory.length || 1)
    );
    const totalValue = inventory.reduce((sum, i) => sum + i.price, 0);

    // 🚧 沒有 Gemini → Fallback
    if (!genAI) {
      return res.json({
        answer:
          '⚠️ 尚未連上 Gemini，請根據剩餘量與保鮮期自行安排料理優先順序。',
        urgent,
        totalValue,
        avgDays,
      });
    }

    // 🧠 Gemini prompt
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `
你是一位專業的「智慧冰箱菜單顧問」，請用繁體中文、條列＋表格清楚回答，不要多餘對話。

【使用者偏好】
${goal || '未指定，請規劃均衡多樣菜色'}

【冰箱容量】
目前使用：${capacity || '未知'} 格。請確保不超過容量，並優先處理快過期食材。

【庫存狀況】
${inventory
  .map(
    (i) =>
      `- ${i.name}：剩${i.remaining}%｜耐放${i.shelfLife}天｜價格$${i.price}`
  )
  .join('\n')}

請輸出以下三部分（保持標題一致）：
📅 一週菜單建議（以 Markdown 表格呈現，7天×午餐/晚餐）
🧾 建議採購清單（含數量與單位）
💡 保存與料理提醒（3 行以內）
`;

    let answer;
    try {
      const result = await model.generateContent(prompt);
      answer = result.response.text();
    } catch (err) {
      console.error('⚠️ Gemini 產生內容失敗:', err.message);
      answer = 'AI 顧問暫時離線，但你可以先將快過期食材優先使用。';
    }

    // 🔍 嘗試拆分回傳（方便前端顯示）
    const extract = (title) => {
      const match = answer.match(new RegExp(`📅 ${title}[\\s\\S]*?(?=📅|🧾|💡|$)`));
      return match ? match[0].replace(`📅 ${title}`, '').trim() : '';
    };

    const weekMenu = extract('一週菜單建議');
    const purchaseList = extract('建議採購清單');
    const reminders = extract('保存與料理提醒');

    res.json({
      answer,
      weekMenu,
      purchaseList,
      reminders,
      urgent,
      totalValue,
      avgDays,
    });
  } catch (err) {
    console.error('❌ /api/smart-suggest 錯誤:', err.message);
    res.json({
      answer:
        '智慧菜單規劃暫時出錯，但庫存資料仍可用，請稍後再試。',
      urgent: [],
      totalValue: 0,
      avgDays: 0,
    });
  }
});

// ===================================
app.listen(PORT, () => {
  console.log(`🚀 智慧冰箱顧問啟動於 http://localhost:${PORT}`);
});


