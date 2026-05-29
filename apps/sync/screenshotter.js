import { chromium } from 'playwright';

let browser = null;

async function getBrowser() {
  if (!browser) browser = await chromium.launch();
  return browser;
}

export async function screenshotComponent(previewUrl) {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setViewportSize({ width: 600, height: 300 });
    await page.goto(previewUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300); // let Lit render
    const buf = await page.screenshot({ fullPage: false });
    return buf.toString('base64');
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
