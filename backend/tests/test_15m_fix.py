import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1280, 'height': 900})
        
        print('[1/4] Loading page...')
        await page.goto('http://localhost:5174/')
        await page.wait_for_selector('.tv-chart-container', state='attached', timeout=30000)
        await asyncio.sleep(5)
        await page.screenshot(path='test_1D_initial_5174.png')
        print('[1/4] 1D screenshot saved')
        
        print('[2/4] Switching to 15m...')
        btn_15m = await page.wait_for_selector('button:has-text("tf.15m")', timeout=10000)
        await btn_15m.click()
        await asyncio.sleep(8)
        await page.screenshot(path='test_15m_5174.png')
        print('[2/4] 15m screenshot saved')
        
        strategy_panel = await page.query_selector('text=/signals.*lines/')
        if strategy_panel:
            text = await strategy_panel.inner_text()
            print(f'[3/4] Strategy panel text: {text}')
        else:
            print('[3/4] Strategy panel signals text NOT found')
        
        has_colored_lines = await page.evaluate('''() => {
            const canvas = document.querySelector('.tv-chart-container canvas');
            if (!canvas) return false;
            const rect = canvas.getBoundingClientRect();
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(rect.width * 0.2, rect.height * 0.2, rect.width * 0.6, rect.height * 0.6);
            const data = imageData.data;
            let coloredPixels = 0;
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
                if ((g > 150 && r < 100 && b < 100) || (r > 150 && g < 100 && b < 100)) {
                    coloredPixels++;
                }
            }
            return coloredPixels > 100;
        }''')
        print(f'[4/4] Has colored strategy lines in 15m: {has_colored_lines}')
        
        await browser.close()
        print('Test complete!')

asyncio.run(test())
