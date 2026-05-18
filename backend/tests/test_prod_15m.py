import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1280, 'height': 900})
        logs = []
        page.on('console', lambda msg: logs.append(f'[{msg.type}] {msg.text}'))
        
        await page.goto('http://localhost:8080/')
        await asyncio.sleep(10)
        
        # Click add strategy
        await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const addBtn = btns.find(b => b.textContent.includes('\u6dfb\u52a0\u7b56\u7565'));
            if (addBtn) { addBtn.click(); return 'clicked'; }
            return 'not found';
        }""")
        await asyncio.sleep(2)
        
        # Click VWAP (look for any element with VWAP text)
        result = await page.evaluate("""() => {
            const all = Array.from(document.querySelectorAll('*'));
            // Look for strategy list items
            for (const el of all) {
                if (el.textContent && el.textContent.includes('VWAP') && el.children.length === 0) {
                    el.click();
                    return 'clicked: ' + el.textContent.trim();
                }
            }
            return 'not found, available: ' + document.body.innerText.slice(0, 500);
        }""")
        print('Strategy select:', result)
        await asyncio.sleep(5)
        await page.screenshot(path='test_prod_1D.png')
        
        has_1d = await page.evaluate("""() => document.body.innerText.includes('signals')""")
        print('1D has signals:', has_1d)
        
        # Switch to 15m
        await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn15m = btns.find(b => b.textContent.includes('15m'));
            if (btn15m) { btn15m.click(); return 'clicked 15m'; }
            return '15m not found';
        }""")
        await asyncio.sleep(12)
        await page.screenshot(path='test_prod_15m.png')
        
        has_15m = await page.evaluate("""() => document.body.innerText.includes('signals')""")
        print('15m has signals:', has_15m)
        
        print('\n--- Console logs (last 50) ---')
        for log in logs[-50:]:
            print(log)
        
        await browser.close()

asyncio.run(test())
