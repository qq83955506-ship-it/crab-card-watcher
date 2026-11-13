import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.json');
const profileDir = path.join(rootDir, '.browser-profile');

const DEFAULT_CONFIG = {
  targetUrl: 'https://hmgz.7ckd.cc/type33?mercid=454',
  checkIntervalSeconds: 60,
  autoSelectAvailableDate: true,
};

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const config = { ...DEFAULT_CONFIG, ...raw };
    const seconds = Number(config.checkIntervalSeconds);
    config.checkIntervalSeconds = Number.isFinite(seconds)
      ? Math.max(60, Math.min(300, Math.floor(seconds)))
      : DEFAULT_CONFIG.checkIntervalSeconds;
    return config;
  } catch (error) {
    console.error('读取 config.json 失败：' + error.message);
    process.exit(1);
  }
}

function askEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(message, () => {
    rl.close();
    resolve();
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pageText(page) {
  try {
    return await page.locator('body').innerText({ timeout: 5000 });
  } catch {
    return '';
  }
}

async function detectManualVerification(page) {
  const text = await pageText(page);
  return /验证码|安全验证|滑动验证|滑块验证|访问频繁|请求过于频繁|操作过于频繁|异常访问|captcha|verify you are human/i.test(text);
}

function isFullOrUnavailable(text) {
  return /已约满|约满|满额|已满|售罄|无库存|不可预约|暂不可约|已结束|停止预约|已售完|无名额/.test(text);
}

function looksLikeDate(text) {
  return /20\d{2}\s*[-/.年]\s*\d{1,2}/.test(text);
}

async function findDateSelect(page) {
  const selectCount = await page.locator('select').count();
  const candidates = [];

  for (let i = 0; i < selectCount; i += 1) {
    const locator = page.locator('select').nth(i);
    const details = await locator.evaluate((el) => {
      const visible = Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const options = Array.from(el.options).map((option) => ({
        value: option.value,
        text: (option.textContent || '').trim().replace(/\s+/g, ' '),
        disabled: option.disabled,
      }));
      let nearText = '';
      let node = el;
      for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
        const text = (node.innerText || node.textContent || '').trim();
        if (text.length > 0 && text.length < 500) {
          nearText = text;
          if (/发货日期|配送日期|预约日期|提货日期/.test(text)) break;
        }
      }
      const ident = (el.id || '') + ' ' + (el.name || '') + ' ' + (el.className || '');
      const hasDateOptions = options.some((option) => /20\d{2}[-/.年]\d{1,2}/.test(option.text));
      return { visible, options, nearText, ident, hasDateOptions };
    });

    if (!details.visible || !details.hasDateOptions) continue;

    let score = 10;
    if (/发货日期|配送日期|预约日期|提货日期/.test(details.nearText)) score += 100;
    if (/date|ship|delivery|send|time/i.test(details.ident)) score += 20;
    score += Math.min(details.options.length, 10);
    candidates.push({ locator, details, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function getAvailableDate(candidate) {
  return candidate.details.options.find((option) => {
    if (option.disabled || !option.value || !looksLikeDate(option.text)) return false;
    if (isFullOrUnavailable(option.text)) return false;
    return true;
  }) || null;
}

async function snapshotForm(page) {
  return page.locator('input, textarea, select').evaluateAll((elements) => {
    return elements.map((el, index) => {
      if (el.type === 'password' || el.type === 'hidden' || el.type === 'file') return null;
      const tag = el.tagName.toLowerCase();
      const selectedText = tag === 'select' && el.selectedIndex >= 0
        ? (el.options[el.selectedIndex]?.textContent || '').trim()
        : '';
      const optionText = tag === 'select'
        ? Array.from(el.options).map((option) => option.textContent || '').join(' ')
        : '';
      if (tag === 'select' && /20\d{2}[-/.年]\d{1,2}/.test(optionText)
          && /发货日期|配送日期|预约日期|提货日期/.test(el.parentElement?.parentElement?.innerText || '')) {
        return null;
      }
      return {
        tag,
        index,
        value: el.value,
        checked: typeof el.checked === 'boolean' ? el.checked : undefined,
        selectedText,
      };
    }).filter(Boolean);
  });
}

async function restoreForm(page, snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return;
  for (const item of snapshot) {
    const locator = page.locator(item.tag).nth(item.index);
    try {
      if (item.tag === 'select') {
        const matched = await locator.evaluate((el, data) => {
          const option = Array.from(el.options).find((candidate) => candidate.value === data.value)
            || Array.from(el.options).find((candidate) => (candidate.textContent || '').trim() === data.selectedText);
          if (!option) return false;
          el.value = option.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, item);
        if (matched) await sleep(250);
      } else if (item.checked !== undefined) {
        await locator.setChecked(item.checked, { timeout: 1000 }).catch(() => {});
      } else if (item.value) {
        await locator.fill(item.value, { timeout: 1000 }).catch(() => {});
      }
    } catch {
      // 页面结构变化时跳过无法安全对应的字段，不猜测填写。
    }
  }
}

async function notify(page, dateText) {
  process.stdout.write('\x07\n');
  console.log('\n==============================================');
  console.log('发现疑似可预约日期：' + dateText);
  console.log('程序已尝试在网页中选中该日期。');
  console.log('请核对商品、日期和收货信息，再由你本人完成最终提交。');
  console.log('程序不会自动点击最终确认/下单按钮。');
  console.log('==============================================\n');

  await page.evaluate((message) => {
    try {
      window.alert(message);
    } catch {
      // 浏览器弹窗可能被禁用。
    }
  }, '发现疑似可预约日期：' + dateText + '\n请核对收货信息，并由你本人完成最终提交。').catch(() => {});
}

async function main() {
  const config = readConfig();
  fs.mkdirSync(profileDir, { recursive: true });

  console.log('==============================================');
  console.log('        大闸蟹蟹卡预约日期监控助手 v1.0');
  console.log('==============================================');
  console.log('监控网址：' + config.targetUrl);
  console.log('检查间隔：' + config.checkIntervalSeconds + ' 秒（最低 60 秒）');
  console.log('卡号和密码不会由本程序读取或保存。');
  console.log('遇到验证码/安全验证会暂停，不会尝试绕过。');
  console.log('程序只监控并选择日期，不会自动提交最终订单。\n');

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1440, height: 950 },
    locale: 'zh-CN',
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((error) => {
    console.log('首次打开页面未完成：' + error.message);
    console.log('浏览器仍会保持打开，你可以手动检查网络并刷新。');
  });

  console.log('请在弹出的浏览器中自行完成：');
  console.log('1. 输入蟹卡卡号和密码；');
  console.log('2. 选择商品；');
  console.log('3. 填写收货信息，进入包含“发货日期”的第 3 步页面；');
  console.log('4. 确认页面已显示发货日期下拉框。');
  await askEnter('\n完成后回到这个黑色窗口，按回车开始监控……');

  console.log('\n开始监控。请保持浏览器和这个窗口打开。按 Ctrl+C 可停止。\n');
  let consecutiveErrors = 0;

  while (true) {
    try {
      if (await detectManualVerification(page)) {
        console.log('检测到验证码/安全验证/频率限制提示，已停止。请在浏览器中手动处理，并遵循网站提示。');
        break;
      }

      const body = await pageText(page);
      if (!/发货日期|配送日期|预约日期|提货日期/.test(body)) {
        console.log('当前页面没有识别到发货日期区域。请回到第 3 步页面后重新启动程序。');
        break;
      }

      const candidate = await findDateSelect(page);
      if (!candidate) {
        console.log('暂时无法识别日期下拉框。为避免误操作，监控已停止。');
        break;
      }

      const available = getAvailableDate(candidate);
      if (available) {
        if (config.autoSelectAvailableDate) {
          await candidate.locator.selectOption(available.value, { timeout: 5000 });
          await sleep(500);
        }
        await notify(page, available.text);
        break;
      }

      const fullDates = candidate.details.options
        .filter((option) => looksLikeDate(option.text)
          && (isFullOrUnavailable(option.text) || option.disabled))
        .map((option) => option.text);
      console.log(new Date().toLocaleTimeString() + '：暂未发现明确可预约日期。'
        + (fullDates.length ? ' 已满日期：' + fullDates.slice(0, 3).join('；') : ''));

      const formSnapshot = await snapshotForm(page);
      await sleep(config.checkIntervalSeconds * 1000);
      const response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch((error) => {
        throw new Error('刷新失败：' + error.message);
      });

      if (response && [403, 429].includes(response.status())) {
        console.log('网站返回 HTTP ' + response.status() + '，已停止刷新，避免触发站点限制。');
        break;
      }

      await sleep(800);
      if (await detectManualVerification(page)) {
        console.log('刷新后出现验证码/访问限制提示，已停止。请手动检查。');
        break;
      }

      await restoreForm(page, formSnapshot);
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      console.log('本轮检查遇到问题：' + error.message);
      if (consecutiveErrors >= 3) {
        console.log('连续出现 3 次错误，已停止，避免反复请求网站。');
        break;
      }
      await sleep(Math.max(config.checkIntervalSeconds, 60) * 1000);
    }
  }

  console.log('\n监控已结束。浏览器会保持打开，方便你检查页面。');
  console.log('浏览器登录状态仅保存在这台电脑的 .browser-profile 文件夹。');
}

main().catch((error) => {
  console.error('程序异常：', error);
  process.exitCode = 1;
});
